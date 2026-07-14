import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { logger } from "./logger";
import type { McpServerConfig, McpToolDefinition } from "./acp-types";

import { PATHS } from "./config";

const CONFIG_DIR = PATHS.PI_DIR;
const MCP_CONFIG_PATH = path.join(CONFIG_DIR, "mcp-servers.json");
const HEALTH_CACHE_TTL = 300_000; // 5 min

const ALLOWED_MCP_COMMANDS = new Set(["npx", "node", "uvx", "python3", "python", "deno", "bun"]);

function isMcpCommandAllowed(command: string): boolean {
  const cmdName = command.trim().split(/\s+/)[0];
  return ALLOWED_MCP_COMMANDS.has(cmdName) || command.startsWith("/") || command.startsWith(".");
}

let cachedServers: McpServerConfig[] | null = null;

// ── Health Registry ─────────────────────────────────────────────────────────

export interface HealthEntry {
  id: string;
  label: string;
  type: "mcp" | "provider";
  healthy: boolean;
  lastChecked: number;
  latencyMs: number;
  error?: string;
}

const healthCache = new Map<string, HealthEntry>();
const HEALTH_CACHE_MAX = 100;

function setHealthEntry(id: string, entry: HealthEntry): void {
  if (healthCache.size >= HEALTH_CACHE_MAX) {
    const oldest = healthCache.keys().next().value;
    if (oldest) healthCache.delete(oldest);
  }
  setHealthEntry(id, entry);
}

export async function probeMcpServer(serverId: string): Promise<HealthEntry> {
  const servers = loadMcpServers();
  const server = servers.find(s => s.id === serverId);
  const label = server?.name || serverId;
  const start = Date.now();

  if (!server || !server.enabled || server.transport !== "stdio" || !server.command) {
    const entry: HealthEntry = {
      id: serverId, label, type: "mcp",
      healthy: false, lastChecked: Date.now(), latencyMs: Date.now() - start,
      error: server ? "Server disabled or invalid transport" : "Server not found",
    };
    setHealthEntry(serverId, entry);
    return entry;
  }

  try {
    if (!isMcpCommandAllowed(server.command)) {
      const entry: HealthEntry = {
        id: serverId, label, type: "mcp",
        healthy: false, lastChecked: Date.now(), latencyMs: Date.now() - start,
        error: "Command not allowed",
      };
      setHealthEntry(serverId, entry);
      return entry;
    }
    const result = spawnSync(server.command, [...(server.args || []), "--list-tools"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
      encoding: "utf8",
      env: { ...process.env, ...server.env },
    });
    const ok = result.status === 0 && !!result.stdout;
    const entry: HealthEntry = {
      id: serverId, label, type: "mcp",
      healthy: ok,
      lastChecked: Date.now(),
      latencyMs: Date.now() - start,
      error: ok ? undefined : `exit ${result.status}: ${(result.stderr || "").slice(0, 200)}`,
    };
    setHealthEntry(serverId, entry);
    return entry;
  } catch (e) {
    const entry: HealthEntry = {
      id: serverId, label, type: "mcp",
      healthy: false, lastChecked: Date.now(), latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    };
    setHealthEntry(serverId, entry);
    return entry;
  }
}

export async function probeProvider(provider: string, apiKey?: string): Promise<HealthEntry> {
  const start = Date.now();
  const label = provider;

  if (!apiKey) {
    const entry: HealthEntry = {
      id: `provider:${provider}`, label, type: "provider",
      healthy: false, lastChecked: Date.now(), latencyMs: Date.now() - start,
      error: "No API key configured",
    };
    setHealthEntry(`provider:${provider}`, entry);
    return entry;
  }

  try {
    let healthy = false;
    let error: string | undefined;

    switch (provider) {
      case "anthropic": {
        const healthModel = process.env.ANTHROPIC_HEALTH_CHECK_MODEL || "claude-haiku-3-5-20241022";
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({ model: healthModel, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
          signal: AbortSignal.timeout(10_000),
        });
        healthy = r.ok || r.status === 400; // 400 = auth OK but bad request
        if (!healthy) error = `HTTP ${r.status}`;
        break;
      }
      case "openai": {
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        healthy = r.ok;
        if (!healthy) error = `HTTP ${r.status}`;
        break;
      }
      case "google": {
        const r = await fetch("https://generativelanguage.googleapis.com/v1/models?key=" + apiKey, {
          signal: AbortSignal.timeout(10_000),
        });
        healthy = r.ok;
        if (!healthy) error = `HTTP ${r.status}`;
        break;
      }
      default:
        healthy = true; // unknown provider, assume healthy
    }

    const entry: HealthEntry = {
      id: `provider:${provider}`, label, type: "provider",
      healthy, lastChecked: Date.now(), latencyMs: Date.now() - start,
      error,
    };
    setHealthEntry(`provider:${provider}`, entry);
    return entry;
  } catch (e) {
    const entry: HealthEntry = {
      id: `provider:${provider}`, label, type: "provider",
      healthy: false, lastChecked: Date.now(), latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    };
    setHealthEntry(`provider:${provider}`, entry);
    return entry;
  }
}

export function getCachedHealth(id: string): HealthEntry | undefined {
  const entry = healthCache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.lastChecked > HEALTH_CACHE_TTL) return undefined;
  return entry;
}

export function getAllHealth(): HealthEntry[] {
  return Array.from(healthCache.values());
}

export function isProviderHealthy(provider: string): boolean {
  const entry = healthCache.get(`provider:${provider}`);
  if (!entry) return true; // no data = assume healthy
  if (Date.now() - entry.lastChecked > HEALTH_CACHE_TTL) return true;
  return entry.healthy;
}

// ── Original MCP Catalog ───────────────────────────────────────────────────

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
  } catch (err) { logger.warn("Failed to load MCP server config", { error: String(err) }); }

  try {
    const nvmBinDir = path.dirname(process.execPath);
    const globalMcpPath = path.join(nvmBinDir, "mcp-server-sequential-thinking");
    if (fs.existsSync(globalMcpPath)) {
      for (const s of serverMap.values()) {
        if (s.id === "builtin-sequential-thinking" || s.name === "sequential-thinking" || (s.command === "npx" && s.args?.includes("@modelcontextprotocol/server-sequential-thinking"))) {
          s.command = globalMcpPath;
          s.args = [];
        }
      }
    }
  } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }

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
    if (!isMcpCommandAllowed(server.command)) {
      logger.warn("MCP command not allowed", { serverId, command: server.command });
      return [];
    }
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
            return parsed.map((t: Record<string, unknown>) => ({
              serverId,
              name: (t.name as string) || String(t),
              description: (t.description as string) || "",
              inputSchema: (t.inputSchema as Record<string, unknown>) ?? ({} as Record<string, unknown>),
            }));
          }
        } catch (err) { logger.warn("Failed to parse MCP tool discovery output", { error: String(err) }); }
      }
    } catch (err) { logger.warn("Failed to discover MCP tools", { serverId, error: String(err) }); }
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
