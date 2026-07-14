import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { NotFoundError, ConfigurationError } from "./errors";
import readline from "node:readline";
import { logger } from "./logger";
import type {
  AgentMetadata,
  AgentType,
  AgentSource,
  AgentMode,
  AcpInitializeResult,
  AcpSessionConfig,
  AcpSessionInfo,
  AcpCapabilities,
} from "./acp-types";

import { PATHS } from "./config";

const CONFIG_DIR = PATHS.PI_DIR;
const AGENTS_CONFIG_PATH = path.join(CONFIG_DIR, "agents.json");
const CUSTOM_AGENTS_CONFIG_PATH = path.join(CONFIG_DIR, "custom-agents.json");
const DISCOVERY_CACHE_TTL = 60_000;

let discoveryCache: { agents: AgentMetadata[]; timestamp: number } | null = null;

let customAgentDefinitions: Array<{
  id: string;
  name: string;
  backend: string;
  command: string;
  args: string[];
  icon: string;
  supportsTeam: boolean;
  agentType: string;
  modes: string[];
}> | null = null;

function loadCustomAgentDefinitions(): Array<{
  id: string; name: string; backend: string; command: string; args: string[];
  icon: string; supportsTeam: boolean; agentType: string; modes: string[];
}> {
  if (customAgentDefinitions) return customAgentDefinitions;
  try {
    if (fs.existsSync(CUSTOM_AGENTS_CONFIG_PATH)) {
      const raw = fs.readFileSync(CUSTOM_AGENTS_CONFIG_PATH, "utf8");
      customAgentDefinitions = JSON.parse(raw);
      return customAgentDefinitions!;
    }
  } catch (e: any) { logger.warn("Failed to load custom agent definitions", e?.message || String(e)); }
  customAgentDefinitions = [];
  return customAgentDefinitions;
}

export function registerCustomAgentDefinition(def: {
  id: string; name: string; backend: string; command: string; args?: string[];
  icon?: string; supportsTeam?: boolean; agentType?: string; modes?: string[];
}): void {
  const defs = loadCustomAgentDefinitions();
  const idx = defs.findIndex(d => d.id === def.id);
  const entry = { ...def, args: def.args || [], icon: def.icon || "🔌", supportsTeam: def.supportsTeam ?? false, agentType: def.agentType || "acp", modes: def.modes || ["default"] };
  if (idx >= 0) defs[idx] = entry;
  else defs.push(entry);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CUSTOM_AGENTS_CONFIG_PATH, JSON.stringify(defs, null, 2), "utf8");
  customAgentDefinitions = defs;
  discoveryCache = null;
}

