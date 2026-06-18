import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const PI_DIR = path.join(os.homedir(), ".pi", "agent");
const PLUGINS_DIR = path.join(PI_DIR, "plugins");

function ensurePluginsDir() { fs.mkdirSync(PLUGINS_DIR, { recursive: true }); }

export function loadPlugins() {
  ensurePluginsDir();
  try {
    const plugins = [];
    for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const manifestFile = path.join(PLUGINS_DIR, entry.name, "manifest.json");
        const codeFile = path.join(PLUGINS_DIR, entry.name, "plugin.js");
        if (fs.existsSync(manifestFile)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
            plugins.push({ name: entry.name, manifest, enabled: true, hasCode: fs.existsSync(codeFile) });
          } catch {}
        }
      }
    }
    return plugins;
  } catch { return []; }
}

export async function loadPluginCode(name) {
  const codeFile = path.join(PLUGINS_DIR, name, "plugin.js");
  if (fs.existsSync(codeFile)) {
    try {
      const code = fs.readFileSync(codeFile, "utf8");
      const vm = await import('vm');
      const safeModules = {
        console: { log: console.log, warn: console.warn, error: console.error },
        JSON, Math, Date, RegExp,
        String, Number, Boolean, Array, Object, Map, Set, Promise,
        TextEncoder, TextDecoder, URL, URLSearchParams,
      };
      const sandbox = Object.create(null);
      Object.assign(sandbox, safeModules, { module: {}, exports: {} });
      vm.createContext(sandbox);
      const script = new vm.Script(code, { timeout: 5000 });
      script.runInContext(sandbox, { timeout: 5000 });
      return sandbox.module.exports || sandbox.exports;
    } catch (e) {
      return { error: e.message };
    }
  }
  return null;
}

export function createPluginManifest(name, description, version) {
  ensurePluginsDir();
  const pluginDir = path.join(PLUGINS_DIR, name);
  fs.mkdirSync(pluginDir, { recursive: true });
  const manifest = {
    name,
    description: description || `${name} plugin`,
    version: version || "1.0.0",
    author: "user",
    tools: [],
    hooks: [],
    created: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function installPluginFromUrl(url) {
  return { success: false, message: "Plugin installation from URL not yet implemented. Use plugin.create to create a new plugin." };
}
