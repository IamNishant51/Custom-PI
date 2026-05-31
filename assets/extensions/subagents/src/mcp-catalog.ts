import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { McpServerConfig, McpToolDefinition } from "./acp-types";

const CONFIG_DIR = path.join(os.homedir(), ".pi", "agent");
const MCP_CONFIG_PATH = path.join(CONFIG_DIR, "mcp-servers.json");

let cachedServers: McpServerConfig[] | null = null;

const BUILTIN_MCP_SERVERS: McpServerConfig[] = [
  {
    id: "builtin-fs",
    name: "Filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    enabled: true,
    isBuiltin: true,
  },
  {
    id: "builtin-puppeteer",
    name: "Browser Automation",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    enabled: false,
    isBuiltin: true,
  },
  {
    id: "builtin-github",
    name: "GitHub",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    enabled: false,
    isBuiltin: true,
  },
  {
    id: "builtin-sequential-thinking",
    name: "Sequential Thinking",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    enabled: true,
    isBuiltin: true,
  },
  {
    id: "builtin-memory",
    name: "Memory",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    enabled: false,
    isBuiltin: true,
  },
];

export function loadMcpServers(): McpServerConfig[] {
  if (cachedServers) return cachedServers;
  const serverMap = new Map<string, McpServerConfig>();
  for (const b of BUILTIN_MCP_SERVERS) serverMap.set(b.id, { ...b });
  try {
    if (fs.existsSync(MCP_CONFIG_PATH)) {
      const raw = fs.readFileSync(MCP_CONFIG_PATH, "utf8");
      const persisted: McpServerConfig[] = JSON.parse(raw);
  for (const p of persisted) {
    const existing = serverMap.get(p.id);
    if (existing && existing.isBuiltin) {
      existing.enabled = p.enabled;
      if (p.name) existing.name = p.name;
      if (p.command) existing.command = p.command;
      if (p.args) existing.args = p.args;
    } else if (!existing) {
      p.isBuiltin = false;
      serverMap.set(p.id, p);
    }
  }
    }
  } catch {}
  const servers = Array.from(serverMap.values());
  cachedServers = servers;
  return servers;
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(servers, null, 2), "utf8");
  cachedServers = null;
}

export function toggleMcpServer(serverId: string, enabled: boolean): void {
  const servers = loadMcpServers();
  const server = servers.find(s => s.id === serverId);
  if (server) {
    server.enabled = enabled;
    saveMcpServers(servers);
  }
}

export function addMcpServer(server: McpServerConfig): void {
  const servers = loadMcpServers();
  const idx = servers.findIndex(s => s.id === server.id);
  if (idx >= 0) servers[idx] = server;
  else servers.push(server);
  saveMcpServers(servers);
}

export function removeMcpServer(serverId: string): boolean {
  const servers = loadMcpServers();
  const filtered = servers.filter(s => s.id !== serverId);
  if (filtered.length === servers.length) return false;
  saveMcpServers(filtered);
  return true;
}

export function discoverMcpTools(serverId: string): McpToolDefinition[] {
  const servers = loadMcpServers();
  const server = servers.find(s => s.id === serverId);
  if (!server || !server.enabled) return [];

  if (server.transport === "stdio" && server.command) {
    try {
      const result = spawnSync(server.command, [...(server.args || []), "--list-tools"], {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
        encoding: "utf8",
        env: { ...process.env, ...server.env },
      });
      if (result.status === 0 && result.stdout) {
        try {
          const parsed = JSON.parse(result.stdout);
          if (Array.isArray(parsed)) {
            return parsed.map((t: any) => ({
              serverId,
              name: t.name || t,
              description: t.description || "",
              inputSchema: t.inputSchema || {},
            }));
          }
        } catch {}
      }
    } catch {}
  }
  return [];
}

export function getEnabledMcpServers(): McpServerConfig[] {
  return loadMcpServers().filter(s => s.enabled);
}

export function buildMcpContextForPrompt(): string {
  const enabled = getEnabledMcpServers();
  if (!enabled.length) return "";
  const lines = enabled.map(s =>
    `  - ${s.name} (${s.transport})${s.command ? `: \`${s.command} ${(s.args || []).join(" ")}\`` : ""}`
  );
  return `\n## Available MCP Servers\nYou have the following MCP tools available:\n${lines.join("\n")}\n`;
}