const KNOWN_AGENTS: Array<{
  id: string;
  name: string;
  backend: string;
  command: string;
  args: string[];
  icon: string;
  supportsTeam: boolean;
  agentType: AgentType;
  modes: AgentMode[];
}> = [
  { id: "claude-code", name: "Claude Code", backend: "claude", command: "claude", args: [], icon: "🤖", supportsTeam: true, agentType: "acp", modes: ["default", "plan", "yolo"] },
  { id: "codex", name: "Codex", backend: "codex", command: "codex", args: [], icon: "📝", supportsTeam: true, agentType: "acp", modes: ["default", "read_only", "yolo"] },
  { id: "opencode", name: "OpenCode", backend: "opencode", command: "opencode", args: [], icon: "🔧", supportsTeam: false, agentType: "acp", modes: ["default", "plan"] },
  { id: "hermes", name: "Hermes Agent", backend: "hermes", command: "hermes", args: [], icon: "⚡", supportsTeam: false, agentType: "acp", modes: ["default", "yolo"] },
  { id: "qwen-code", name: "Qwen Code", backend: "qwen", command: "qwen", args: [], icon: "🐉", supportsTeam: true, agentType: "acp", modes: ["default", "yolo"] },
  { id: "gemini-cli", name: "Gemini CLI", backend: "gemini", command: "gemini", args: [], icon: "✨", supportsTeam: true, agentType: "acp", modes: ["default", "yolo"] },
  { id: "cursor", name: "Cursor Agent", backend: "cursor", command: "cursor", args: ["--agent"], icon: "🎯", supportsTeam: true, agentType: "acp", modes: ["default", "plan"] },
  { id: "snow-cli", name: "Snow CLI", backend: "snow", command: "snow", args: ["run"], icon: "❄️", supportsTeam: true, agentType: "acp", modes: ["default", "yolo"] },
  { id: "goose", name: "Goose AI", backend: "goose", command: "goose", args: [], icon: "🦆", supportsTeam: false, agentType: "acp", modes: ["default"] },
  { id: "openclaw", name: "OpenClaw", backend: "openclaw", command: "openclaw", args: [], icon: "🦞", supportsTeam: false, agentType: "openclaw-gateway", modes: ["default"] },
  { id: "kimi-cli", name: "Kimi CLI", backend: "kimi", command: "kimi", args: [], icon: "🌙", supportsTeam: false, agentType: "acp", modes: ["default"] },
  { id: "copilot", name: "GitHub Copilot", backend: "copilot", command: "gh", args: ["copilot"], icon: "💬", supportsTeam: false, agentType: "acp", modes: ["default"] },
  { id: "codebuddy", name: "CodeBuddy", backend: "codebuddy", command: "codebuddy", args: [], icon: "🧑‍🤝‍🧑", supportsTeam: false, agentType: "acp", modes: ["default"] },
  { id: "qoder", name: "Qoder CLI", backend: "qoder", command: "qoder", args: [], icon: "📐", supportsTeam: false, agentType: "acp", modes: ["default"] },
  { id: "nanobot", name: "Nanobot", backend: "nanobot", command: "nanobot", args: [], icon: "🤏", supportsTeam: false, agentType: "nanobot", modes: ["default"] },
  { id: "mistral-vibe", name: "Mistral Vibe", backend: "mistral", command: "mistral", args: ["vibe"], icon: "🌊", supportsTeam: false, agentType: "acp", modes: ["default"] },
  { id: "augment", name: "Augment Code", backend: "augment", command: "augment", args: [], icon: "⬆️", supportsTeam: false, agentType: "acp", modes: ["default"] },
  { id: "factory-droid", name: "Factory Droid", backend: "droid", command: "droid", args: [], icon: "🏭", supportsTeam: false, agentType: "acp", modes: ["default"] },
];

