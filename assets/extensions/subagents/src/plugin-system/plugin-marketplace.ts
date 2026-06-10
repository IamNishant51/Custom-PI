import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { bus, Topics } from "../event-bus/event-bus";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  dependencies?: Record<string, string>;
  permissions: string[];
  hooks: string[];
  tools: PluginTool[];
}

interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

interface InstalledPlugin {
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  installedAt: number;
  lastLoaded?: number;
  loadErrors?: string[];
}

export class PluginMarketplace {
  private pluginsDir: string;
  private plugins: Map<string, InstalledPlugin> = new Map();
  private sandboxVMs: Map<string, any> = new Map();

  constructor() {
    this.pluginsDir = path.join(os.homedir(), ".pi", "agent", "plugins");
    if (!fs.existsSync(this.pluginsDir)) fs.mkdirSync(this.pluginsDir, { recursive: true });
    this.loadInstalledPlugins();
  }

  installFromNpm(packageName: string): Promise<InstalledPlugin> {
    return this.installPlugin(packageName, "npm");
  }

  installFromGit(gitUrl: string): Promise<InstalledPlugin> {
    return this.installPlugin(gitUrl, "git");
  }

  installFromPath(localPath: string): Promise<InstalledPlugin> {
    return this.installPlugin(localPath, "local");
  }

  uninstall(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    try {
      if (fs.existsSync(plugin.path)) {
        fs.rmSync(plugin.path, { recursive: true, force: true });
      }
    } catch {}
    this.plugins.delete(name);
    this.sandboxVMs.delete(name);
    this.persistPlugins();
  }

  enable(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) { plugin.enabled = true; this.persistPlugins(); }
  }

  disable(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) { plugin.enabled = false; this.persistPlugins(); }
  }

  getPlugin(name: string): InstalledPlugin | undefined {
    return this.plugins.get(name);
  }

  getAllPlugins(): InstalledPlugin[] {
    return Array.from(this.plugins.values());
  }

  getEnabledPlugins(): InstalledPlugin[] {
    return Array.from(this.plugins.values()).filter(p => p.enabled);
  }

  callPluginHook(pluginName: string, hook: string, context: any): any {
    const plugin = this.plugins.get(pluginName);
    if (!plugin || !plugin.enabled) return null;
    if (!plugin.manifest.hooks.includes(hook)) return null;

    try {
      const hookFn = this.loadPluginHook(plugin, hook);
      if (hookFn) return hookFn(context);
    } catch (err: any) {
      plugin.loadErrors = plugin.loadErrors || [];
      plugin.loadErrors.push(`Hook ${hook}: ${err.message}`);
    }
    return null;
  }

  callHookOnAll(hook: string, context: any): any[] {
    const results: any[] = [];
    for (const [, plugin] of this.plugins) {
      if (plugin.enabled) {
        const result = this.callPluginHook(plugin.manifest.name, hook, context);
        if (result !== null) results.push(result);
      }
    }
    return results;
  }

  getAvailablePlugins(): Array<{ name: string; description: string; version: string; author: string }> {
    return [
      { name: "web-search", description: "Enhanced web search capabilities", version: "1.0.0", author: "community" },
      { name: "code-formatter", description: "Code formatting and linting", version: "1.0.0", author: "community" },
      { name: "diagram-generator", description: "Generate diagrams from text", version: "1.0.0", author: "community" },
      { name: "database-browser", description: "Browse and query databases", version: "1.0.0", author: "community" },
      { name: "monitoring", description: "System monitoring and alerts", version: "1.0.0", author: "community" },
      { name: "scheduler", description: "Advanced task scheduling", version: "1.0.0", author: "community" },
    ];
  }

  private async installPlugin(source: string, type: "npm" | "git" | "local"): Promise<InstalledPlugin> {
    const pluginName = source.split("/").pop()?.replace(/\.git$/, "").replace(/@/, "_") || `plugin_${Date.now()}`;
    const pluginDir = path.join(this.pluginsDir, pluginName);

    if (type === "npm") {
      await this.execCommand(`npm install ${source} --prefix ${this.pluginsDir} --no-audit --no-fund`);
    } else if (type === "git") {
      await this.execCommand(`git clone ${source} "${pluginDir}"`);
    } else if (type === "local") {
      if (fs.existsSync(source)) {
        fs.cpSync(source, pluginDir, { recursive: true });
      }
    }

    const manifestPath = path.join(pluginDir, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Plugin ${source} has no plugin.json manifest`);
    }

    const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const plugin: InstalledPlugin = {
      manifest,
      path: pluginDir,
      enabled: true,
      installedAt: Date.now(),
    };

    this.plugins.set(manifest.name, plugin);
    this.persistPlugins();

    bus.emit(Topics.PLUGIN_LOADED, {
      name: manifest.name,
      version: manifest.version,
      tools: manifest.tools?.length || 0,
      hooks: manifest.hooks?.length || 0,
    }, { source: "plugin-marketplace" });

    return plugin;
  }

  private loadPluginHook(plugin: InstalledPlugin, hook: string): ((context: any) => any) | null {
    try {
      const entryPath = path.join(plugin.path, plugin.manifest.entry);
      if (!fs.existsSync(entryPath)) return null;

      const vm = this.sandboxVMs.get(plugin.manifest.name);
      if (!vm) return null;

      const code = fs.readFileSync(entryPath, "utf8");
      const fn = new Function("context", `"use strict";\n${code}\nreturn exports["${hook}"](context);`);
      return (context: any) => fn(context);
    } catch {
      return null;
    }
  }

  private execCommand(cmd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("sh", ["-c", cmd], {
        stdio: "pipe",
        timeout: 60000,
      });
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Command exited with ${code}`)));
      child.on("error", reject);
    });
  }

  private persistPlugins(): void {
    const indexPath = path.join(this.pluginsDir, "registry.json");
    const data = Array.from(this.plugins.values()).map(p => ({
      manifest: p.manifest,
      path: p.path,
      enabled: p.enabled,
      installedAt: p.installedAt,
    }));
    const tmp = indexPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, indexPath);
  }

  private loadInstalledPlugins(): void {
    try {
      const indexPath = path.join(this.pluginsDir, "registry.json");
      if (!fs.existsSync(indexPath)) return;
      const data: InstalledPlugin[] = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      for (const plugin of data) {
        if (fs.existsSync(plugin.path)) {
          this.plugins.set(plugin.manifest.name, plugin);
        }
      }
    } catch {}
  }
}

export const pluginMarketplace = new PluginMarketplace();
