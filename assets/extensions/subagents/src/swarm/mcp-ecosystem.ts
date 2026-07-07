import { PATHS } from "../config";
import { logger } from "../logger";
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { bus, Topics } from "../event-bus/event-bus";

interface MCPServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  status: "stopped" | "starting" | "running" | "error";
  description?: string;
  tools?: MCPTool[];
  process?: ChildProcess;
  lastError?: string;
  startedAt?: number;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  serverName: string;
}

interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  serverName: string;
}

export class MCPEcosystem {
  private servers: Map<string, MCPServer> = new Map();
  private toolRegistry: Map<string, MCPTool> = new Map();
  private resourceRegistry: Map<string, MCPResource> = new Map();
  private configPath: string;

  constructor() {
    this.configPath = PATHS.MCP_SERVERS;
    this.loadConfig();
    this.registerBuiltInServers();
  }

  private registerBuiltInServers(): void {
    const builtIn = [
      {
        name: "sequential-thinking",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
        enabled: false,
        description: "Sequential Thinking MCP Server for step-by-step reasoning",
      },
      {
        name: "filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", os.homedir()],
        enabled: false,
        description: "Filesystem access with allowed directories",
      },
      {
        name: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        enabled: false,
        description: "GitHub API integration",
      },
      {
        name: "brave-search",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-brave-search"],
        enabled: false,
        description: "Web search via Brave Search API",
      },
      {
        name: "memory",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        enabled: false,
        description: "Knowledge graph memory system",
      },
    ];