function checkCommandAvailable(cmd: string): boolean {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(which, [cmd], { stdio: "ignore", timeout: 3000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function discoverAgents(force = false): AgentMetadata[] {
  const now = Date.now();
  if (!force && discoveryCache && now - discoveryCache.timestamp < DISCOVERY_CACHE_TTL) {
    return discoveryCache.agents;
  }
  const agents: AgentMetadata[] = [];
  for (const def of KNOWN_AGENTS) {
    const available = checkCommandAvailable(def.command);
    agents.push({
      id: def.id,
      name: def.name,
      icon: def.icon,
      backend: def.backend,
      agentType: def.agentType as AgentType,
      agentSource: "builtin",
      enabled: true,
      available,
      supportsTeam: def.supportsTeam,
      command: def.command,
      args: def.args,
      modes: def.modes,
    });
  }
  // Load user-defined agent definitions from custom-agents.json (plugin/config mechanism)
  for (const def of loadCustomAgentDefinitions()) {
    const available = checkCommandAvailable(def.command);
    agents.push({
      id: def.id,
      name: def.name,
      icon: def.icon || "🔌",
      backend: def.backend,
      agentType: def.agentType as AgentType,
      agentSource: "custom",
      enabled: true,
      available,
      supportsTeam: def.supportsTeam,
      command: def.command,
      args: def.args,
      modes: def.modes as any,
    });
  }
  // Load user-defined agents from legacy config
  try {
    if (fs.existsSync(AGENTS_CONFIG_PATH)) {
      const raw = fs.readFileSync(AGENTS_CONFIG_PATH, "utf8");
      const custom: AgentMetadata[] = JSON.parse(raw);
      for (const c of custom) {
        c.agentSource = "custom";
        c.available = checkCommandAvailable(c.command || "");
        agents.push(c);
      }
    }
  } catch (e: any) { logger.warn("Failed to load legacy agents config", e?.message || String(e)); }
  discoveryCache = { agents, timestamp: now };
  return agents;
}

export function saveCustomAgent(agent: AgentMetadata): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const existing: AgentMetadata[] = [];
  try {
    if (fs.existsSync(AGENTS_CONFIG_PATH)) {
      existing.push(...JSON.parse(fs.readFileSync(AGENTS_CONFIG_PATH, "utf8")));
    }
  } catch (e: any) { logger.warn("Failed to read existing agents config", e?.message || String(e)); }
  const idx = existing.findIndex(a => a.id === agent.id);
  if (idx >= 0) existing[idx] = agent;
  else existing.push(agent);
  fs.writeFileSync(AGENTS_CONFIG_PATH, JSON.stringify(existing, null, 2), "utf8");
  discoveryCache = null;
}

export function removeCustomAgent(agentId: string): boolean {
  try {
    if (!fs.existsSync(AGENTS_CONFIG_PATH)) return false;
    const existing: AgentMetadata[] = JSON.parse(fs.readFileSync(AGENTS_CONFIG_PATH, "utf8"));
    const filtered = existing.filter(a => a.id !== agentId);
    if (filtered.length === existing.length) return false;
    fs.writeFileSync(AGENTS_CONFIG_PATH, JSON.stringify(filtered, null, 2), "utf8");
    discoveryCache = null;
    return true;
  } catch {
    return false;
  }
}

interface AcpSessionState {
  process: ChildProcess;
  sessionId: string;
  agentId: string;
  config: AcpSessionConfig;
  capabilities: AcpCapabilities | null;
  rl: readline.Interface;
  pendingResolve: ((value: any) => void) | null;
  buffer: string;
}

const activeSessions = new Map<string, AcpSessionState>();

function generateSessionId(): string {
  return `acp_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

export async function spawnAgentSession(
  agentId: string,
  config: AcpSessionConfig
): Promise<AcpSessionInfo> {
  const agents = discoverAgents();
  const agent = agents.find(a => a.id === agentId);
  if (!agent) throw new NotFoundError("Agent", agentId);
  if (!agent.available) throw new ConfigurationError(`Agent '${agentId}' is not available on this system`);

  const sessionId = generateSessionId();
  const cmd = agent.command!;
  const args = [...(agent.args || [])];

  const proc = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...agent.env },
    cwd: config.workspace || process.cwd(),
  });

  const rl = readline.createInterface({ input: proc.stdout!, terminal: false });
  const session: AcpSessionState = {
    process: proc,
    sessionId,
    agentId,
    config,
    capabilities: null,
    rl,
    pendingResolve: null,
    buffer: "",
  };

  activeSessions.set(sessionId, session);

  const info: AcpSessionInfo = {
    sessionId,
    agentId,
    status: "idle",
    config,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };

  return info;
}

export function listSessions(): AcpSessionInfo[] {
  const result: AcpSessionInfo[] = [];
  for (const [sessionId, state] of activeSessions) {
    result.push({
      sessionId,
      agentId: state.agentId,
      status: state.process.killed ? "error" : "running",
      config: state.config,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
  }
  return result;
}

export async function closeSession(sessionId: string): Promise<void> {
  const state = activeSessions.get(sessionId);
  if (!state) return;
  state.rl.close();
  if (!state.process.killed) {
    state.process.kill("SIGTERM");
    setTimeout(() => {
      if (!state.process.killed) state.process.kill("SIGKILL");
    }, 5000);
  }
  activeSessions.delete(sessionId);
}

export function closeAllSessions(): void {
  for (const [id] of activeSessions) closeSession(id);
}

export function getAgentLabel(agentId: string): string {
  const agents = discoverAgents();
  return agents.find(a => a.id === agentId)?.name || agentId;
}
