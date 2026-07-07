import path from "node:path";
import os from "node:os";

const PI_DIR = path.join(os.homedir(), ".pi", "agent");

export const PATHS = {
  PI_DIR,
  AGENTS: path.join(PI_DIR, "agents"),
  CONVERSATIONS: path.join(PI_DIR, "conversations"),
  CHECKPOINTS: path.join(PI_DIR, "checkpoints"),
  COSTS: path.join(PI_DIR, "costs"),
  CUSTOM_TOOLS: path.join(PI_DIR, "custom-tools"),
  DAEMON_STATE: path.join(PI_DIR, "daemon-state.json"),
  LOGS: path.join(PI_DIR, "logs"),
  MCP_SERVERS: path.join(PI_DIR, "mcp-servers.json"),
  MEMORIES: path.join(PI_DIR, "memories"),
  MEMORY: path.join(PI_DIR, "memory"),
  MEMORY_DEBUG: path.join(PI_DIR, "memory-debug.log"),
  MIGRATIONS: path.join(PI_DIR, "migrations"),
  PLUGINS: path.join(PI_DIR, "plugins"),
  SECURITY_STATE: path.join(PI_DIR, "security-state.json"),
  SESSION_DB: path.join(PI_DIR, "session-state.db"),
  SETTINGS: path.join(PI_DIR, "settings.json"),
  SKILLS: path.join(PI_DIR, "skills"),
  SOUL: path.join(PI_DIR, "SOUL.md"),
  SYSTEM_DB: path.join(PI_DIR, "system.db"),
  VAULT: path.join(PI_DIR, ".vault"),
  VERBS: path.join(PI_DIR, "verbs.json"),
  WORK_PRODUCTS: path.join(PI_DIR, "work-products"),
  INITIATIVE_STATE: path.join(PI_DIR, "initiative-state.json"),
  SECURITY_SCANS: path.join(PI_DIR, "security-scans"),
  TELEMETRY: path.join(PI_DIR, "telemetry"),
} as const;

export const PI_SKILLS_AGENT_DIR = path.join(os.homedir(), ".pi", "skills", "agent");