    for (const server of builtIn) {
      if (!this.servers.has(server.name)) {
        const existing = this.servers.get(server.name);
        this.servers.set(server.name, {
          ...server,
          enabled: existing?.enabled ?? server.enabled,
          status: "stopped",
          tools: existing?.tools,
        });
      }
    }
  }

  private loadConfig(): void {
    try {
      if (!fs.existsSync(this.configPath)) return;
      const config = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
      if (Array.isArray(config)) {
        for (const server of config) {
          this.servers.set(server.name, {
            name: server.name,
            command: server.command,
            args: server.args || [],
            env: server.env,
            enabled: server.enabled !== false,
            status: "stopped",
            description: server.description,
          });
        }
      }
    } catch { logger.warn("empty catch block") }
  }

  private saveConfig(): void {
    try {
      const config = Array.from(this.servers.values()).map(s => ({
        name: s.name,
        command: s.command,
        args: s.args,
        env: s.env,
        enabled: s.enabled,
        description: s.description,
      }));
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = this.configPath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
      fs.renameSync(tmp, this.configPath);
    } catch { logger.warn("empty catch block") }
  }

  async startServer(name: string): Promise<boolean> {
    const server = this.servers.get(name);
    if (!server) throw new Error(`Server ${name} not found`);
    if (server.status === "running") return true;

    if (server.command === "npx" && (server.name === "sequential-thinking" || server.args?.includes("@modelcontextprotocol/server-sequential-thinking"))) {
      try {
        const nvmBinDir = path.dirname(process.execPath);
        const globalMcpPath = path.join(nvmBinDir, "mcp-server-sequential-thinking");
        if (fs.existsSync(globalMcpPath)) {
          server.command = globalMcpPath;
          server.args = [];
        }
      } catch { logger.warn("empty catch block") }
    }

    server.status = "starting";
    try {
      const child = spawn(server.command, server.args, {
        env: { ...process.env, ...server.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      server.process = child;
      server.startedAt = Date.now();

      child.on("exit", (code) => {
        server.status = "error";
        server.lastError = `Exited with code ${code}`;
        bus.emit(Topics.PLUGIN_ERROR, {
          server: name,
          error: server.lastError,
        }, { source: "mcp-ecosystem" });
      });

      child.on("error", (err) => {
        server.status = "error";
        server.lastError = err.message;
      });

      child.stdout?.on("data", (data) => {
        this.parseServerOutput(name, data.toString());
      });

      child.stderr?.on("data", (data) => {
        this.parseServerOutput(name, data.toString());
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          server.status = "running";
          resolve();
        }, 2000);
        child.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      bus.emit(Topics.PLUGIN_LOADED, { server: name, tools: server.tools?.length || 0 }, { source: "mcp-ecosystem" });
      return true;
    } catch (err: any) {
      server.status = "error";
      server.lastError = err.message;
      return false;
    }
  }

  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server || !server.process) return;
    try {
      server.process.kill("SIGTERM");
      setTimeout(() => {
        try { server.process?.kill("SIGKILL"); } catch { logger.warn("empty catch block") }
      }, 3000);
    } catch { logger.warn("empty catch block") }
    server.status = "stopped";
    server.process = undefined;
  }

  async restartServer(name: string): Promise<boolean> {
    await this.stopServer(name);
    return this.startServer(name);
  }

  addServer(config: Omit<MCPServer, "status" | "process" | "tools" | "lastError" | "startedAt">): void {
    this.servers.set(config.name, { ...config, status: "stopped" });
    this.saveConfig();
  }

  removeServer(name: string): void {
    this.stopServer(name);
    this.servers.delete(name);
    this.saveConfig();
  }

  enableServer(name: string): void {
    const server = this.servers.get(name);
    if (server) { server.enabled = true; this.saveConfig(); }
  }

  disableServer(name: string): void {
    const server = this.servers.get(name);
    if (server) { server.enabled = false; this.saveConfig(); }
  }

  getServer(name: string): MCPServer | undefined {
    return this.servers.get(name);
  }

  getAllServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }

  getEnabledServers(): MCPServer[] {
    return Array.from(this.servers.values()).filter(s => s.enabled);
  }

  getRunningServers(): MCPServer[] {
    return Array.from(this.servers.values()).filter(s => s.status === "running");
  }

  getTools(): MCPTool[] {
    return Array.from(this.toolRegistry.values());
  }

  getToolsByServer(serverName: string): MCPTool[] {
    return Array.from(this.toolRegistry.values()).filter(t => t.serverName === serverName);
  }

  getResources(): MCPResource[] {
    return Array.from(this.resourceRegistry.values());
  }

  async autoDiscoverServers(): Promise<number> {
    let discovered = 0;
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const child = spawn("npx", ["-y", "@modelcontextprotocol/inspector", "--list"], {
          env: { ...process.env, CI: "true" },
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 10000,
        });
        let output = "";
        child.stdout?.on("data", (d) => { output += d.toString(); });
        child.on("close", (code) => resolve(output));
        child.on("error", reject);
        setTimeout(() => resolve(output), 8000);
      });

      const knownServers = ["sequential-thinking", "filesystem", "github", "brave-search", "memory", "playwright", "puppeteer", "sqlite", "postgres", "redis", "docker", "kubernetes"];
      for (const name of knownServers) {
        if (result.toLowerCase().includes(name.toLowerCase()) && !this.servers.has(name)) {
          this.servers.set(name, {
            name,
            command: "npx",
            args: ["-y", `@modelcontextprotocol/server-${name}`],
            enabled: false,
            status: "stopped",
            description: `Auto-discovered MCP server: ${name}`,
          });
          discovered++;
        }
      }
    } catch { logger.warn("empty catch block") }
    return discovered;
  }

  private parseServerOutput(name: string, data: string): void {
    try {
      const lines = data.split("\n").filter(l => l.trim());
      for (const line of lines) {
        const parsed = JSON.parse(line);
        if (parsed.method === "tools/list" && parsed.result?.tools) {
          const server = this.servers.get(name);
          if (server) {
            server.tools = parsed.result.tools.map((t: any) => ({
              name: t.name,
              description: t.description || "",
              inputSchema: t.inputSchema,
              serverName: name,
            }));
            for (const tool of server.tools ?? []) {
              this.toolRegistry.set(`${name}:${tool.name}`, tool);
            }
          }
        }
        if (parsed.method === "resources/list" && parsed.result?.resources) {
          for (const r of parsed.result.resources) {
            this.resourceRegistry.set(r.uri, {
              uri: r.uri,
              name: r.name,
              description: r.description,
              serverName: name,
            });
          }
        }
      }
    } catch { logger.warn("empty catch block") }
  }
}

export const mcpEcosystem = new MCPEcosystem();
