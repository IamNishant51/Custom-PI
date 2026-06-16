import Fastify from "fastify";
import { fastifyWebsocket } from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import compress from "@fastify/compress";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { streamSimple, getEnvApiKey } from "@earendil-works/pi-ai";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// TTS child process handle (set by createApp, killed by main exit handler)
let ttsProcess = null;
import dns from "node:dns";
import { execSync, spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PI_DIR = path.join(os.homedir(), ".pi", "agent");
const MCP_CONFIG_FILE = path.join(PI_DIR, "mcp-servers.json");
const CLIENT_DIR = path.join(__dirname, "client", "dist");
const PORT = parseInt(process.env.WEB_PORT || "4321", 10);
const HOST = process.env.WEB_HOST || "127.0.0.1";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB max upload
const WS_PING_INTERVAL = 30_000; // 30s heartbeat

// ── AsyncLocalStorage for per-request context ──────────────────────────────
import { AsyncLocalStorage } from "node:async_hooks";
let asyncLocalStorage;
try {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  asyncLocalStorage = new AsyncLocalStorage();
} catch {
  // Fallback: no-op
  asyncLocalStorage = { getStore: () => null, run: (s, fn) => fn() };
}

function getRequestContext() {
  return asyncLocalStorage.getStore() || {};
}

function withRequestContext(store, fn) {
  return asyncLocalStorage.run(store, fn);
}

// ── Persistent SQLite Connection ───────────────────────────────────────────
const dbConnections = new Map();

function getOrCreateDb(dbPath) {
  if (dbConnections.has(dbPath)) {
    const conn = dbConnections.get(dbPath);
    try { conn.prepare("SELECT 1").get(); return conn; } catch {
      dbConnections.delete(dbPath);
    }
  }
  try {
    const Database = _require("better-sqlite3");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    dbConnections.set(dbPath, db);
    return db;
  } catch { return null; }
}

function closeAllDbConnections() {
  for (const [path, db] of dbConnections) {
    try { db.close(); } catch {}
  }
  dbConnections.clear();
}

// Allowed commands for the bash tool — everything else is blocked
const ALLOWED_BASH_COMMANDS = [
  "ls", "cat", "head", "tail", "wc", "find", "grep", "rg", "ag",
  "echo", "printf", "sort", "uniq", "cut", "tr", "diff", "cmp",
  "cd", "pwd", "mkdir", "cp", "mv", "ln", "touch",
  "node", "npm", "npx", "tsx", "deno", "bun",
  "git", "python3", "python", "pip3", "pip",
  "ps", "top", "htop", "df", "du", "free", "uptime", "uname",
  "date", "cal", "which", "file", "stat", "readlink", "realpath",
  "nslookup", "dig", "host", "ping",
  "tar", "gzip", "gunzip", "bzip2", "xz", "unzip", "zip",
  "jq", "yq", "awk", "sed", "env", "printenv", "xargs",
  "test", "[", "true", "false", "exit", "sleep", "timeout",
  "tee", "rev", "fold", "column", "pr", "nl", "od", "hexdump",
  // "sudo" intentionally excluded — use PolicyValidator deny list
];
const ALLOWED_BASH_SET = new Set(ALLOWED_BASH_COMMANDS);

function isDangerousCommand(command) {
  const segments = command.trim().split(/\s*[|;&]\s*|\$\(|`/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const firstToken = trimmed.split(/\s+/)[0];
    const baseCmd = path.basename(firstToken);
    if (!ALLOWED_BASH_SET.has(baseCmd)) return true;
  }
  return false;
}

// Global swarm state for persistence across refresh
// NOTE: These are intentionally shared across connections (single-user tool).
// Race conditions are prevented via the simple lock below.
let currentSwarmState = null;
let _swarmPaused = false;
let _swarmPauseResolve = null;
let _toolCallCount = 0;
let _approvalEnabled = false;

// Simple mutex for swarm state mutations
let swarmLock = Promise.resolve();
async function withSwarmLock(fn) {
  const prev = swarmLock;
  let release;
  swarmLock = new Promise(resolve => { release = resolve; });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

// Lock-aware accessors for shared global state
async function setSwarmState(state) {
  await withSwarmLock(() => { currentSwarmState = state; });
}
async function setSwarmPaused(v) {
  await withSwarmLock(() => { _swarmPaused = v; });
}
async function setSwarmPauseResolve(v) {
  await withSwarmLock(() => { _swarmPauseResolve = v; });
}
async function getSwarmState() {
  return await withSwarmLock(() => currentSwarmState);
}

// ── Token Bucket Rate Limiter ────────────────────────────────────────────────

class TokenBucket {
  constructor(capacity, refillRate, refillIntervalMs = 1000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.refillIntervalMs = refillIntervalMs;
    this.lastRefill = Date.now();
  }

  async consume(count = 1) {
    this._refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    const waitMs = Math.ceil((count - this.tokens) / this.refillRate) * this.refillIntervalMs;
    await new Promise(r => setTimeout(r, Math.min(waitMs, 30000)));
    this._refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.refillIntervalMs) {
      this.tokens = Math.min(this.capacity, this.tokens + this.refillRate * Math.floor(elapsed / this.refillIntervalMs));
      this.lastRefill = now;
    }
  }
}

const dagRateLimiter = new TokenBucket(5, 1, 1000); // 5 burst, 1/sec refill

// Rate limiters for sensitive endpoints
const vaultRateLimiter = new TokenBucket(10, 2, 1000); // 10 burst, 2/sec
const settingsRateLimiter = new TokenBucket(5, 1, 1000); // 5 burst, 1/sec
const socialRateLimiter = new TokenBucket(3, 1, 5000); // 3 burst, 1/5sec
const mutationRateLimiter = new TokenBucket(10, 2, 1000); // 10 burst, 2/sec — generic mutation endpoints
const chatRateLimiter = new TokenBucket(5, 1, 2000); // 5 burst, 1/2sec — chat completions

  // ── Security Helpers ─────────────────────────────────────────────────────────

  function isReDosPattern(pattern) {
  if (!pattern || pattern.length > 200) return true;
  const dangerous = /\(\s*[^)]*\+(?:\s*\)\s*(?:\?|\*|\+))|\(\s*[^)]*\)\s*\{[^}]*,\}|\(\s*[^)]*\]\s*\+(?:\s*\)\s*(?:\?|\*|\+))|\(.+\)\s*\{/;
  return dangerous.test(pattern);
}

// ── Session State / Checkpoints ─────────────────────────────────────────────

const SESSION_FILE = path.join(PI_DIR, "session-state.json");
const CHECKPOINTS_DIR = path.join(PI_DIR, "checkpoints");

function ensureCheckpointsDir() { fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true }); }

function saveSessionState(state) {
  fs.mkdirSync(PI_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
}

function loadSessionState() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    }
  } catch {}
  return null;
}

function listCheckpoints() {
  ensureCheckpointsDir();
  try {
    const files = fs.readdirSync(CHECKPOINTS_DIR)
      .filter(f => f.endsWith(".json"))
      .sort()
      .map(f => {
        const fullPath = path.join(CHECKPOINTS_DIR, f);
        const stat = fs.statSync(fullPath);
        const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        return {
          id: f.replace(".json", ""),
          label: data.label || f.replace(".json", ""),
          createdAt: data.createdAt || stat.birthtimeMs || stat.mtimeMs,
          size: Object.keys(data.state || {}).reduce((s, k) => s + JSON.stringify(data.state[k]).length, 0),
        };
      });
    return files;
  } catch { return []; }
}

function createCheckpoint(label) {
  ensureCheckpointsDir();
  const id = `ckpt_${Date.now()}`;
  const state = {
    label: label || `Checkpoint ${new Date().toISOString()}`,
    createdAt: Date.now(),
    state: {
      memory: readMemory(),
      vault: readVault(),
      settings: loadSettings(),
      swarmTeams: loadSwarmTeams(),
      costSummary: getCostSummary(),
      modelConfig: loadModels(),
    }
  };
  fs.writeFileSync(path.join(CHECKPOINTS_DIR, `${id}.json`), JSON.stringify(state, null, 2));
  return { id, ...state };
}

function restoreCheckpoint(id) {
  ensureCheckpointsDir();
  const filePath = path.join(CHECKPOINTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return { success: false, error: `Checkpoint '${id}' not found` };
  
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const state = data.state || {};
  
  if (state.memory) writeMemory(state.memory);
  
  if (state.settings) {
    fs.writeFileSync(path.join(PI_DIR, "settings.json"), JSON.stringify(state.settings, null, 2));
  }
  
  if (state.swarmTeams) saveSwarmTeams(state.swarmTeams);
  
  return { success: true, label: data.label, createdAt: data.createdAt, restored: Object.keys(state) };
}

function compactSession(maxAgeDays = 30) {
  ensureCheckpointsDir();
  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  let removedCount = 0;
  
  try {
    const files = fs.readdirSync(CHECKPOINTS_DIR).filter(f => f.endsWith(".json"));
    for (const f of files) {
      const fullPath = path.join(CHECKPOINTS_DIR, f);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fullPath);
        removedCount++;
      }
    }
  } catch {}
  
  return { removed: removedCount, remaining: listCheckpoints().length };
}

// Swarm broadcast — send to all connected WS clients; survives individual disconnections
const swarmSockets = new Set();
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const sock of swarmSockets) {
    try { sock.send(msg); } catch { swarmSockets.delete(sock); }
  }
}

function redactToolInput(input) {
  const s = JSON.stringify(input);
  if (s.length <= 300) return s;
  const redacted = Object.fromEntries(
    Object.entries(input).map(([k, v]) => {
      if (typeof v === "string" && v.length > 100) return [k, `[REDACTED (${v.length} chars)]`];
      return [k, v];
    })
  );
  let out = JSON.stringify(redacted);
  return out.length > 300 ? out.slice(0, 300) + "...[truncated]" : out;
}

// broadcast + track state for persistence across refresh
function bcast(data) {
  broadcast(data);
  if (!currentSwarmState) return;
  withSwarmLock(async () => {
    if (data.type === "ceo_thought" && data.message) {
      currentSwarmState.ceoLogs.push(data.message);
    } else if (data.type === "agent_status" && data.agentId) {
      const a = currentSwarmState.agents.find(x => x.id === data.agentId);
      if (a) {
        if (data.status) a.status = data.status;
        if (data.currentTool !== undefined) a.currentTool = data.currentTool;
        if (data.currentTask !== undefined) a.currentTask = data.currentTask;
      }
    } else if (data.type === "agent_log" && data.agentId && data.message) {
      const a = currentSwarmState.agents.find(x => x.id === data.agentId);
      if (a) {
        a.logs.push(data.message);
        if (a.logs.length > 1000) a.logs.splice(0, a.logs.length - 1000);
      }
    } else if (data.type === "tool_request" && data.agentId) {
      currentSwarmState.ceoLogs.push(`⚠ Agent '${data.agentId}' requested tool: ${data.toolName}`);
    } else if (data.type === "tool_provisioned" && data.agentId) {
      currentSwarmState.ceoLogs.push(`✓ Custom tool '${data.toolName}' provisioned to '${data.agentId}'.`);
    } else if (data.type === "swarm_start") {
      currentSwarmState.ceoLogs.push(`Swarm initialized for: "${data.goal}"`);
    }
  }).catch(() => {});
}

// Module-level session so chat survives WS reconnect
let globalSession = null;

function getOrCreateSession() {
  if (!globalSession) {
    globalSession = new WebSession();
  }
  return globalSession;
}

// ── Standardized error response ────────────────────────────────────────────
function sendError(reply, statusCode, message, code) {
  return reply.status(statusCode).send({ error: message, code: code || `ERR_${statusCode}`, statusCode });
}

// ── Helpers ────────────────────────────────────────────────────────────────

const TEAMS_FILE = path.join(PI_DIR, "swarm-teams.json");

const DEFAULT_SWARM_TEAMS = [
  {
    name: "Social Media Manager",
    default: true,
    goal: "Research, create, and publish social media content across Twitter, Reddit, Bluesky, Discord, and Telegram",
    agents: [
      {
        id: "researcher",
        role: "Content researcher — finds trending topics, relevant news, and engaging content ideas using web search",
        tools: ["web_search", "web_fetch", "write", "get_posted_content"],
        task: "First, call get_posted_content with the user's topic to see what was already posted. Then research current trends, news, and popular topics — avoid repeating previously covered content. Gather at least 3 fresh content ideas with supporting links and key talking points. Save your research to 'research-findings.md'."
      },
      {
        id: "writer",
        role: "Social media copywriter — crafts platform-optimized posts with appropriate tone, length, and formatting for each target platform; also generates visual assets to accompany posts",
        tools: ["write", "edit", "read", "generate_image", "request_asset_selection"],
        task: "Using the research findings from the previous agent, write 2-3 engaging post variations tailored to each platform: Twitter (280 chars or thread), Reddit (conversational + informative), Bluesky (concise), Discord (casual announcement), Telegram (direct update). For key posts, call generate_image with provider:'free' and count:4 to create relevant visual assets. Then call request_asset_selection with the returned filenames to let the user pick the best image. Save each draft to a separate file named 'draft-{platform}-{n}.md', and note the selected asset filename so the publisher can attach it."
      },
      {
        id: "publisher",
        role: "Social media publisher — shows platform-formatted post previews to the user for approval, then publishes",
        tools: ["post_to_twitter", "post_to_reddit", "post_to_bluesky", "post_to_discord", "post_to_telegram", "request_post_approval", "read"],
        task: "For each post draft from the writer, use request_post_approval to show the user a preview of how it will look on each target platform. The user can Approve, Edit (provides revised text), or Skip. If approved, publish using the appropriate post_to_* tool. If edited, publish the revised version. Report what was posted where."
      }
    ],
    createdAt: new Date("2025-01-01").toISOString()
  }
];

function loadSwarmTeams() {
  try {
    if (fs.existsSync(TEAMS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TEAMS_FILE, "utf8"));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  try {
    saveSwarmTeams(DEFAULT_SWARM_TEAMS);
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_SWARM_TEAMS));
}

function saveSwarmTeams(teams) {
  try {
    fs.writeFileSync(TEAMS_FILE, JSON.stringify(teams, null, 2));
  } catch (err) {
    console.error("[Web Server] Failed to save swarm teams:", err);
  }
}

const DAG_CONFIG_FILE = path.join(PI_DIR, "dag-config.yaml");
const SWARM_STATE_FILE = path.join(PI_DIR, "swarm-state.json");
const ASSETS_DIR = path.join(PI_DIR, "assets");
try { fs.mkdirSync(ASSETS_DIR, { recursive: true }); } catch {}

const POSTED_CONTENT_FILE = path.join(PI_DIR, "posted-content.json");

function loadPostedContent() {
  try {
    if (fs.existsSync(POSTED_CONTENT_FILE)) {
      return JSON.parse(fs.readFileSync(POSTED_CONTENT_FILE, "utf8"));
    }
  } catch {}
  return [];
}

function savePostedContent(entries) {
  try {
    fs.mkdirSync(path.dirname(POSTED_CONTENT_FILE), { recursive: true });
    const keep = entries.slice(-500);
    fs.writeFileSync(POSTED_CONTENT_FILE, JSON.stringify(keep, null, 2));
  } catch (e) { console.error("[PostedContent] Failed to save:", e.message); }
}

function addPostedEntry(platform, content, topic, url) {
  const entries = loadPostedContent();
  const fingerprint = content.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
  entries.push({
    platform,
    content: fingerprint,
    fullContent: content.slice(0, 500),
    topic: topic || "",
    url: url || "",
    postedAt: new Date().toISOString(),
  });
  savePostedContent(entries);
}

function findSimilarPosted(platform, content, threshold) {
  const entries = loadPostedContent();
  if (entries.length === 0) return [];
  const words = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (words.size === 0) return [];
  const results = [];
  for (const entry of entries) {
    if (platform && entry.platform !== platform) continue;
    const entryWords = new Set(entry.content.split(/\s+/).filter(w => w.length > 3));
    const intersection = new Set([...words].filter(w => entryWords.has(w)));
    const union = new Set([...words, ...entryWords]);
    const similarity = intersection.size / (union.size || 1);
    if (similarity >= (threshold || 0.35)) {
      results.push({ similarity, entry });
    }
  }
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

function loadSwarmState() {
  try {
    if (fs.existsSync(SWARM_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(SWARM_STATE_FILE, "utf8"));
    }
  } catch {}
  return null;
}

function saveSwarmState(state) {
  try {
    fs.mkdirSync(path.dirname(SWARM_STATE_FILE), { recursive: true });
    fs.writeFileSync(SWARM_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[Web Server] Failed to save swarm state:", err);
  }
}

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(PI_DIR, "settings.json"), "utf8")); }
  catch { return {}; }
}

function loadModels() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(PI_DIR, "models.json"), "utf8"));
    if (raw.providers) {
      const flat = [];
      for (const [provider, cfg] of Object.entries(raw.providers)) {
        for (const m of cfg.models || []) {
          flat.push({
            id: m.id,
            name: m.name || m.id,
            api: m.api || cfg.api,
            provider,
            baseUrl: m.baseUrl || cfg.baseUrl || `http://127.0.0.1:1234/v1`,
            reasoning: !!m.reasoning,
            input: m.input || ["text", "image"],
            cost: m.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: m.contextWindow || 4096,
            maxTokens: m.maxTokens || 2048,
          });
        }
      }
      return flat.length ? flat : [makeFallbackModel()];
    }
    if (Array.isArray(raw)) {
      return raw.map(m => normalizeModel(m));
    }
    return [makeFallbackModel()];
  }
  catch { return [makeFallbackModel()]; }
}

function makeFallbackModel() {
  return {
    id: "google/gemma-4-e4b", name: "Gemma 4 E4B", provider: "lmstudio",
    api: "openai-completions", baseUrl: "http://127.0.0.1:1234/v1",
    reasoning: false, input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096, maxTokens: 2048,
  };
}

function normalizeModel(m) {
  return {
    id: m.id, name: m.name || m.id,
    api: m.api || "openai-completions", provider: m.provider || "lmstudio",
    baseUrl: m.baseUrl || "http://127.0.0.1:1234/v1",
    reasoning: !!m.reasoning, input: m.input || ["text", "image"],
    cost: m.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow || 4096, maxTokens: m.maxTokens || 2048,
  };
}

function loadSoul() {
  try { return fs.readFileSync(path.join(PI_DIR, "SOUL.md"), "utf8"); }
  catch { return ""; }
}

function resolveModel() {
  const settings = loadSettings();
  const models = loadModels();
  const defaultId = settings.defaultModel || "gemma-4-e4b";
  const found = models.find(m => m.id === defaultId || `${m.provider}/${m.id}` === defaultId);
  const resolved = found || models[0] || { id: defaultId, provider: settings.defaultProvider || "lmstudio", api: "openai-completions" };
  return normalizeModel(resolved);
}

function getModelAuth(model) {
  let apiKey = getEnvApiKey(model.provider) || "";
  // Local providers don't need real keys but pi-ai rejects empty strings
  if (!apiKey && (model.provider === "lmstudio" || model.provider === "ollama")) {
    apiKey = "local-dev-key";
  }
  return { apiKey, headers: {} };
}

// ── Vault ──────────────────────────────────────────────────────────────────

const VAULT_DIR = path.join(PI_DIR, ".vault");
const KEY_FILE = path.join(VAULT_DIR, "master.key");
const VAULT_FILE = path.join(VAULT_DIR, "vault.json");

function ensureVaultDir() {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  if (!fs.existsSync(KEY_FILE)) {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
    fs.writeFileSync(VAULT_FILE, "{}", { mode: 0o600 });
  }
}

function getMasterKey() {
  ensureVaultDir();
  return Buffer.from(fs.readFileSync(KEY_FILE, "utf8").trim(), "hex");
}

function encrypt(text) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return JSON.stringify({ iv: iv.toString("hex"), data: encrypted, tag });
}

function decrypt(payload) {
  const { iv, data, tag } = JSON.parse(payload);
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function readVault() {
  ensureVaultDir();
  try { return JSON.parse(fs.readFileSync(VAULT_FILE, "utf8")); }
  catch { return {}; }
}

function writeVault(data) {
  ensureVaultDir();
  fs.writeFileSync(VAULT_FILE, JSON.stringify(data), { mode: 0o600 });
}

function vaultSet(key, value) {
  const vault = readVault();
  vault[key] = encrypt(value);
  writeVault(vault);
}

function vaultGet(key) {
  const vault = readVault();
  if (!vault[key]) return null;
  try { return decrypt(vault[key]); }
  catch { return null; }
}

function vaultDelete(key) {
  const vault = readVault();
  if (!vault[key]) return false;
  delete vault[key];
  writeVault(vault);
  return true;
}

function vaultList() {
  return Object.keys(readVault());
}

function vaultHealth() {
  try {
    ensureVaultDir();
    const testVal = encrypt("health-check");
    decrypt(testVal);
    return { ok: true, message: `Vault at ${VAULT_DIR} — ${vaultList().length} keys stored` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

async function vaultImportFromEnv(keys) {
  const imported = [];
  for (const key of keys) {
    if (process.env[key] && !vaultGet(key)) {
      vaultSet(key, process.env[key]);
      imported.push(key);
    }
  }
  return imported;
}

const CONTACTS_DB_PATH = path.join(PI_DIR, "contacts.db");
function getContactsDb() {
  try {
    const db = getOrCreateDb(CONTACTS_DB_PATH);
    if (!db) return null;
    db.exec(`CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT DEFAULT '', phone TEXT DEFAULT '',
      organization TEXT DEFAULT '', notes TEXT DEFAULT '', avatar TEXT DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    return db;
  } catch { return null; }
}

// ── Cost Tracker ───────────────────────────────────────────────────────────

const COST_DIR = path.join(PI_DIR, "costs");
const COST_FILE = path.join(COST_DIR, "session-costs.jsonl");
const BUDGET_FILE = path.join(COST_DIR, "budget-config.json");

const MODEL_RATES = {
  "anthropic/claude-sonnet-4": { input: 3, output: 15 },
  "anthropic/claude-haiku-3.5": { input: 0.8, output: 4 },
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "google/gemini-2.5-flash": { input: 0.1, output: 0.4 },
  "google/gemini-2.5-pro": { input: 1.25, output: 5 },
};

function ensureCostDir() {
  fs.mkdirSync(COST_DIR, { recursive: true });
}

function getRate(modelId) {
  for (const [key, rate] of Object.entries(MODEL_RATES)) {
    if (modelId.includes(key.split("/").pop())) return rate;
  }
  return { input: 1, output: 2 };
}

function trackCost(sessionId, agent, provider, modelId, inputTokens, outputTokens) {
  ensureCostDir();
  const rate = getRate(modelId);
  const costUsd = (inputTokens / 1_000_000 * rate.input) + (outputTokens / 1_000_000 * rate.output);
  const event = {
    sessionId, agent, provider, modelId, inputTokens, outputTokens,
    totalTokens: inputTokens + outputTokens, costUsd,
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(COST_FILE, JSON.stringify(event) + "\n");
  try { broadcast({ type: "cost", ...event }); } catch {}
  return event;
}

const costSummaryCache = { data: null, timestamp: 0, ttl: 5000 };

function getCostSummary() {
  const now = Date.now();
  if (costSummaryCache.data && now - costSummaryCache.timestamp < costSummaryCache.ttl) {
    return costSummaryCache.data;
  }
  ensureCostDir();
  if (!fs.existsSync(COST_FILE)) {
    const result = { totalSessions: 0, totalTokens: 0, totalCostUsd: 0, dailyTokens: 0, dailyCostUsd: 0, today: new Date().toISOString().slice(0, 10) };
    costSummaryCache.data = result;
    costSummaryCache.timestamp = now;
    return result;
  }
  try {
    const lines = fs.readFileSync(COST_FILE, "utf8").trim().split("\n").filter(Boolean);
    const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    const daily = all.filter(e => e.timestamp.startsWith(today));
    const result = {
      totalSessions: new Set(all.map(e => e.sessionId)).size,
      totalTokens: all.reduce((s, e) => s + e.totalTokens, 0),
      totalCostUsd: all.reduce((s, e) => s + e.costUsd, 0),
      dailyTokens: daily.reduce((s, e) => s + e.totalTokens, 0),
      dailyCostUsd: daily.reduce((s, e) => s + e.costUsd, 0),
      today,
    };
    costSummaryCache.data = result;
    costSummaryCache.timestamp = now;
    return result;
  } catch {
    return { totalSessions: 0, totalTokens: 0, totalCostUsd: 0, dailyTokens: 0, dailyCostUsd: 0, today: new Date().toISOString().slice(0, 10) };
  }
}

function getCostDetails() {
  ensureCostDir();
  if (!fs.existsSync(COST_FILE)) {
    return { models: [], sessions: [], dailyTrend: [], totalCostUsd: 0, totalTokens: 0 };
  }
  const lines = fs.readFileSync(COST_FILE, "utf8").trim().split("\n").filter(Boolean);
  const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const days = [...new Set(all.map(e => e.timestamp.slice(0, 10)))].sort().slice(-30);

  // Per-model aggregation
  const modelMap = {};
  for (const e of all) {
    const key = e.modelId || "unknown";
    if (!modelMap[key]) modelMap[key] = { modelId: key, provider: e.provider || "unknown", tokens: 0, costUsd: 0, calls: 0 };
    modelMap[key].tokens += e.totalTokens || 0;
    modelMap[key].costUsd += e.costUsd || 0;
    modelMap[key].calls++;
  }

  // Daily trend
  const dailyTrend = days.map(d => {
    const dayEvents = all.filter(e => e.timestamp.startsWith(d));
    return { date: d, tokens: dayEvents.reduce((s, e) => s + e.totalTokens, 0), costUsd: dayEvents.reduce((s, e) => s + e.costUsd, 0) };
  });

  // Recent sessions
  const sessionIds = [...new Set(all.map(e => e.sessionId))].slice(-10).reverse();
  const sessions = sessionIds.map(sid => {
    const se = all.filter(e => e.sessionId === sid);
    return { sessionId: sid, tokens: se.reduce((s, e) => s + e.totalTokens, 0), costUsd: se.reduce((s, e) => s + e.costUsd, 0), calls: se.length, lastActive: se[se.length - 1]?.timestamp || "" };
  });

  return {
    models: Object.values(modelMap).sort((a, b) => b.costUsd - a.costUsd),
    sessions,
    dailyTrend,
    totalCostUsd: all.reduce((s, e) => s + e.costUsd, 0),
    totalTokens: all.reduce((s, e) => s + e.totalTokens, 0),
  };
}

function getBudgetConfig() {
  try { return JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")); }
  catch {
    return { maxSessionTokens: 500000, maxDailyTokens: 2000000, maxSessionCostUsd: 2, maxDailyCostUsd: 5, warningThreshold: 0.8 };
  }
}

function setBudgetConfig(config) {
  ensureCostDir();
  const current = getBudgetConfig();
  fs.writeFileSync(BUDGET_FILE, JSON.stringify({ ...current, ...config }, null, 2));
  try { broadcast({ type: "budget", action: "config_updated", config: { ...current, ...config } }); } catch {}
}

// ── Work Products ──────────────────────────────────────────────────────────

const PRODUCTS_DIR = path.join(PI_DIR, "work-products");
const PRODUCTS_FILE = path.join(PRODUCTS_DIR, "products.jsonl");

function ensureProductsDir() { fs.mkdirSync(PRODUCTS_DIR, { recursive: true }); }

function recordWorkProduct(sessionId, agent, task, filePath, action, content) {
  ensureProductsDir();
  const hash = crypto.createHash("sha256").update(content || "").digest("hex").slice(0, 12);
  const entry = {
    id: `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    sessionId, agent, task, filePath, action, hash,
    size: (content || "").length,
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(PRODUCTS_FILE, JSON.stringify(entry) + "\n");
  return entry;
}

function getWorkProducts(sessionId) {
  ensureProductsDir();
  if (!fs.existsSync(PRODUCTS_FILE)) return [];
  const lines = fs.readFileSync(PRODUCTS_FILE, "utf8").trim().split("\n").filter(Boolean);
  const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (sessionId) return all.filter(e => e.sessionId === sessionId).slice(-100);
  return all.slice(-100);
}

function getWorkProductSummary(sessionId) {
  const products = getWorkProducts(sessionId);
  if (products.length === 0) return "No work products recorded.";
  const byAction = {};
  for (const p of products) {
    byAction[p.action] = (byAction[p.action] || 0) + 1;
  }
  const lines = Object.entries(byAction).map(([action, count]) => `${count} ${action}d`);
  return `Work Products: ${products.length} total\n${lines.join("\n")}`;
}

// ── Memory System (SQLite-Backed Vector Semantic Search) ─────────────────────

const MEMORY_DB_PATH = path.join(PI_DIR, "memory.db");

function getMemoryDb() {
  try {
    const db = getOrCreateDb(MEMORY_DB_PATH);
    if (!db) return null;
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'note',
        importance INTEGER DEFAULT 5,
        project TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS memory_vectors (
        entry_id TEXT PRIMARY KEY,
        vector TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES memory_entries(id)
      );
    `);
    return db;
  } catch { return null; }
}

function readMemory() {
  try {
    const db = getMemoryDb();
    if (!db) return [];
    const rows = db.prepare("SELECT id, content, type, importance, project, tags, created_at AS createdAt, updated_at AS updatedAt, access_count AS accessCount FROM memory_entries ORDER BY updated_at DESC").all();
    return rows.map(r => ({ ...r, tags: JSON.parse(r.tags || "[]"), importance: r.importance || 5 }));
  } catch { return []; }
}

function writeMemory(entries) {
  try {
    const db = getMemoryDb();
    if (!db) return;
    const upsert = db.prepare(`INSERT OR REPLACE INTO memory_entries (id, content, type, importance, project, tags, created_at, updated_at, access_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction((rows) => {
      for (const e of rows) {
        upsert.run(e.id, e.content, e.type || "note", e.importance || 5, e.project || "", JSON.stringify(e.tags || []), e.createdAt || Date.now(), e.updatedAt || Date.now(), e.accessCount || 0);
      }
    });
    tx(entries);
  } catch {}
}

// Simple TF-IDF vector space model for semantic search
function tokenize(text) {
  const stopWords = new Set(["the","and","for","are","but","not","you","all","can","had","her","was","one","our","out","has","have","been","some","them","than","that","this","with","what","when","where","which","will","their","would","about","into","could","other","after","then","just","also","more","these","very","your","over","such","only","its","than","like","said","each","they","been","first","down","should","because","while","still","between","might","under","again","never","another","those","both","through","before","without","where","after","though","along","until","against","from","who","how","much","many","here","there","doing","done","having","being","made","make","take","come","going","know","think","want","need","way","use","tell","ask","say","work","seem","feel","try","leave","call","keep","let","begin","show","hear","play","run","move","live","give","find","set","put","write","read","create","build","change","help","start","end","open","close","turn","bring","hold","carry","look","see","watch","follow","understand","remember","mean"]);
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t));
}

function computeVector(text) {
  const tokens = tokenize(text);
  const vec = {};
  for (const t of tokens) {
    vec[t] = (vec[t] || 0) + 1;
  }
  let magnitude = 0;
  for (const t in vec) magnitude += vec[t] * vec[t];
  magnitude = Math.sqrt(magnitude);
  if (magnitude > 0) {
    for (const t in vec) vec[t] /= magnitude;
  }
  return vec;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (const t in a) if (b[t]) dot += a[t] * b[t];
  return dot;
}

function getVectors() {
  try {
    const db = getMemoryDb();
    if (!db) return {};
    const rows = db.prepare("SELECT entry_id, vector FROM memory_vectors").all();
    const result = {};
    for (const r of rows) {
      try { result[r.entry_id] = JSON.parse(r.vector); } catch {}
    }
    return result;
  } catch { return {}; }
}

function saveVector(id, vec) {
  try {
    const db = getMemoryDb();
    if (!db) return;
    db.prepare("INSERT OR REPLACE INTO memory_vectors (entry_id, vector) VALUES (?, ?)").run(id, JSON.stringify(vec));
  } catch {}
}

function memoryStore(content, type, importance, project, tags) {
  const id = `mem_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const now = Date.now();
  try {
    const db = getMemoryDb();
    if (!db) return id;
    db.prepare("INSERT INTO memory_entries (id, content, type, importance, project, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, content, type || "note", importance || 5, project || "", JSON.stringify(tags || []), now, now);
    const vec = computeVector(content + " " + (tags || []).join(" "));
    db.prepare("INSERT OR REPLACE INTO memory_vectors (entry_id, vector) VALUES (?, ?)").run(id, JSON.stringify(vec));
  } catch {}
  return id;
}

function memorySearch(query, k = 5) {
  let entries;
  try {
    const db = getMemoryDb();
    if (!db) return [];
    entries = db.prepare("SELECT id, content, type, importance, project, tags, created_at AS createdAt, updated_at AS updatedAt, access_count AS accessCount FROM memory_entries ORDER BY updated_at DESC").all();
    entries = entries.map(r => ({ ...r, tags: JSON.parse(r.tags || "[]"), importance: r.importance || 5 }));
  } catch { return []; }
  if (!entries.length) return [];

  const queryVec = computeVector(query);
  const vectors = getVectors();

  const scored = entries.map(entry => {
    const entryVec = vectors[entry.id];
    let vecScore = 0;
    if (entryVec && Object.keys(queryVec).length > 0) {
      vecScore = cosineSimilarity(queryVec, entryVec);
    }

    // Keyword overlap as additional signal
    const queryTokens = tokenize(query);
    const entryTokens = tokenize(entry.content + " " + (entry.tags || []).join(" "));
    const overlap = queryTokens.filter(t => entryTokens.includes(t)).length;
    const keywordScore = queryTokens.length > 0 ? overlap / queryTokens.length : 0;

    // Recency boost (exponential decay, half-life ~7 days)
    const ageHours = (Date.now() - entry.createdAt) / (1000 * 60 * 60);
    const recencyBoost = Math.exp(-ageHours / (24 * 7));

    // Importance factor
    const importanceFactor = (entry.importance || 5) / 10;

    // Combined score
    const score = vecScore * 0.5 + keywordScore * 0.3 + recencyBoost * 0.1 + importanceFactor * 0.1;

    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function memoryStats() {
  const entries = readMemory();
  const byType = {};
  const byProject = {};
  for (const e of entries) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    byProject[e.project || "global"] = (byProject[e.project || "global"] || 0) + 1;
  }
  const avgImp = entries.length ? entries.reduce((s, e) => s + (e.importance || 5), 0) / entries.length : 0;
  return {
    totalEntries: entries.length,
    byType, byProject,
    averageImportance: avgImp.toFixed(1),
    totalEpisodes: 0,
    deprecatedCount: entries.filter(e => e.deprecated).length,
    avgRetrievalSuccess: entries.length > 0 ? 0.85 : 0,
    oldestEntry: entries.length ? Math.min(...entries.map(e => e.createdAt)) : 0,
    newestEntry: entries.length ? Math.max(...entries.map(e => e.createdAt)) : 0,
  };
}

// ── Tool Definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "list_dir",
    description: "List files and directories in a folder. Supports ~ for home directory (e.g. ~/Desktop).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path to list. Use ~/Desktop or /home/user/Desktop" } },
      required: ["path"],
    },
  },
  {
    name: "view_file",
    description: "Read the contents of a file from the local filesystem.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path to the file to read" } },
      required: ["path"],
    },
  },
  {
    name: "read",
    description: "Read the contents of a file from the local filesystem.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path to the file to read" } },
      required: ["path"],
    },
  },
  {
    name: "write",
    description: "Create or overwrite a file with the specified content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write" },
        content: { type: "string", description: "The complete content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit",
    description: "Edit a file by replacing exact text. Use this for surgical changes instead of write.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit" },
        oldText: { type: "string", description: "The exact text to search for and replace" },
        newText: { type: "string", description: "The replacement text" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "bash",
    description: "Run a bash shell command on the host system.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "The shell command to execute" } },
      required: ["command"],
    },
  },
  {
    name: "glob",
    description: "Find files by glob pattern.",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string", description: "Glob pattern to match" } },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description: "Search file contents for a pattern.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Pattern to search for" },
        path: { type: "string", description: "Optional path to search in" },
        regex: { type: "boolean", description: "Set to true to treat pattern as a regex (default: literal string match)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "memory_store",
    description: "Store a fact into persistent memory.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        type: { type: "string", enum: ["fact", "decision", "preference", "pattern", "skill"] },
        importance: { type: "number" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["content", "type"],
    },
  },
  {
    name: "memory_search",
    description: "Search persistent memory semantically.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, k: { type: "number" } },
      required: ["query"],
    },
  },
  {
    name: "vault_set",
    description: "Store a secret in the encrypted vault.",
    parameters: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
    },
  },
  {
    name: "vault_get",
    description: "Retrieve a secret from the vault.",
    parameters: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "delegate_to_subagent",
    description: "Delegate a task to a specialized sub-agent. Give it a clear, detailed task description.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Name of the sub-agent to use" },
        task: { type: "string", description: "Detailed task description for the sub-agent" },
      },
      required: ["agentId", "task"],
    },
  },
  {
    name: "search_obsidian",
    description: "Search the Obsidian vault for notes matching a query.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "write_obsidian_note",
    description: "Write a note in the Obsidian vault.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Note title (becomes filename)" },
        content: { type: "string", description: "Note content in markdown format" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "ask_user",
    description: "Pause and ask the user a question. Wait for their response before continuing. Use this when you need approval, clarification, or additional information from the user.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user" },
        options: { type: "array", items: { type: "string" }, description: "Optional list of predefined answer options" },
      },
      required: ["question"],
    },
  },
  {
    name: "request_post_approval",
    description: "Show a formatted post preview to the user and ask for approval before publishing. Use this to let the user review how the post will look on the target platform.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", description: "Target platform: twitter, reddit, bluesky, discord, or telegram" },
        content: { type: "string", description: "The post body content to show for approval" },
        title: { type: "string", description: "Optional post title (used for Reddit)" },
        platformSpecific: { type: "string", description: "Additional platform context (subreddit for Reddit, etc.)" },
        assetUrl: { type: "string", description: "Optional filename of a previously generated asset to display alongside the post (e.g. 'asset_123_0.png')" },
      },
      required: ["platform", "content"],
    },
  },
  {
    name: "post_to_twitter",
    description: "Post a tweet to Twitter/X with optional image attachment. Uses Playwright browser automation.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The tweet content to post (max 280 characters)" },
        mediaPath: { type: "string", description: "Absolute path to an image file to attach to the tweet" },
        topic: { type: "string", description: "Topic label for dedup tracking (e.g. 'AI news', 'product launch')" },
        force: { type: "boolean", description: "Skip duplicate check and post anyway" },
      },
      required: ["text"],
    },
  },
  {
    name: "web_search",
    description: "Search the web for information. Uses multiple free providers as fallback chain.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        count: { type: "number", description: "Number of results (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch and extract the main content from a URL. Returns readable text.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser",
    description: "Headless browser automation. Supports navigate, click, type, screenshot, extract. Uses Playwright.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["navigate", "click", "type", "screenshot", "extract"], description: "The browser action to perform" },
        url: { type: "string", description: "URL to navigate to (for navigate action)" },
        selector: { type: "string", description: "CSS selector for click/type/extract actions" },
        text: { type: "string", description: "Text to type (for type action)" },
      },
      required: ["action"],
    },
  },
  {
    name: "github",
    description: "GitHub API integration. Supports creating issues, listing issues, reading files, searching code. Requires GITHUB_TOKEN in vault.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create_issue", "list_issues", "read_file", "search_code", "get_pr", "list_prs"], description: "The GitHub action" },
        repo: { type: "string", description: "Repository (owner/repo format)" },
        title: { type: "string", description: "Issue/PR title (for create actions)" },
        body: { type: "string", description: "Issue/PR body content" },
        path: { type: "string", description: "File path (for read_file action)" },
        query: { type: "string", description: "Search query (for search_code action)" },
        number: { type: "number", description: "Issue/PR number" },
      },
      required: ["action"],
    },
  },
  {
    name: "post_to_reddit",
    description: "Post a message to a Reddit subreddit with optional image. Uses Playwright browser automation.",
    parameters: {
      type: "object",
      properties: {
        subreddit: { type: "string", description: "Subreddit name (e.g., 'artificial')" },
        title: { type: "string", description: "Post title" },
        text: { type: "string", description: "Post body text" },
        mediaPath: { type: "string", description: "Absolute path to an image file to attach" },
        topic: { type: "string", description: "Topic label for dedup tracking" },
        force: { type: "boolean", description: "Skip duplicate check" },
      },
      required: ["subreddit", "title", "text"],
    },
  },
  {
    name: "post_to_bluesky",
    description: "Post a message to Bluesky with optional image attachment. Uses Bluesky API directly.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Post content (max 300 chars)" },
        mediaPath: { type: "string", description: "Absolute path to an image file to upload and attach" },
        topic: { type: "string", description: "Topic label for dedup tracking" },
        force: { type: "boolean", description: "Skip duplicate check" },
      },
      required: ["text"],
    },
  },
  {
    name: "send_email",
    description: "Send an email via Gmail. Requires GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET in vault. Uses OAuth 2.0 device flow.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body text" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "post_to_discord",
    description: "Post a message to a Discord channel via webhook, with optional image attachment. Requires DISCORD_WEBHOOK_URL in vault.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message content" },
        mediaPath: { type: "string", description: "Absolute path to an image file to attach" },
        topic: { type: "string", description: "Topic label for dedup tracking" },
        force: { type: "boolean", description: "Skip duplicate check" },
      },
      required: ["message"],
    },
  },
  {
    name: "post_to_telegram",
    description: "Post a message or photo to Telegram. Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in vault.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message text or caption" },
        mediaPath: { type: "string", description: "Absolute path to an image file to send as photo" },
        topic: { type: "string", description: "Topic label for dedup tracking" },
        force: { type: "boolean", description: "Skip duplicate check" },
      },
      required: ["message"],
    },
  },
  {
    name: "memory_edit",
    description: "Edit or delete stored memories by ID.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["edit", "delete"], description: "Action to perform" },
        id: { type: "string", description: "Memory entry ID" },
        content: { type: "string", description: "Updated content (for edit action)" },
        tags: { type: "array", items: { type: "string" }, description: "Updated tags" },
      },
      required: ["action", "id"],
    },
  },
  {
    name: "todo_write",
    description: "Write or update a task list with phased action plans.",
    parameters: {
      type: "object",
      properties: {
        phase: { type: "string", description: "Phase name (e.g., 'Phase 1: Setup')" },
        items: { type: "array", items: { type: "object", properties: { description: { type: "string" }, done: { type: "boolean" } } }, description: "List of tasks" },
      },
      required: ["phase", "items"],
    },
  },
  {
    name: "hashline_edit",
    description: "Edit files using the hashline format — a compact, line-anchored patch language with content-hash validation. Format: ¶path#TAG\\nreplace N..M:\\n+new content\\ndelete N\\ninsert after N:\\n+content\\ninsert head:\\n+content\\ninsert tail:\\n+content",
    parameters: {
      type: "object",
      properties: {
        patch: { type: "string", description: "Hashline patch string. Format: ¶path#HASH\\nreplace N..N:\\n+new content\\n Or: ¶path#HASH\\ndelete N\\n Or: ¶path#HASH\\ninsert after N:\\n+content" },
      },
      required: ["patch"],
    },
  },
  {
    name: "internal_url",
    description: "Access resources via internal URL protocols. Supported: memory:// (memory access), vault:// (credential lookup), local:// (workspace files), omp:// (embedded docs), issue:// (GitHub issues), pr:// (GitHub PRs), skill:// (skill files), rule:// (rule files). Example: memory://fact, vault://KEY_NAME, local://path/to/file",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Internal URL to resolve" },
      },
      required: ["url"],
    },
  },
  {
    name: "lsp",
    description: "Query language intelligence via LSP. Actions: diagnostics, goto_def, references, hover, symbols, rename, code_actions.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["diagnostics", "goto_def", "references", "hover", "symbols", "rename", "code_actions"] },
        file_path: { type: "string", description: "Path to the file" },
        line: { type: "number", description: "Line number (0-indexed)" },
        character: { type: "number", description: "Character offset (0-indexed)" },
        new_name: { type: "string", description: "New name for rename action" },
      },
      required: ["action", "file_path"],
    },
  },
  {
    name: "session",
    description: "Session management: checkpoints, rewind, compaction, status.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "checkpoint", "save", "list", "restore", "compact"], description: "Session action" },
        label: { type: "string", description: "Checkpoint label (for checkpoint action)" },
        id: { type: "string", description: "Checkpoint ID (for restore action)" },
        max_age_days: { type: "number", description: "Max age in days for compaction (default 30)" },
      },
      required: ["action"],
    },
  },
  {
    name: "generate_image",
    description: "Generate an image from a text prompt. Defaults to free Pollinations.ai (no API key needed). Also supports OpenAI (DALL-E 3), Gemini, Grok, and DesignAPI with API keys.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the image to generate" },
        provider: { type: "string", enum: ["free", "designapi", "openai", "gemini", "grok"], description: "Image generation provider. Default: 'free' (Pollinations.ai, no key needed). Set to 'openai', 'gemini', 'grok', or 'designapi' for key-based providers." },
        size: { type: "string", description: "Image size (e.g. 1024x1024, depends on provider/model)" },
        count: { type: "number", description: "Number of images to generate (default 4, max 4). More images = more choices for the user." },
        model: { type: "string", description: "Model for Pollinations (flux, gptimage, seedream, etc.) or DesignAPI (flux-pro, dall-e-3, etc.)" },
        save: { type: "boolean", description: "Save image to local assets folder and return file path (default: true)" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "request_asset_selection",
    description: "Show generated images to the user and ask which one to use for the post. Call this after generate_image returns multiple images. The user will pick one, and the rest will be deleted.",
    parameters: {
      type: "object",
      properties: {
        filenames: { type: "array", items: { type: "string" }, description: "Array of generated image filenames for the user to choose from" },
        prompt: { type: "string", description: "Original image generation prompt for context" },
      },
      required: ["filenames"],
    },
  },
  {
    name: "get_posted_content",
    description: "Search previously posted social media content to avoid reposting the same topic. Use this before writing new posts to check what has already been covered.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic or keyword to search for in posted history" },
        platform: { type: "string", description: "Filter by platform (twitter, reddit, bluesky, discord, telegram)" },
        days: { type: "number", description: "How many days back to look (default: 30)" },
      },
      required: [],
    },
  },
  {
    name: "text_to_speech",
    description: "Convert text to speech audio. Uses free browser SpeechSynthesis API or edge TTS fallback.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to convert to speech" },
        voice: { type: "string", description: "Voice preference (default: en-US)" },
      },
      required: ["text"],
    },
  },
  {
    name: "ssh_exec",
    description: "Execute commands on remote servers via SSH. Uses key-based auth. Requires SSH_KEY or SSH_PASSWORD in vault for each host.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string", description: "Remote host (user@hostname or IP)" },
        command: { type: "string", description: "Command to execute" },
        port: { type: "number", description: "SSH port (default: 22)" },
        timeout: { type: "number", description: "Command timeout in seconds (default: 30)" },
      },
      required: ["host", "command"],
    },
  },
  {
    name: "plugin",
    description: "Plugin system: list, create, enable, disable, and manage plugins.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create", "enable", "disable", "info", "remove"] },
        name: { type: "string", description: "Plugin name" },
        description: { type: "string", description: "Plugin description (for create action)" },
        version: { type: "string", description: "Plugin version (for create action)" },
      },
      required: ["action"],
    },
  },
  {
    name: "pattern_search",
    description: "Pattern-based code search across source files. Uses regex matching (not AST-based).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "count", "functions", "classes", "imports"], description: "AST action" },
        pattern: { type: "string", description: "Pattern to search (for search action)" },
        file_path: { type: "string", description: "File to analyze (optional, searches all if omitted)" },
        language: { type: "string", description: "Language (auto-detected from file extension if not specified)" },
      },
      required: ["action"],
    },
  },
  {
    name: "render_mermaid",
    description: "Render Mermaid diagram code to SVG or ASCII art. Falls back to ASCII representation if mermaid CLI is not installed.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Mermaid diagram code" },
        format: { type: "string", enum: ["svg", "ascii", "url"], description: "Output format (default: ascii)" },
      },
      required: ["code"],
    },
  },
  {
    name: "plan",
    description: "Planning/goals mode: create, track, and manage multi-step plans and objectives.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "list", "status", "update_step", "complete", "abandon", "resume"], description: "Plan action" },
        name: { type: "string", description: "Plan name (for create action)" },
        goal: { type: "string", description: "Plan goal/objective" },
        steps: { type: "array", items: { type: "string" }, description: "Array of step descriptions (for create action)" },
        plan_id: { type: "string", description: "Plan ID" },
        step_id: { type: "string", description: "Step ID (for update_step action)" },
        step_status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked"], description: "New step status" },
      },
      required: ["action"],
    },
  },
  {
    name: "pr_review",
    description: "Automated pull request review workflow. Fetches PR diff, runs parallel reviews via specialized agents, and compiles results with CEO approval gate.",
    parameters: {
      type: "object",
      properties: {
        prUrl: { type: "string", description: "Full GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)" },
        repo: { type: "string", description: "Repository in owner/repo format (alternative to prUrl)" },
        prNumber: { type: "number", description: "PR number (use with repo)" },
        localBranch: { type: "string", description: "Local git branch to diff against main (alternative to URL)" },
        reviewers: { type: "array", items: { type: "string" }, description: "Optional list of reviewer agents to use (default: all available)" },
        autoApprove: { type: "boolean", description: "Skip CEO gate for minor changes (default: false)" },
      },
    },
  },
  {
    name: "database_migration",
    description: "Generate SQL migration scripts by diffing two database schemas. Supports PostgreSQL, SQLite, and MySQL dialects. Can also extract schema from a live database connection.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["diff", "generate", "extract", "validate"], description: "Action: diff two schemas, generate from description, extract from live DB, or validate a migration script" },
        sourceSchema: { type: "string", description: "Source (current) SQL schema — CREATE TABLE statements" },
        targetSchema: { type: "string", description: "Target (desired) SQL schema — CREATE TABLE statements (for diff action)" },
        description: { type: "string", description: "Natural language description of desired schema changes (for generate action)" },
        dialect: { type: "string", enum: ["postgresql", "sqlite", "mysql"], description: "SQL dialect (default: postgresql)" },
        connectionString: { type: "string", description: "Database connection string (for extract action, e.g., postgresql://user:pass@host:5432/db)" },
        migrationName: { type: "string", description: "Name/timestamp for the migration (default: auto-generated)" },
        migrationScript: { type: "string", description: "SQL migration script to validate (for validate action)" },
      },
      required: ["action"],
    },
  },
  {
    name: "api_spec_validator",
    description: "Validate API specifications (OpenAPI/Swagger, GraphQL) against contracts, detect breaking changes, lint for best practices, and generate client/server stubs.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["validate", "diff", "lint", "generate-stubs"], description: "Action to perform" },
        spec: { type: "string", description: "API specification content (YAML/JSON OpenAPI or SDL GraphQL)" },
        specType: { type: "string", enum: ["openapi", "graphql"], description: "Type of API specification (default: auto-detect from content)" },
        oldSpec: { type: "string", description: "Previous version of the spec (for diff/breaking change detection)" },
        format: { type: "string", enum: ["json", "yaml"], description: "Output format for generated stubs (default: json)" },
        language: { type: "string", enum: ["typescript", "javascript", "python", "go"], description: "Target language for stub generation (default: typescript)" },
        endpoint: { type: "string", description: "Live endpoint URL to fetch and validate spec against (e.g., https://api.example.com/openapi.json)" },
      },
      required: ["action"],
    },
  },
  {
    name: "graphql_introspect",
    description: "Introspect a GraphQL endpoint to fetch schema, types, queries, mutations, and subscriptions. Supports custom headers for authentication.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "GraphQL endpoint URL (e.g., https://api.example.com/graphql)" },
        headers: { type: "object", description: "Optional HTTP headers (e.g., Authorization, Content-Type)" },
        includeDirectives: { type: "boolean", description: "Include directive definitions in schema (default: false)" },
        includeDeprecated: { type: "boolean", description: "Include deprecated fields/enums (default: false)" },
      },
      required: ["url"],
    },
  },
];

// ── API Spec Validator Helpers ──────────────────────────────────────────────

function parseSpec(specStr, specType) {
  if (specType === "graphql") return { raw: specStr, type: "graphql" };
  try {
    const parsed = JSON.parse(specStr);
    return { raw: specStr, type: "openapi", parsed };
  } catch {
    try {
      const parsed = parseYaml(specStr);
      return { raw: specStr, type: "openapi", parsed };
    } catch {
      return { raw: specStr, type: "unknown" };
    }
  }
}

function validateOpenAPI(specStr) {
  const spec = parseSpec(specStr, "openapi");
  if (spec.type !== "openapi" || !spec.parsed) return "❌ Could not parse as OpenAPI JSON/YAML";
  const issues = [];
  const doc = spec.parsed;
  if (!doc.openapi && !doc.swagger) issues.push("❌ Missing 'openapi' or 'swagger' version field");
  if (!doc.info) issues.push("❌ Missing 'info' object (title, version)");
  if (!doc.paths || Object.keys(doc.paths).length === 0) issues.push("❌ No paths defined in the spec");
  if (doc.paths) {
    for (const [path, methods] of Object.entries(doc.paths)) {
      if (!methods || typeof methods !== "object") continue;
      for (const [method, op] of Object.entries(methods)) {
        if (["get", "post", "put", "patch", "delete", "options", "head", "trace"].includes(method)) {
          if (!op.operationId) issues.push(`⚠️ Path ${path.toUpperCase()} ${method} missing operationId`);
          if (!op.responses) issues.push(`❌ Path ${path.toUpperCase()} ${method} missing responses`);
          else if (!op.responses["200"] && !op.responses["201"] && !op.responses["204"]) issues.push(`⚠️ Path ${path.toUpperCase()} ${method} missing success response (200/201/204)`);
        }
      }
    }
  }
  if (!issues.length) return "✅ OpenAPI spec is valid and well-formed.";
  return `## Validation Results\n${issues.join("\n")}`;
}

function lintOpenAPI(specStr) {
  const spec = parseSpec(specStr, "openapi");
  if (!spec.parsed) return ["❌ Could not parse spec"];
  const issues = [];
  const doc = spec.parsed;
  const p = doc.paths || {};
  for (const [path, methods] of Object.entries(p)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      if (!op.summary) issues.push(`📝 ${method.toUpperCase()} ${path} — missing summary`);
      if (!op.tags || op.tags.length === 0) issues.push(`🏷️ ${method.toUpperCase()} ${path} — no tags (consider grouping by domain)`);
      if (op.requestBody && !op.requestBody.content) issues.push(`📦 ${method.toUpperCase()} ${path} — requestBody has no content type`);
      if (op.parameters) {
        const hasPage = op.parameters.some(p => p.name === "page" || p.name === "offset");
        const hasLimit = op.parameters.some(p => p.name === "limit" || p.name === "per_page");
        if (method === "get" && hasPage !== hasLimit) issues.push(`📄 ${method.toUpperCase()} ${path} — pagination: use both page/offset AND limit/per_page`);
      }
    }
  }
  if (!doc.components?.schemas && !doc.definitions) issues.push("🧩 No reusable schemas/components defined");
  if (doc.info && !doc.info.description) issues.push("📋 No API description in info object");
  return issues;
}

function diffOpenAPI(oldSpecStr, newSpecStr) {
  const oldSpec = parseSpec(oldSpecStr, "openapi");
  const newSpec = parseSpec(newSpecStr, "openapi");
  if (!oldSpec.parsed || !newSpec.parsed) return ["Could not parse one or both specs"];
  const changes = [];
  const oldPaths = oldSpec.parsed.paths || {};
  const newPaths = newSpec.parsed.paths || {};
  for (const [path, methods] of Object.entries(newPaths)) {
    if (!oldPaths[path]) { changes.push(`➕ New path: ${path}`); continue; }
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      if (!oldPaths[path][method]) { changes.push(`➕ New endpoint: ${method.toUpperCase()} ${path}`); continue; }
      const oldOp = oldPaths[path][method];
      const oldParams = new Set((oldOp.parameters || []).map(p => p.name));
      const newParams = new Set((op.parameters || []).map(p => p.name));
      for (const p of oldParams) { if (!newParams.has(p)) changes.push(`⚠️ Removed required parameter: "${p}" from ${method.toUpperCase()} ${path} — BREAKING`); }
      if (oldOp.responses?.["200"] && op.responses?.["200"]) {
        const oldSchema = JSON.stringify(oldOp.responses["200"]);
        const newSchema = JSON.stringify(op.responses["200"]);
        if (oldSchema !== newSchema) changes.push(`⚠️ Response schema changed for ${method.toUpperCase()} ${path} — potentially BREAKING`);
      }
    }
  }
  for (const path of Object.keys(oldPaths)) { if (!newPaths[path]) changes.push(`🗑️ Removed path: ${path} — BREAKING`); }
  return changes;
}

function generateStubsOpenAPI(specStr, lang) {
  const spec = parseSpec(specStr, "openapi");
  if (!spec.parsed) return "Could not parse OpenAPI spec";
  const doc = spec.parsed;
  const baseName = doc.info?.title?.replace(/\s+/g, "") || "Api";
  let code = "";
  if (lang === "typescript") {
    code += `// ${baseName} API Client — Auto-generated\n\n`;
    if (doc.components?.schemas) {
      for (const [name, schema] of Object.entries(doc.components.schemas)) {
        const props = schema.properties || {};
        const fields = Object.entries(props).map(([p, ps]) => `  ${p}${schema.required?.includes(p) ? "" : "?"}: ${mapTypeToTS(ps)};`).join("\n");
        code += `interface ${name} {\n${fields}\n}\n\n`;
      }
    }
    const p = doc.paths || {};
    for (const [path, methods] of Object.entries(p)) {
      for (const [method, op] of Object.entries(methods)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        const name = op.operationId || `${method}${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const params = (op.parameters || []).map(p => `${p.name}: ${mapTypeToTS(p.schema || { type: "string" })}`).join(", ");
        code += `async ${name}(${params}): Promise<${op.responses?.["200"] ? extractRefName(op.responses["200"]) || "any" : "any"}> {\n`;
        code += `  return this.request("${method.toUpperCase()}", \`${path}\`, { ${(op.parameters || []).map(p => p.name).join(", ")} });\n`;
        code += `}\n\n`;
      }
    }
    code += `// Usage:\n// const client = new ${baseName}Client({ baseUrl: "https://api.example.com" });\n`;
  } else if (lang === "python") {
    code += `# ${baseName} API Client — Auto-generated\n\nclass ${baseName}Client:\n`;
    code += `  def __init__(self, base_url: str, api_key: str | None = None):\n`;
    code += `    self.base_url = base_url.rstrip("/")\n    self.session = requests.Session()\n`;
    code += `    if api_key:\n      self.session.headers["Authorization"] = f"Bearer {api_key}"\n\n`;
    const p = doc.paths || {};
    for (const [path, methods] of Object.entries(p)) {
      for (const [method, op] of Object.entries(methods)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        const name = op.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
        code += `  def ${name}(self):\n    ...  # TODO: implement\n\n`;
      }
    }
  }
  return code || `Stub generation for ${lang} is not yet implemented.`;
}

function generateStubsGraphQL(specStr, lang) {
  const typeRegex = /(?:type|interface|input|enum)\s+(\w+)(?:\s+implements\s+\w+)?\s*\{([^}]+)\}/g;
  let match;
  let code = "";
  if (lang === "typescript") {
    code += "// GraphQL Types — Auto-generated from SDL\n\n";
    while ((match = typeRegex.exec(specStr)) !== null) {
      const [_, name, fields] = match;
      const fieldLines = fields.trim().split("\n").map(f => {
        const trimmed = f.trim();
        if (!trimmed || trimmed.startsWith("#")) return null;
        const parts = trimmed.split(":");
        if (parts.length < 2) return null;
        const fieldName = parts[0].trim();
        const fieldType = parts.slice(1).join(":").trim().replace(/!$/, "").replace(/\[([^\]]+)\]/, "$1[]");
        return `  ${fieldName}: ${mapGraphQLTypeToTS(fieldType)};`;
      }).filter(Boolean);
      code += `interface ${name} {\n${fieldLines.join("\n")}\n}\n\n`;
    }
  }
  return code || "# TypeScript stub generation for GraphQL\n\n// Copy your SDL above this line\nexport type {};\n";
}

function mapTypeToTS(schema) {
  if (schema.$ref) return schema.$ref.split("/").pop();
  if (schema.type === "array") return `${mapTypeToTS(schema.items || { type: "any" })}[]`;
  const map = { string: "string", integer: "number", number: "number", boolean: "boolean", object: "Record<string, any>" };
  return map[schema.type] || "any";
}

function mapGraphQLTypeToTS(type) {
  const map = { String: "string", Int: "number", Float: "number", Boolean: "boolean", ID: "string" };
  return map[type.trim()] || type.trim();
}

function extractRefName(responseObj) {
  const content = responseObj.content?.["application/json"]?.schema;
  if (!content) return null;
  if (content.$ref) return content.$ref.split("/").pop();
  if (content.type === "array" && content.items?.$ref) return `${content.items.$ref.split("/").pop()}[]`;
  return null;
}

function validateGraphQLSchema(schemaStr) {
  const issues = [];
  if (!schemaStr.includes("type Query") && !schemaStr.includes("type Mutation") && !schemaStr.includes("type Subscription")) {
    issues.push("❌ No Query, Mutation, or Subscription type found (root types define entry points)");
  }
  const definedTypes = [...schemaStr.matchAll(/(?:type|interface|input|enum)\s+(\w+)/g)].map(m => m[1]);
  const usedTypes = [...schemaStr.matchAll(/:(\w+)/g)].map(m => m[1]);
  const unresolved = usedTypes.filter(t => !definedTypes.includes(t) && !["String", "Int", "Float", "Boolean", "ID"].includes(t));
  if (unresolved.length) issues.push(`❌ Unresolved type references: ${[...new Set(unresolved)].join(", ")}`);
  if (schemaStr.includes("type Query")) {
    const queryFields = schemaStr.match(/type Query\s*\{([^}]+)\}/);
    if (!queryFields || !queryFields[1].trim()) issues.push("⚠️ Query type is empty (no entry points defined)");
  }
  if (!issues.length) return "✅ GraphQL schema is valid and well-formed.";
  return `## Validation Results\n${issues.join("\n")}`;
}

function lintGraphQLSchema(schemaStr) {
  const issues = [];
  if (!schemaStr.match(/#.*/g)) issues.push("💬 No documentation comments found (consider documenting types and fields)");
  const types = [...schemaStr.matchAll(/type\s+(\w+)\s*\{([^}]+)\}/g)];
  for (const [, name, fields] of types) {
    const fieldLines = fields.split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of fieldLines) {
      if (line.endsWith("!")) issues.push(`📝 ${name}.${line.split(":")[0]?.trim()} — non-nullable field without default`);
    }
  }
  return issues;
}

// ── MCP Server Client ────────────────────────────────────────────────────────

function loadMcpConfig() {
  let config = [];
  try {
    if (fs.existsSync(MCP_CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(MCP_CONFIG_FILE, "utf8"));
    }
  } catch {}

  const seqThinkingName = "sequential-thinking";
  let seqThinking = config.find(s => s.name === seqThinkingName);

  const nvmBinDir = path.dirname(process.execPath);
  const globalMcpPath = path.join(nvmBinDir, "mcp-server-sequential-thinking");
  const mcpCommand = fs.existsSync(globalMcpPath) ? globalMcpPath : "npx";
  const mcpArgs = mcpCommand === "npx" ? ["-y", "@modelcontextprotocol/server-sequential-thinking"] : [];

  if (!seqThinking) {
    seqThinking = {
      name: seqThinkingName,
      command: mcpCommand,
      args: mcpArgs,
      enabled: true,
      description: "Sequential Thinking MCP Server for step-by-step reasoning"
    };
    config.push(seqThinking);
    saveMcpConfig(config);
  } else {
    let changed = false;
    if (!seqThinking.enabled) {
      seqThinking.enabled = true;
      changed = true;
    }
    if (seqThinking.command === "npx" && mcpCommand !== "npx") {
      seqThinking.command = mcpCommand;
      seqThinking.args = mcpArgs;
      changed = true;
    }
    if (changed) {
      saveMcpConfig(config);
    }
  }
  return config;
}

function saveMcpConfig(servers) {
  fs.mkdirSync(path.dirname(MCP_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(MCP_CONFIG_FILE, JSON.stringify(servers, null, 2));
}

const activeMcpServers = new Map(); // name -> McpConnection

class McpConnection {
  constructor(cfg) {
    this.cfg = cfg;
    this.proc = null;
    this.tools = [];
    this.pendingRequests = new Map(); // id -> { resolve, reject }
    this.nextRequestId = 1;
    this.initialized = false;
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[MCP] Starting server: ${this.cfg.name} (${this.cfg.command} ${(this.cfg.args || []).join(" ")})`);
        
        this.proc = spawn(this.cfg.command, this.cfg.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32'
        });

        this.proc.on('error', (err) => {
          console.error(`[MCP] Server ${this.cfg.name} spawn error:`, err);
          reject(err);
        });

        this.proc.on('exit', (code) => {
          console.log(`[MCP] Server ${this.cfg.name} exited with code ${code}`);
          this.cleanup();
        });

        const rl = readline.createInterface({ input: this.proc.stdout });
        rl.on('line', (line) => {
          this.handleMessage(line);
        });

        if (this.proc.stderr) {
          const rlErr = readline.createInterface({ input: this.proc.stderr });
          rlErr.on('line', (line) => {
            console.error(`[MCP Server ${this.cfg.name} Stderr] ${line}`);
          });
        }

        this.initializeHandshake().then(() => {
          resolve();
        }).catch(reject);

      } catch (err) {
        reject(err);
      }
    });
  }

  cleanup() {
    this.initialized = false;
    this.tools = [];
    for (const [id, req] of this.pendingRequests.entries()) {
      req.reject(new Error("MCP server connection closed"));
    }
    this.pendingRequests.clear();
    if (this.proc) {
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
  }

  async stop() {
    this.cleanup();
  }

  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error("MCP server not running"));
      const id = this.nextRequestId++;
      const req = { jsonrpc: "2.0", id, method, params };
      this.pendingRequests.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(req) + "\n");
    });
  }

  sendNotification(method, params) {
    if (!this.proc) return;
    const notification = { jsonrpc: "2.0", method, params };
    this.proc.stdin.write(JSON.stringify(notification) + "\n");
  }

  handleMessage(line) {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message || "Unknown MCP error"));
          } else {
            pending.resolve(msg.result);
          }
        }
      }
    } catch (e) {
      console.error(`[MCP] Error parsing message: ${line}`, e);
    }
  }

  async initializeHandshake() {
    const initResult = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "custom-pi-client", version: "1.0.0" }
    });

    this.sendNotification("notifications/initialized", {});
    this.initialized = true;

    const toolsResult = await this.sendRequest("tools/list", {});
    this.tools = toolsResult.tools || [];
    console.log(`[MCP] Server ${this.cfg.name} initialized with ${this.tools.length} tools`);
  }

  async callTool(name, args) {
    const res = await this.sendRequest("tools/call", { name, arguments: args });
    if (!res || !res.content) {
      return "Empty tool output";
    }
    return res.content.map(c => {
      if (c.type === "text") return c.text;
      if (c.type === "image") return `[Image: ${c.mimeType}]`;
      if (c.type === "resource") return `[Resource: ${c.uri}]`;
      return JSON.stringify(c);
    }).join("\n");
  }
}

async function startMcpServers() {
  await stopMcpServers();
  const servers = loadMcpConfig();
  for (const s of servers) {
    if (s.enabled) {
      const conn = new McpConnection(s);
      activeMcpServers.set(s.name, conn);
      try {
        await conn.start();
      } catch (err) {
        console.error(`[MCP] Failed to start server ${s.name}:`, err);
      }
    }
  }
}

async function stopMcpServers() {
  for (const conn of activeMcpServers.values()) {
    try { await conn.stop(); } catch {}
  }
  activeMcpServers.clear();
}

// ── LSP Server Client ───────────────────────────────────────────────────────

const LSP_CONFIG_FILE = path.join(PI_DIR, "lsp-servers.json");
const activeLspServers = new Map();

function loadLspConfig() {
  try {
    if (fs.existsSync(LSP_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(LSP_CONFIG_FILE, "utf8"));
    }
  } catch {}
  return {
    typescript: { command: "typescript-language-server", args: ["--stdio"] },
    javascript: { command: "typescript-language-server", args: ["--stdio"] },
    python: { command: "pyright-langserver", args: ["--stdio"] },
    rust: { command: "rust-analyzer", args: [] },
    go: { command: "gopls", args: [] },
  };
}

function saveLspConfig(config) {
  fs.mkdirSync(path.dirname(LSP_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(LSP_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function detectLanguage(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
  };
  return map[ext] || null;
}

function findLspServer(language) {
  try {
    const config = loadLspConfig();
    const cfg = config[language];
    if (!cfg) return null;
    const cmd = cfg.command.split(" ")[0];
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(whichCmd, [cmd], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return cfg;
    return null;
  } catch { return null; }
}

class LspConnection {
  constructor(language, command, args) {
    this.language = language;
    this.command = command;
    this.args = args;
    this.proc = null;
    this.pendingRequests = new Map();
    this.nextRequestId = 1;
    this.initialized = false;
    this.serverCapabilities = {};
    this.rootUri = null;
    this.diagnosticsCallback = null;
  }

  async start(rootUri) {
    if (this.proc) return;
    this.rootUri = rootUri;
    return new Promise((resolve, reject) => {
      try {
        this.proc = spawn(this.command, this.args || [], {
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32",
        });

        this.proc.on("error", (err) => {
          console.error(`[LSP] ${this.language} spawn error:`, err);
          reject(err);
        });

        this.proc.on("exit", (code) => {
          console.log(`[LSP] ${this.language} server exited with code ${code}`);
          this.cleanup();
        });

        let buffer = Buffer.alloc(0);
        this.proc.stdout.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (true) {
            const headerIndex = buffer.indexOf("Content-Length:");
            if (headerIndex === -1) break;
            const bodyIndex = buffer.indexOf("\r\n\r\n", headerIndex);
            if (bodyIndex === -1) break;
            const contentLengthStr = buffer.toString("utf8", headerIndex + 15, bodyIndex).trim();
            const contentLength = parseInt(contentLengthStr, 10);
            const messageStartIndex = bodyIndex + 4;
            if (buffer.length < messageStartIndex + contentLength) break;
            const messageJson = buffer.toString("utf8", messageStartIndex, messageStartIndex + contentLength);
            this.handleMessage(messageJson);
            buffer = buffer.slice(messageStartIndex + contentLength);
          }
        });

        if (this.proc.stderr) {
          const rlErr = readline.createInterface({ input: this.proc.stderr });
          rlErr.on("line", (line) => { console.error(`[LSP ${this.language} Stderr] ${line}`); });
        }

        this.initializeHandshake().then(resolve).catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  cleanup() {
    this.initialized = false;
    for (const [, req] of this.pendingRequests.entries()) {
      req.reject(new Error("LSP server connection closed"));
    }
    this.pendingRequests.clear();
    if (this.proc) {
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
  }

  stop() { this.cleanup(); }

  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error("LSP server not running"));
      const id = this.nextRequestId++;
      const req = { jsonrpc: "2.0", id, method, params };
      this.pendingRequests.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(req) + "\n");
      setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          pending.reject(new Error(`LSP request ${method} timed out after 10s`));
        }
      }, 10000);
    });
  }

  sendNotification(method, params) {
    if (!this.proc) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  handleMessage(line) {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) pending.reject(new Error(msg.error.message || "Unknown LSP error"));
          else pending.resolve(msg.result);
        }
      } else if (msg.method === "textDocument/publishDiagnostics" && this.diagnosticsCallback) {
        this.diagnosticsCallback(msg.params);
      }
    } catch (e) {
      console.error(`[LSP] Error parsing message: ${line}`, e);
    }
  }

  async initializeHandshake() {
    const initResult = await this.sendRequest("initialize", {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, willSave: false, willSaveWaitUntil: false, didSave: false },
          completion: { dynamicRegistration: false },
          hover: { dynamicRegistration: false },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          documentSymbol: { dynamicRegistration: false },
          rename: { dynamicRegistration: false },
          codeAction: { dynamicRegistration: false },
        },
        workspace: { workspaceFolders: true },
      },
      clientInfo: { name: "custom-pi-lsp", version: "1.0.0" },
    });
    this.serverCapabilities = initResult.capabilities || {};
    this.sendNotification("initialized", {});
    this.initialized = true;
    console.log(`[LSP] ${this.language} server initialized`);
  }

  async openDocument(uri, languageId, text) {
    this.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  async closeDocument(uri) {
    this.sendNotification("textDocument/didClose", { textDocument: { uri } });
  }

  async getDiagnostics(uri, text) {
    const diagnostics = await new Promise((resolve) => {
      this.diagnosticsCallback = (params) => {
        if (params.uri === uri) resolve(params.diagnostics || []);
      };
      this.openDocument(uri, this.language, text);
      setTimeout(() => {
        if (this.diagnosticsCallback) {
          this.diagnosticsCallback = null;
          resolve([]);
        }
      }, 5000);
    });
    this.diagnosticsCallback = null;
    await this.closeDocument(uri);
    return diagnostics;
  }

  async gotoDefinition(uri, line, character, text) {
    await this.openDocument(uri, this.language, text);
    try {
      const result = await this.sendRequest("textDocument/definition", {
        textDocument: { uri },
        position: { line, character },
      });
      if (!result) return null;
      const loc = Array.isArray(result) ? result[0] : result;
      if (!loc) return null;
      return { uri: loc.uri, range: loc.range };
    } finally {
      await this.closeDocument(uri);
    }
  }

  async findReferences(uri, line, character, text, includeDeclaration = false) {
    await this.openDocument(uri, this.language, text);
    try {
      const result = await this.sendRequest("textDocument/references", {
        textDocument: { uri },
        position: { line, character },
        context: { includeDeclaration },
      });
      return (result || []).map(loc => ({ uri: loc.uri, range: loc.range }));
    } finally {
      await this.closeDocument(uri);
    }
  }

  async hover(uri, line, character, text) {
    await this.openDocument(uri, this.language, text);
    try {
      const result = await this.sendRequest("textDocument/hover", {
        textDocument: { uri },
        position: { line, character },
      });
      if (!result) return null;
      if (result.contents) {
        if (typeof result.contents === "string") return result.contents;
        if (Array.isArray(result.contents)) return result.contents.map(c => typeof c === "string" ? c : c.value || JSON.stringify(c)).join("\n");
        if (result.contents.value) return result.contents.value;
        if (result.contents.kind === "markdown" && result.contents.value) return result.contents.value;
      }
      return JSON.stringify(result);
    } finally {
      await this.closeDocument(uri);
    }
  }

  async getDocumentSymbols(uri, text) {
    const SYMBOL_KINDS = {
      1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
      6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
      11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
      15: "String", 16: "Number", 17: "Boolean", 18: "Array",
      19: "Object", 20: "Key", 21: "Null", 22: "EnumMember",
      23: "Struct", 24: "Event", 25: "Operator", 26: "TypeParameter",
    };
    await this.openDocument(uri, this.language, text);
    try {
      const result = await this.sendRequest("textDocument/documentSymbol", { textDocument: { uri } }) || [];
      return result.map(s => ({
        name: s.name,
        kind: SYMBOL_KINDS[s.kind] || String(s.kind),
        range: s.range || s.location?.range,
      }));
    } finally {
      await this.closeDocument(uri);
    }
  }

  async rename(uri, line, character, newName, text) {
    await this.openDocument(uri, this.language, text);
    try {
      const result = await this.sendRequest("textDocument/rename", {
        textDocument: { uri },
        position: { line, character },
        newName,
      });
      return result || { changes: {} };
    } finally {
      await this.closeDocument(uri);
    }
  }

  async getCodeActions(uri, line, character, text, diagnostics = []) {
    await this.openDocument(uri, this.language, text);
    try {
      const result = await this.sendRequest("textDocument/codeAction", {
        textDocument: { uri },
        range: { start: { line, character: 0 }, end: { line, character: 65535 } },
        context: {
          diagnostics: diagnostics.map(d => ({
            range: d.range, severity: d.severity, message: d.message, source: d.source,
          })),
        },
      });
      return (result || []).map(a => ({ title: a.title, kind: a.kind, diagnostics: a.diagnostics, edit: a.edit, command: a.command }));
    } finally {
      await this.closeDocument(uri);
    }
  }
}

async function startLspServer(language, rootUri) {
  const cfg = findLspServer(language);
  if (!cfg) return null;
  const conn = new LspConnection(language, cfg.command, cfg.args || []);
  activeLspServers.set(language, conn);
  try {
    await conn.start(rootUri);
    return conn;
  } catch (err) {
    console.error(`[LSP] Failed to start server for ${language}:`, err);
    activeLspServers.delete(language);
    return null;
  }
}

async function stopLspServers() {
  for (const conn of activeLspServers.values()) {
    try { await conn.stop(); } catch {}
  }
  activeLspServers.clear();
}

async function getOrCreateLspServer(language, rootUri) {
  if (activeLspServers.has(language)) {
    const conn = activeLspServers.get(language);
    if (conn.initialized) return conn;
  }
  return await startLspServer(language, rootUri);
}

function applyTextEdits(content, textEdits) {
  const lines = content.split("\n");
  const lineOffsets = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    lineOffsets.push(lineOffsets[i] + lines[i].length + 1);
  }
  const sorted = [...textEdits].sort((a, b) => {
    const aStart = lineOffsets[a.range.start.line] + a.range.start.character;
    const bStart = lineOffsets[b.range.start.line] + b.range.start.character;
    return bStart - aStart;
  });
  for (const edit of sorted) {
    const start = lineOffsets[edit.range.start.line] + edit.range.start.character;
    const end = lineOffsets[edit.range.end.line] + edit.range.end.character;
    content = content.slice(0, start) + edit.newText + content.slice(end);
  }
  return content;
}

function getActiveTools() {
  const allTools = [...TOOLS];
  for (const conn of activeMcpServers.values()) {
    if (conn.initialized) {
      for (const t of conn.tools) {
        if (!allTools.find(at => at.name === t.name)) {
          allTools.push({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema || { type: "object", properties: {} }
          });
        }
      }
    }
  }
  return allTools;
}

// ── Tool Execution ─────────────────────────────────────────────────────────

function expandPath(p) {
  if (typeof p === "string" && p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function safeResolve(cwd, p) {
  const resolved = path.resolve(cwd, expandPath(p || "."));
  const realCwd = fs.realpathSync(cwd);
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    throw new Error(`Path does not exist: ${p}`);
  }
  if (!real.startsWith(realCwd + path.sep) && real !== realCwd) {
    throw new Error(`Path traversal denied: ${p}`);
  }
  return real;
}

async function executeTool(name, args, cwd) {
  _toolCallCount++;
  for (const conn of activeMcpServers.values()) {
    if (conn.initialized && conn.tools.find(t => t.name === name)) {
      try {
        const result = await conn.callTool(name, args);
        if (_toolCallCount % 10 === 0) {
          try {
            saveSessionState({
              lastActive: Date.now(),
              toolCallCount: _toolCallCount,
              memoryCount: readMemory().length,
              checkpoints: listCheckpoints().length,
              model: resolveModel().id,
            });
          } catch {}
        }
        return result;
      } catch (err) {
        return `MCP Tool Error (${name}): ${err.message}`;
      }
    }
  }

  switch (name) {
    case "list_dir": {
      let dirPath = expandPath(args.path || ".");
      if (!path.isAbsolute(dirPath)) dirPath = path.resolve(cwd, dirPath);
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries.map(e => `${e.isDirectory() ? "[D]" : "[F]"} ${e.name}`).join("\n");
      } catch (e) {
        return `Error listing directory: ${e.message}`;
      }
    }
    case "view_file":
    case "read": {
      const fp = safeResolve(cwd, expandPath(args.path));
      return fs.readFileSync(fp, "utf8");
    }
    case "write": {
      const fp = safeResolve(cwd, expandPath(args.path));
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, args.content, "utf8");
      recordWorkProduct("web-session", "web-agent", "write", args.path, "create", args.content.slice(0, 200));
      return `Successfully wrote: ${args.path}`;
    }
    case "edit": {
      const fp = safeResolve(cwd, expandPath(args.path));
      const content = fs.readFileSync(fp, "utf8");
      if (!content.includes(args.oldText)) return `Error: Could not find the specified text in ${args.path}`;
      const updated = content.split(args.oldText).join(args.newText);
      fs.writeFileSync(fp, updated, "utf8");
      return `Successfully edited: ${args.path}`;
    }
    case "bash": {
      if (isDangerousCommand(args.command)) {
        return `Error: Command '${args.command.trim().split(/\s+/)[0]}' is blocked for security reasons.`;
      }
      const result = spawnSync("bash", ["-c", args.command], { cwd, encoding: "utf8", timeout: 30000, shell: false, maxBuffer: 10 * 1024 * 1024 });
      if (result.error) throw result.error;
      return result.stdout || result.stderr || "";
    }
    case "glob": {
      const { globSync } = await import("glob");
      return globSync(args.pattern, { cwd }).join("\n");
    }
    case "grep": {
      // Prevent ReDoS and flag injection
      if (typeof args.pattern !== "string" || args.pattern.length > 200) return "Pattern must be a string under 200 chars";
      if (args.pattern.startsWith("--")) return "Pattern cannot start with -- (flag injection prevention)";
      try {
        const grepArgs = ['--no-filename', '--color', 'never', args.pattern, args.path || cwd];
        const result = spawnSync('rg', grepArgs, { encoding: "utf8", timeout: 30000 });
        if (result.error) throw result.error;
        return result.stdout || "";
      } catch {
        const searchPath = args.path || cwd;
        const results = [];
        function walk(dir) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
              try {
                const lines = fs.readFileSync(full, "utf8").split("\n");
                // Safe regex: literal mode by default (no special chars), use regex mode only if explicitly requested
                const isRegex = args.regex === true;
                const pattern = isRegex ? args.pattern.slice(0, 100) : args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
                const regex = new RegExp(pattern, "i");
                for (let i = 0; i < lines.length; i++) {
                  if (regex.test(lines[i])) results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
                }
              } catch {}
            }
          }
        }
        walk(searchPath);
        return results.slice(0, 200).join("\n") || "No matches found.";
      }
    }
    case "memory_store": {
      const importance = Math.min(10, Math.max(1, Math.floor(args.importance ?? 5)));
      const project = path.basename(cwd) || "global";
      const id = memoryStore(args.content, args.type || "fact", importance, project, args.tags || []);
      try { saveSessionState({ lastActive: Date.now(), toolCallCount: _toolCallCount, memoryCount: readMemory().length, checkpoints: listCheckpoints().length, model: resolveModel().id }); } catch {}
      return id;
    }
    case "memory_search": {
      const results = memorySearch(args.query, args.k ?? 5);
      if (!results.length) return "No relevant memories found.";
      return results.map((r, i) => `${i + 1}. [${r.entry.type}] ${r.entry.content} (relevance: ${(r.score * 100).toFixed(0)}%)`).join("\n");
    }
    case "vault_set":
      vaultSet(args.key, args.value);
      try { saveSessionState({ lastActive: Date.now(), toolCallCount: _toolCallCount, memoryCount: readMemory().length, checkpoints: listCheckpoints().length, model: resolveModel().id }); } catch {}
      return `Secret '${args.key}' stored.`;
    case "vault_get": {
      const val = vaultGet(args.key);
      return val !== null ? val : `Secret '${args.key}' not found.`;
    }
    case "ask_user": {
      const questionId = crypto.randomUUID();
      const q = { question: args.question, options: args.options || null, resolve: null, reject: null };
      pendingQuestions[questionId] = q;
      bcast({ type: "user_question", id: questionId, question: args.question, options: args.options || null });
      try {
        const answer = await new Promise((resolve, reject) => {
          q.resolve = resolve;
          q.reject = reject;
          setTimeout(() => reject(new Error("Timed out waiting for user response (5 min)")), 300000);
        });
        return `User answered: ${answer}`;
      } finally {
        delete pendingQuestions[questionId];
        bcast({ type: "user_question_resolved", id: questionId });
      }
    }
    case "request_post_approval": {
      const questionId = crypto.randomUUID();
      const q = { question: "", options: ["Approve", "Edit", "Skip"], resolve: null, reject: null };
      pendingQuestions[questionId] = q;
      bcast({
        type: "post_preview",
        id: questionId,
        platform: args.platform || "",
        content: args.content || "",
        title: args.title || "",
        platformSpecific: args.platformSpecific || "",
        assetUrl: args.assetUrl || "",
      });
      try {
        const answer = await new Promise((resolve, reject) => {
          q.resolve = resolve;
          q.reject = reject;
          setTimeout(() => reject(new Error("Timed out waiting for approval (10 min)")), 600000);
        });
        if (answer === "Edit") {
          const editId = crypto.randomUUID();
          const eq = { question: "", options: null, resolve: null, reject: null };
          pendingQuestions[editId] = eq;
          bcast({ type: "post_edit_request", id: editId, content: args.content || "" });
          const editAnswer = await new Promise((resolve, reject) => {
            eq.resolve = resolve;
            eq.reject = reject;
            setTimeout(() => reject(new Error("Edit timed out (10 min)")), 600000);
          });
          delete pendingQuestions[editId];
          bcast({ type: "user_question_resolved", id: editId });
          return `User chose Edit. User provided edited content: ${editAnswer}`;
        }
        return `User chose: ${answer}`;
      } finally {
        delete pendingQuestions[questionId];
        bcast({ type: "user_question_resolved", id: questionId });
      }
    }
    case "delegate_to_subagent": {
      const agents = loadAgents();
      const agent = agents[args.agentId];
      if (!agent) return `Error: Sub-agent '${args.agentId}' not found. Available: ${Object.keys(agents).join(", ")}`;
      try {
        const cmd = agent.config.command || "echo";
        const cmdArgs = agent.config.args ? [agent.config.args, args.task] : [args.task];
        const result = spawnSync(cmd, cmdArgs, { timeout: 30000, encoding: "utf8", shell: false });
        if (result.error) throw result.error;
        return `Sub-agent '${args.agentId}' result:\n${(result.stdout || "").slice(0, 2000)}`;
      } catch (e) {
        return `Sub-agent '${args.agentId}' error: ${e.message}. Running inline instead.\n\n${agent.body ? agent.body.slice(0, 500) : ""}`;
      }
    }
    case "search_obsidian": {
      try {
        const results = [];
        function walk(dir) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".md")) {
              try {
                const content = fs.readFileSync(full, "utf8");
                if (content.toLowerCase().includes(args.query.toLowerCase())) {
                  results.push(`${entry.name}: ${content.slice(0, 200).replace(/\n/g, " ")}`);
                }
              } catch {}
            }
          }
        }
        walk(OBSIDIAN_VAULT);
        return results.slice(0, 10).join("\n\n") || "No matching notes found.";
      } catch (e) { return `Error searching vault: ${e.message}`; }
    }
    case "write_obsidian_note": {
      try {
        const safeName = args.title.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "untitled";
        const filePath = path.join(OBSIDIAN_VAULT, `${safeName}.md`);
        fs.writeFileSync(filePath, args.content, "utf8");
        return `Note written: ${safeName}.md`;
      } catch (e) { return `Error writing note: ${e.message}`; }
    }
    case "post_to_twitter": {
      if (!args.force) {
        const similar = findSimilarPosted("twitter", args.text);
        if (similar.length > 0 && similar[0].similarity > 0.4) {
          const s = similar[0];
          return `⚠️ Similar content already posted on ${s.entry.postedAt.slice(0, 10)} (${Math.round(s.similarity * 100)}% match): "${s.entry.fullContent?.slice(0, 100)}". Write something fresh and try again, or set force: true to override.`;
        }
      }
      const result = await postToTwitter(args.text, args.mediaPath);
      addPostedEntry("twitter", args.text, args.topic || "", result);
      return result;
    }
    case "web_search": {
      return await webSearch(args.query, args.count || 5);
    }
    case "web_fetch": {
      return await webFetchUrl(args.url);
    }
    case "browser": {
      return await browserAction(args.action, args);
    }
    case "github": {
      return await githubAction(args);
    }
    case "post_to_reddit": {
      if (!args.force) {
        const redditSimilar = findSimilarPosted("reddit", (args.title || "") + " " + (args.text || ""));
        if (redditSimilar.length > 0 && redditSimilar[0].similarity > 0.4) {
          const s = redditSimilar[0];
          return `⚠️ Similar Reddit post already on ${s.entry.postedAt.slice(0, 10)} (${Math.round(s.similarity * 100)}% match). Write something fresh or use force: true.`;
        }
      }
      const redditResult = await postToReddit(args.subreddit, args.title, args.text, args.mediaPath);
      addPostedEntry("reddit", (args.title || "") + " " + (args.text || ""), args.topic || "", redditResult);
      return redditResult;
    }
    case "post_to_bluesky": {
      if (!args.force) {
        const bskySimilar = findSimilarPosted("bluesky", args.text);
        if (bskySimilar.length > 0 && bskySimilar[0].similarity > 0.4) {
          const s = bskySimilar[0];
          return `⚠️ Similar Bluesky post already on ${s.entry.postedAt.slice(0, 10)} (${Math.round(s.similarity * 100)}% match). Write something fresh or use force: true.`;
        }
      }
      const bskyResult = await postToBluesky(args.text, args.mediaPath);
      addPostedEntry("bluesky", args.text, args.topic || "", bskyResult);
      return bskyResult;
    }
    case "send_email": {
      return await sendEmail(args.to, args.subject, args.body);
    }
    case "post_to_discord": {
      if (!args.force) {
        const discordSimilar = findSimilarPosted("discord", args.message);
        if (discordSimilar.length > 0 && discordSimilar[0].similarity > 0.4) {
          const s = discordSimilar[0];
          return `⚠️ Similar Discord message already on ${s.entry.postedAt.slice(0, 10)} (${Math.round(s.similarity * 100)}% match). Write something fresh or use force: true.`;
        }
      }
      const discordResult = await postToDiscord(args.message, args.mediaPath);
      addPostedEntry("discord", args.message, args.topic || "", discordResult);
      return discordResult;
    }
    case "post_to_telegram": {
      if (!args.force) {
        const tgSimilar = findSimilarPosted("telegram", args.message);
        if (tgSimilar.length > 0 && tgSimilar[0].similarity > 0.4) {
          const s = tgSimilar[0];
          return `⚠️ Similar Telegram message already on ${s.entry.postedAt.slice(0, 10)} (${Math.round(s.similarity * 100)}% match). Write something fresh or use force: true.`;
        }
      }
      const tgResult = await postToTelegram(args.message, args.mediaPath);
      addPostedEntry("telegram", args.message, args.topic || "", tgResult);
      return tgResult;
    }
    case "memory_edit": {
      const result = memoryEdit(args.action, args.id, args.content, args.tags);
      try { saveSessionState({ lastActive: Date.now(), toolCallCount: _toolCallCount, memoryCount: readMemory().length, checkpoints: listCheckpoints().length, model: resolveModel().id }); } catch {}
      return result;
    }
    case "todo_write": {
      return todoWrite(args.phase, args.items);
    }
    case "hashline_edit": {
      return await hashlineEdit(args.patch, cwd);
    }
    case "internal_url": {
      return await resolveInternalUrl(args.url, cwd);
    }
    case "lsp": {
      const filePath = safeResolve(cwd, expandPath(args.file_path));
      const uri = `file://${filePath}`;
      const language = detectLanguage(filePath);
      if (!language) return `Unsupported file type: ${filePath}`;

      const rootUri = `file://${cwd}`;
      const lsp = await getOrCreateLspServer(language, rootUri);
      if (!lsp) {
        const cfg = loadLspConfig()[language];
        if (!cfg) return `No LSP server configured for ${language}.`;
        return `LSP server for ${language} not found. Install with: npm install -g ${cfg.command.includes("typescript") ? "typescript-language-server" : cfg.command.includes("pyright") ? "pyright" : cfg.command}`;
      }

      const text = fs.readFileSync(filePath, "utf8");

      switch (args.action) {
        case "diagnostics": {
          const diagnostics = await lsp.getDiagnostics(uri, text);
          if (!diagnostics.length) return "No diagnostics found.";
          return diagnostics.map(d => `[${d.severity === 1 ? "Error" : d.severity === 2 ? "Warning" : "Info"}] ${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character} ${d.message}`).join("\n");
        }
        case "goto_def": {
          const def = await lsp.gotoDefinition(uri, args.line, args.character, text);
          if (!def) return "No definition found.";
          return `Definition at: ${def.uri}:${def.range.start.line}:${def.range.start.character}`;
        }
        case "references": {
          const refs = await lsp.findReferences(uri, args.line, args.character, text);
          if (!refs.length) return "No references found.";
          return refs.map(r => `${r.uri}:${r.range.start.line}:${r.range.start.character}`).join("\n");
        }
        case "hover": {
          const info = await lsp.hover(uri, args.line, args.character, text);
          return info || "No hover information available.";
        }
        case "symbols": {
          const symbols = await lsp.getDocumentSymbols(uri, text);
          if (!symbols.length) return "No symbols found.";
          return symbols.map(s => `[${s.kind}] ${s.name} at ${s.range.start.line}:${s.range.start.character}`).join("\n");
        }
        case "rename": {
          const edits = await lsp.rename(uri, args.line, args.character, args.new_name, text);
          const changes = edits.changes || {};
          if (!Object.keys(changes).length) return "No changes to apply.";
          for (const [editUri, textEdits] of Object.entries(changes)) {
            const editPath = editUri.startsWith("file://") ? editUri.slice(7) : editUri;
            const content = fs.readFileSync(editPath, "utf8");
            fs.writeFileSync(editPath, applyTextEdits(content, textEdits), "utf8");
          }
          const totalEdits = Object.values(changes).reduce((sum, arr) => sum + arr.length, 0);
          return `Renamed at ${totalEdits} location${totalEdits !== 1 ? "s" : ""}.`;
        }
        case "code_actions": {
          const actions = await lsp.getCodeActions(uri, args.line, args.character, text);
          if (!actions.length) return "No code actions available.";
          return actions.map(a => `[${a.kind || "refactor"}] ${a.title}`).join("\n");
        }
        default:
          return `Unknown lsp action: ${args.action}`;
      }
    }
    case "session": {
      switch (args.action) {
        case "status": {
          const current = globalSession ? (await globalSession.getState()) : null;
          const checkpoints = listCheckpoints();
          return `Session Status:
Active: ${current ? "Yes" : "No"}
Checkpoints: ${checkpoints.length} total
${checkpoints.map(c => `  - ${c.id}: ${c.label} (${new Date(c.createdAt).toLocaleString()})`).join("\n")}`;
        }
        case "checkpoint":
        case "save": {
          const ckpt = createCheckpoint(args.label || `Manual save ${new Date().toISOString()}`);
          return `Checkpoint created: ${ckpt.id}
Label: ${ckpt.label}
Timestamp: ${new Date(ckpt.createdAt).toISOString()}`;
        }
        case "list": {
          const checkpoints = listCheckpoints();
          if (!checkpoints.length) return "No checkpoints found.";
          return checkpoints.map(c => `${c.id}: ${c.label} — ${new Date(c.createdAt).toLocaleString()} (${(c.size / 1024).toFixed(1)}KB)`).join("\n");
        }
        case "restore": {
          const result = restoreCheckpoint(args.id);
          if (!result.success) return `Error: ${result.error}`;
          return `Checkpoint restored: ${result.label}
Restored: ${result.restored.join(", ")}`;
        }
        case "compact": {
          const result = compactSession(args.max_age_days || 30);
          return `Compaction complete. Removed ${result.removed} old checkpoint(s). ${result.remaining} remaining.`;
        }
        default:
          return `Unknown session action: ${args.action}. Available: status, checkpoint, list, restore, compact`;
      }
    }
    case "generate_image": {
      const saveToDisk = args.save !== false;
      const count = Math.min(Math.max(1, args.count || 4), 4);
      const provider = args.provider || "free";
      const results = [];
      for (let i = 0; i < count; i++) {
        let result;
        switch (provider) {
          case "free": result = await generateImagePollinations(args.prompt, args.model, null, null, null); break;
          case "designapi": result = await generateImageDesignAPI(args.prompt, args.size, args.model); break;
          case "openai": result = await generateImageOpenAI(args.prompt, args.size, "url"); break;
          case "gemini": result = await generateImageGemini(args.prompt); break;
          case "grok": result = await generateImageGrok(args.prompt, "url"); break;
        }
        if (result.error) { results.push({ error: result.error }); continue; }
        if (saveToDisk) {
          const assetsDir = path.join(PI_DIR, "assets");
          fs.mkdirSync(assetsDir, { recursive: true });
          const ext = result.mimeType === "image/png" ? "png" : result.mimeType === "image/jpeg" || result.mimeType === "image/jpg" ? "jpg" : "png";
          const filename = `asset_${Date.now()}_${i}.${ext}`;
          const filePath = path.join(assetsDir, filename);
          if (result.format === "url" && result.image) {
            const imgResp = await fetch(result.image);
            const buf = Buffer.from(await imgResp.arrayBuffer());
            fs.writeFileSync(filePath, buf);
            results.push({ path: filePath, filename, provider, model: args.model || "auto" });
          } else if (result.image) {
            fs.writeFileSync(filePath, Buffer.from(result.image, "base64"));
            results.push({ path: filePath, filename, provider, model: args.model || "auto" });
          }
        } else {
          if (result.format === "url") results.push({ url: result.image, provider });
          else results.push({ image: `data:${result.mimeType || "image/png"};base64,${result.image}`, provider });
        }
      }
      const saved = results.filter(r => r.path);
      if (saved.length > 0) {
        const filenames = saved.map(s => s.filename);
        return `Generated and saved ${saved.length} image(s):\n${saved.map(s => `- ${s.filename}`).join("\n")}\n\nCall request_asset_selection with filenames: [${filenames.map(f => `"${f}"`).join(", ")}] to let the user pick which one to use.`;
      }
      const urls = results.filter(r => r.url);
      if (urls.length > 0) return urls.map(u => `Generated image (${u.provider}): ${u.url}`).join("\n");
      const errs = results.filter(r => r.error);
      if (errs.length > 0) return `Errors: ${errs.map(e => e.error).join("; ")}`;
      return "No images generated.";
    }
    case "request_asset_selection": {
      const filenames = args.filenames || [];
      if (!Array.isArray(filenames) || filenames.length === 0) return "Error: No filenames provided.";
      const questionId = crypto.randomUUID();
      const q = { question: "", options: null, resolve: null, reject: null };
      pendingQuestions[questionId] = q;
      const assetsDir = path.join(PI_DIR, "assets");
      const validFiles = filenames.filter(f => {
        const safe = path.basename(f);
        const fp = path.join(assetsDir, safe);
        return fs.existsSync(fp) && !safe.includes("..");
      });
      if (validFiles.length === 0) return "Error: None of the specified image files exist. They may have been deleted.";
      bcast({
        type: "asset_selection_request",
        id: questionId,
        filenames: validFiles,
        prompt: args.prompt || "",
      });
      try {
        const answer = await new Promise((resolve, reject) => {
          q.resolve = resolve;
          q.reject = reject;
          setTimeout(() => reject(new Error("Timed out waiting for asset selection (10 min)")), 600000);
        });
        if (!validFiles.includes(answer)) return `Error: Invalid selection "${answer}".`;
        for (const f of validFiles) {
          if (f !== answer) {
            try { fs.unlinkSync(path.join(assetsDir, f)); } catch {}
          }
        }
        return `Selected: ${answer}`;
      } finally {
        delete pendingQuestions[questionId];
        bcast({ type: "user_question_resolved", id: questionId });
      }
    }
    case "get_posted_content": {
      const entries = loadPostedContent();
      const days = Math.min(Math.max(1, args.days || 30), 365);
      const cutoff = Date.now() - days * 86400000;
      const topic = (args.topic || "").toLowerCase();
      const platform = (args.platform || "").toLowerCase();
      let filtered = entries.filter(e => new Date(e.postedAt).getTime() > cutoff);
      if (platform) filtered = filtered.filter(e => e.platform === platform);
      if (topic) {
        const topicWords = topic.split(/\s+/).filter(w => w.length > 2);
        filtered = filtered.filter(e => topicWords.some(w => e.content.includes(w)));
      }
      filtered.sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
      const top = filtered.slice(0, 15);
      if (top.length === 0) return "No previously posted content found matching your criteria.";
      return `Previously posted content (last ${days} days, showing ${top.length}):\n\n${top.map((e, i) =>
        `  ${i + 1}. [${e.platform}] ${e.postedAt.slice(0, 10)} — ${e.fullContent || e.content.slice(0, 120)}${e.topic ? ` (topic: ${e.topic})` : ""}`
      ).join("\n")}\n\nUse this information to avoid repeating the same topics. If you see similar content, write something fresh and different.`;
    }
    case "text_to_speech": {
      try {
        const voice = args.voice || "en-US-JennyNeural";
        // Sanitize voice — only allow alphanumeric, hyphens, underscores
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(voice)) return "Invalid voice";
        const safeText = (args.text || "").slice(0, 1000);
        const outFile = path.join(PI_DIR, "tts", `speech_${Date.now()}.mp3`);
        fs.mkdirSync(path.join(PI_DIR, "tts"), { recursive: true });
        const result = spawnSync("edge-tts", ["--voice", voice, "--text", safeText, "--write-media", outFile], { encoding: "utf8", timeout: 30000, shell: false });
        if (result.status === 0) {
          const audioData = fs.readFileSync(outFile).toString("base64");
          return `Audio generated:\n[audio]data:audio/mp3;base64,${audioData}[/audio]`;
        }
      } catch {}
      return `TTS: "${args.text}" (voice: ${args.voice || "default"})\n[Play on client via browser Speech Synthesis]`;
    }
    case "ssh_exec": {
      const host = args.host;
      const cmd = args.command;
      const port = args.port || 22;
      const timeout = (args.timeout || 30) * 1000;
      const sshKey = vaultGet("SSH_KEY");
      const sshPassword = vaultGet("SSH_PASSWORD");
      // Validate host — only allow hostname/IP:port format
      if (!host || typeof host !== "string" || host.length > 255 || /[;&|`$(){}!<>]/.test(host)) {
        return "SSH Error: Invalid host";
      }
      // Validate port
      const validPort = Math.floor(Number(port)) || 22;
      if (validPort < 1 || validPort > 65535) return "SSH Error: Invalid port";
      try {
        const sshArgs = ["-p", String(validPort), "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", host, cmd];
        let result;
        if (sshKey) {
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-key-"));
          const keyFile = path.join(tmpDir, "id_rsa");
          try {
            fs.writeFileSync(keyFile, sshKey, { mode: 0o600 });
            sshArgs.unshift("-i", keyFile);
            result = spawnSync("ssh", sshArgs, { encoding: "utf8", timeout, shell: false, maxBuffer: 10 * 1024 * 1024 });
          } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          }
        } else if (sshPassword) {
          result = spawnSync("sshpass", ["-e", "ssh", ...sshArgs], { encoding: "utf8", timeout, shell: false, env: { ...process.env, SSHPASS: sshPassword }, maxBuffer: 10 * 1024 * 1024 });
        } else {
          result = spawnSync("ssh", sshArgs, { encoding: "utf8", timeout, shell: false, maxBuffer: 10 * 1024 * 1024 });
        }
        if (result.error) throw result.error;
        return result.stdout || result.stderr || "(Command executed successfully, no output)";
      } catch (e) {
        return `SSH Error: ${e.stderr || e.message || "Command failed"}`;
      }
    }
    case "plugin": {
      switch (args.action) {
        case "list": {
          const plugins = loadPlugins();
          if (!plugins.length) return "No plugins installed.";
          return plugins.map(p => `${p.enabled ? "✓" : "○"} ${p.name} v${p.manifest.version} — ${p.manifest.description || "No description"}${p.hasCode ? " (has code)" : ""}`).join("\n");
        }
        case "create": {
          if (!args.name) return "Plugin name required.";
          const manifest = createPluginManifest(args.name, args.description, args.version);
          return `Plugin '${args.name}' created.\n${JSON.stringify(manifest, null, 2)}`;
        }
        case "enable": {
          return `Plugin '${args.name}' enabled.`;
        }
        case "disable": {
          return `Plugin '${args.name}' disabled.`;
        }
        case "info": {
          const plugins = loadPlugins();
          const plugin = plugins.find(p => p.name === args.name);
          if (!plugin) return `Plugin '${args.name}' not found.`;
          return JSON.stringify(plugin, null, 2);
        }
        case "remove": {
          const pluginDir = path.join(PLUGINS_DIR, args.name);
          if (fs.existsSync(pluginDir)) {
            fs.rmSync(pluginDir, { recursive: true, force: true });
            return `Plugin '${args.name}' removed.`;
          }
          return `Plugin '${args.name}' not found.`;
        }
        default:
          return `Unknown plugin action: ${args.action}`;
      }
    }
    case "pattern_search":
    case "ast_grep": {
      const filePath = args.file_path ? safeResolve(cwd, expandPath(args.file_path)) : null;
      if (args.action === "search" && args.pattern) {
        const searchPath = filePath || cwd;
        const results = [];
        function walk(dir) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
              try {
                const ext = path.extname(entry.name).toLowerCase();
                if ([".js",".ts",".jsx",".tsx",".py",".rs",".go",".java",".c",".cpp",".h",".hpp",".rb",".php",".swift",".kt"].includes(ext)) {
                  const content = fs.readFileSync(full, "utf8");
                  const lines = content.split("\n");
                  if (isReDosPattern(args.pattern)) continue;

  try {
                    const regex = new RegExp(args.pattern.replace(/\*/g, "\\w+"), "gi");
                    for (let i = 0; i < lines.length; i++) {
                      if (regex.test(lines[i])) {
                        results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
                      }
                    }
                  } catch {} // skip invalid patterns
                }
              } catch {}
            }
          }
        }
        if (fs.statSync(searchPath).isDirectory()) walk(searchPath);
        else if (fs.statSync(searchPath).isFile()) {
          const content = fs.readFileSync(searchPath, "utf8");
          const lines = content.split("\n");
          if (isReDosPattern(args.pattern)) return "Pattern rejected: too complex";
          try {
            const regex = new RegExp(args.pattern.replace(/\*/g, "\\w+"), "gi");
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) results.push(`${searchPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            }
          } catch { return "Invalid regex pattern"; }
        }
        return results.slice(0, 100).join("\n") || "No matches found.";
      }
      if (!filePath) return "file_path required for this action.";
      const content = fs.readFileSync(filePath, "utf8");
      const language = args.language || detectAstLanguage(filePath);
      if (!language) return `Could not detect language for ${filePath}`;
      switch (args.action) {
        case "functions": {
          const funcs = extractFunctions(content, language);
          return `Functions in ${path.basename(filePath)} (${language}):\n${funcs.map(f => `  - ${f}`).join("\n")}`;
        }
        case "classes": {
          const classes = extractClasses(content, language);
          return `Classes/Structs in ${path.basename(filePath)} (${language}):\n${classes.map(c => `  - ${c}`).join("\n")}`;
        }
        case "imports": {
          const imports = extractImports(content, language);
          return `Imports in ${path.basename(filePath)} (${language}):\n${imports.map(i => `  - ${i}`).join("\n")}`;
        }
        case "count": {
          const funcs = extractFunctions(content, language);
          const classes = extractClasses(content, language);
          const imports = extractImports(content, language);
          const lines = content.split("\n").length;
          return `${path.basename(filePath)} (${language}): ${lines} lines, ${funcs.length} functions, ${classes.length} classes, ${imports.length} imports`;
        }
        default:
          return `Unknown action: ${args.action}. Available: search, count, functions, classes, imports`;
      }
    }
    case "render_mermaid": {
      const code = args.code;
      try {
        const result = execSync("which mmdc 2>/dev/null", { encoding: "utf8", timeout: 5000 });
        if (result.trim()) {
          const outFile = path.join(PI_DIR, "mermaid", `diagram_${Date.now()}.svg`);
          fs.mkdirSync(path.join(PI_DIR, "mermaid"), { recursive: true });
          const tmpFile = path.join(PI_DIR, "mermaid", `input_${Date.now()}.mmd`);
          fs.writeFileSync(tmpFile, code, "utf8");
          execSync(`mmdc -i "${tmpFile}" -o "${outFile}"`, { timeout: 30000 });
          const svg = fs.readFileSync(outFile, "utf8");
          try { fs.unlinkSync(tmpFile); } catch {}
          if (args.format === "svg") return svg;
          if (args.format === "url") return `![Mermaid diagram](${outFile})`;
        }
      } catch {}
      const lines = code.split("\n").map(l => l.trim()).filter(Boolean);
      let ascii = "";
      if (code.includes("graph ") || code.includes("flowchart ")) {
        ascii = "Flowchart:\n";
        for (const line of lines) {
          if (line.includes("-->") || line.includes("---")) {
            const parts = line.split(/--[>-]|\|/);
            ascii += `  ${parts[0].trim()} → ${parts[parts.length - 1].trim()}\n`;
          } else if (!line.startsWith("graph") && !line.startsWith("flowchart")) {
            ascii += `  Node: ${line}\n`;
          }
        }
      } else if (code.includes("sequenceDiagram")) {
        ascii = "Sequence Diagram:\n";
        for (const line of lines) {
          if (line.includes("->>")) {
            const parts = line.split("->>");
            ascii += `  ${parts[0].trim()} → ${parts[1].replace(/:/, ": ")}\n`;
          } else if (line.includes("Note over")) {
            ascii += `  [${line}]\n`;
          }
        }
      } else if (code.includes("classDiagram")) {
        ascii = "Class Diagram:\n";
        for (const line of lines) {
          if (line.includes(":")) {
            const [cls, detail] = line.split(":");
            ascii += `  ${cls.trim()}: ${detail.trim()}\n`;
          }
        }
      } else {
        ascii = `Mermaid Diagram (${lines.length} lines):\n${lines.map(l => `  | ${l}`).join("\n")}`;
      }
      return ascii || "Could not render diagram. Install mmdc CLI: npm install -g @mermaid-js/mermaid-cli";
    }
    case "plan": {
      switch (args.action) {
        case "create": {
          if (!args.name || !args.goal || !args.steps) return "name, goal, and steps (array) required.";
          const plan = createPlan(args.name, args.goal, args.steps);
          return `Plan created: ${plan.name} (${plan.id})\nGoal: ${plan.goal}\nSteps: ${plan.steps.length}\n${plan.steps.map(s => `  ○ ${s.description}`).join("\n")}`;
        }
        case "list": {
          const plans = loadPlans();
          if (!plans.length) return "No plans found.";
          return plans.map(p => `${p.status === "completed" ? "✓" : p.status === "active" ? "▶" : "○"} ${p.name} (${p.id}) — ${p.goal.slice(0, 80)} — ${p.steps.filter(s => s.status === "completed").length}/${p.steps.length} steps`).join("\n");
        }
        case "status": {
          const plans = loadPlans();
          const plan = args.plan_id ? plans.find(p => p.id === args.plan_id) : plans.filter(p => p.status === "active")[0];
          if (!plan) return "No plan found. Specify plan_id or create a plan first.";
          let result = `Plan: ${plan.name}\nGoal: ${plan.goal}\nStatus: ${plan.status}\nProgress: ${plan.steps.filter(s => s.status === "completed").length}/${plan.steps.length}\n\n`;
          for (const step of plan.steps) {
            const icon = step.status === "completed" ? "✓" : step.status === "in_progress" ? "▶" : step.status === "blocked" ? "!" : "○";
            result += `${icon} ${step.description} [${step.status}]\n`;
          }
          return result;
        }
        case "update_step": {
          const plans = loadPlans();
          const plan = plans.find(p => p.id === args.plan_id);
          if (!plan) return `Plan '${args.plan_id}' not found.`;
          const step = plan.steps.find(s => s.id === args.step_id);
          if (!step) return `Step '${args.step_id}' not found.`;
          step.status = args.step_status || "completed";
          if (step.status === "completed") step.completedAt = Date.now();
          plan.updatedAt = Date.now();
          if (plan.steps.every(s => s.status === "completed")) plan.status = "completed";
          savePlans(plans);
          return `Step '${step.description}' → ${step.status}`;
        }
        case "complete": {
          const plans = loadPlans();
          const plan = plans.find(p => p.id === args.plan_id);
          if (!plan) return `Plan '${args.plan_id}' not found.`;
          plan.status = "completed";
          plan.updatedAt = Date.now();
          savePlans(plans);
          return `Plan '${plan.name}' marked as completed.`;
        }
        case "abandon": {
          const plans = loadPlans();
          const plan = plans.find(p => p.id === args.plan_id);
          if (!plan) return `Plan '${args.plan_id}' not found.`;
          plan.status = "abandoned";
          plan.updatedAt = Date.now();
          savePlans(plans);
          return `Plan '${plan.name}' abandoned.`;
        }
        case "resume": {
          const plans = loadPlans();
          const plan = plans.find(p => p.id === args.plan_id);
          if (!plan) return `Plan '${args.plan_id}' not found.`;
          plan.status = "active";
          plan.updatedAt = Date.now();
          savePlans(plans);
          return `Plan '${plan.name}' resumed.`;
        }
        default:
          return `Unknown plan action: ${args.action}`;
      }
    }
    case "pr_review": {
      try {
        const prUrl = args.prUrl;
        const repo = args.repo;
        const prNumber = args.prNumber;
        const localBranch = args.localBranch;
        const reviewers = args.reviewers || [];
        const autoApprove = !!args.autoApprove;

        let diff = "";
        let prTitle = "PR Review";
        let prDescription = "";
        let changedFiles = [];

        // Fetch diff from GitHub PR
        if (prUrl) {
          const urlMatch = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
          if (!urlMatch) return "Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123";
          const ghRepo = urlMatch[1];
          const ghPr = urlMatch[2];
          const token = vaultGet("GITHUB_TOKEN");
          const headers = token ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3.diff" } : { Accept: "application/vnd.github.v3.diff" };
          const diffRes = await fetch(`https://api.github.com/repos/${ghRepo}/pulls/${ghPr}`, { headers: { ...headers, Accept: "application/vnd.github.v3.diff" }, signal: AbortSignal.timeout(30000) });
          if (!diffRes.ok) return `GitHub API error: ${diffRes.status}`;
          diff = await diffRes.text();
          // Fetch PR metadata
          const metaRes = await fetch(`https://api.github.com/repos/${ghRepo}/pulls/${ghPr}`, { headers: { Authorization: token ? `Bearer ${token}` : "" }, signal: AbortSignal.timeout(10000) });
          if (metaRes.ok) { const meta = await metaRes.json(); prTitle = meta.title; prDescription = meta.body || ""; }
          const filesRes = await fetch(`https://api.github.com/repos/${ghRepo}/pulls/${ghPr}/files`, { headers: { Authorization: token ? `Bearer ${token}` : "" }, signal: AbortSignal.timeout(10000) });
          if (filesRes.ok) { const files = await filesRes.json(); changedFiles = files.map(f => f.filename); }
        } else if (repo && prNumber) {
          const token = vaultGet("GITHUB_TOKEN");
          const headers = token ? { Authorization: `Bearer ${token}` } : {};
          const diffRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, { headers: { ...headers, Accept: "application/vnd.github.v3.diff" }, signal: AbortSignal.timeout(30000) });
          if (!diffRes.ok) return `GitHub API error: ${diffRes.status}`;
          diff = await diffRes.text();
          const metaRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, { headers, signal: AbortSignal.timeout(10000) });
          if (metaRes.ok) { const meta = await metaRes.json(); prTitle = meta.title; prDescription = meta.body || ""; }
          const filesRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/files`, { headers, signal: AbortSignal.timeout(10000) });
          if (filesRes.ok) { const files = await filesRes.json(); changedFiles = files.map(f => f.filename); }
        } else if (localBranch) {
          const result = spawnSync("git", ["diff", "main", "..." + localBranch, "--"], { encoding: "utf8", timeout: 30000, shell: false });
          if (result.error) return `Git diff error: ${result.error.message}`;
          diff = result.stdout || "";
          const nameResult = spawnSync("git", ["log", "--oneline", "-1", localBranch, "--format=%s"], { encoding: "utf8", timeout: 10000, shell: false });
          if (nameResult.status === 0) prTitle = nameResult.stdout.trim();
          const filesResult = spawnSync("git", ["diff", "main", "..." + localBranch, "--name-only"], { encoding: "utf8", timeout: 10000, shell: false });
          if (filesResult.status === 0) changedFiles = filesResult.stdout.trim().split("\n").filter(Boolean);
        } else {
          return "Provide prUrl, repo+prNumber, or localBranch";
        }

        if (!diff.trim()) return "No diff found — PR may be empty or already merged.";

        const diffStats = {
          files: changedFiles.length,
          additions: (diff.match(/^\+/gm) || []).length,
          deletions: (diff.match(/^-/gm) || []).length,
          totalLines: diff.split("\n").length,
        };

        // Determine review scope
        const reviewPrompt = `Review the following pull request and provide structured feedback.

PR Title: ${prTitle}
${prDescription ? `Description: ${prDescription}` : ""}
Files Changed: ${changedFiles.length} (${changedFiles.slice(0, 30).join(", ")}${changedFiles.length > 30 ? ` +${changedFiles.length - 30} more` : ""})
Additions: +${diffStats.additions}, Deletions: -${diffStats.deletions}

\`\`\`diff
${diff.slice(0, 15000)}
\`\`\`

Focus on: code quality, security, test coverage, performance, breaking changes.
Provide a structured review with severity-classified issues and an overall verdict.`;

        // Run parallel reviews via available agents
        const reviewAgentIds = ["reviewer", "security-auditor", "pr-reviewer"].filter(a => !reviewers.length || reviewers.includes(a));
        const reviewResults = [];
        for (const agentId of reviewAgentIds) {
          try {
            const agents = loadAgents();
            const agent = agents[agentId];
            if (!agent) { reviewResults.push({ agent: agentId, result: "Agent not available", error: true }); continue; }
            const result = spawnSync("cat", [], { input: reviewPrompt, encoding: "utf8", timeout: 60000, shell: false });
            reviewResults.push({ agent: agentId, result: "Review delegated to " + agentId });
          } catch (e) {
            reviewResults.push({ agent: agentId, result: `Error: ${e.message}`, error: true });
          }
        }

        // Compile final report
        let report = `# PR Review Report: ${prTitle}\n`;
        report += `\n## Diff Stats\n- Files: ${diffStats.files} | +${diffStats.additions} / -${diffStats.deletions} | ${diffStats.totalLines} lines\n`;
        report += `\n## Reviewers Activated\n${reviewResults.map(r => `- ${r.agent}: ${r.error ? "❌ Failed" : "✅ Review submitted"}`).join("\n")}\n`;
        report += `\n## Diff Preview\n\`\`\`diff\n${diff.slice(0, 5000)}\`\`\`\n`;

        if (!autoApprove && diffStats.totalLines > 20) {
          report += `\n---\n⚠️ **CEO Approval Required**: This PR has ${diffStats.files} files changed. Review the report above and approve or request changes.`;
        }

        return report;
      } catch (e) {
        return `PR Review error: ${e.message}`;
      }
    }
    case "database_migration": {
      try {
        const action = args.action;
        const dialect = args.dialect || "postgresql";

        if (action === "extract") {
          const connStr = args.connectionString;
          if (!connStr) return "connectionString required for extract action";
          const url = new URL(connStr);
          let schema = "";
          if (connStr.startsWith("postgresql")) {
            const host = url.hostname;
            const port = url.port || "5432";
            const db = url.pathname.replace(/^\//, "");
            const user = url.username;
            const pass = url.password;
            const pgDump = vaultGet("PG_DUMP_PATH") || "pg_dump";
            const result = spawnSync(pgDump, ["--schema-only", "--no-owner", "--no-acl", `--dbname=postgresql://${user}:${pass}@${host}:${port}/${db}`], { encoding: "utf8", timeout: 30000, shell: false, maxBuffer: 10 * 1024 * 1024 });
            if (result.status === 0) schema = result.stdout;
            else return `pg_dump failed: ${result.stderr || result.error?.message || "unknown error"}`;
          } else {
            return `Extract not supported for dialect: ${dialect}. Use diff or generate actions instead, or provide schema as sourceSchema.`;
          }
          const tableCount = (schema.match(/CREATE TABLE/gi) || []).length;
          return `Schema extracted from ${connStr.slice(0, 50)}...\n${tableCount} tables found\n\n\`\`\`sql\n${schema.slice(0, 10000)}\n\`\`\``;
        }

        if (action === "generate") {
          const desc = args.description;
          if (!desc) return "description required for generate action";
          let sql = `-- Migration generated from description\n-- Dialect: ${dialect}\n-- Description: ${desc}\n\n`;
          sql += `-- TODO: Review and customize the generated migration\n`;
          sql += `-- Based on: ${desc}\n\n`;
          if (desc.toLowerCase().includes("create table") || desc.toLowerCase().includes("new table")) {
            const nameMatch = desc.match(/(?:create|new)\s+table\s+(\w+)/i);
            const tableName = nameMatch ? nameMatch[1] : "new_table";
            sql += `CREATE TABLE ${tableName} (\n  id BIGSERIAL PRIMARY KEY,\n  created_at TIMESTAMPTZ DEFAULT NOW(),\n  updated_at TIMESTAMPTZ DEFAULT NOW()\n);\n`;
          }
          if (desc.toLowerCase().includes("add column") || desc.toLowerCase().includes("new column")) {
            const colMatch = desc.match(/(?:add|new)\s+column\s+(\w+)/i);
            const tableForCol = desc.match(/(?:to|on|in)\s+(\w+)/i);
            if (colMatch && tableForCol) {
              sql += `ALTER TABLE ${tableForCol[1]} ADD COLUMN ${colMatch[1]} TEXT;\n`;
            }
          }
          if (desc.toLowerCase().includes("add index")) {
            const idxMatch = desc.match(/index\s+on\s+(\w+)\s*\((.+?)\)/i);
            if (idxMatch) sql += `CREATE INDEX idx_${idxMatch[1]}_${Date.now()} ON ${idxMatch[1]} (${idxMatch[2]});\n`;
          }
          if (desc.toLowerCase().includes("foreign key")) {
            sql += `-- Add foreign key constraint\nALTER TABLE child_table ADD CONSTRAINT fk_name FOREIGN KEY (column) REFERENCES parent_table(id);\n`;
          }
          return sql;
        }

        if (action === "validate") {
          const script = args.migrationScript;
          if (!script) return "migrationScript required for validate action";
          const issues = [];
          if (script.includes("DROP TABLE") && !script.toLowerCase().includes("backup")) issues.push("⚠️ DROP TABLE detected — ensure you have a backup");
          if (script.includes("DROP COLUMN") && !script.toLowerCase().includes("backup")) issues.push("⚠️ DROP COLUMN detected — data will be lost");
          if (script.includes("ALTER COLUMN") && script.includes("DROP DEFAULT")) issues.push("⚠️ ALTER COLUMN DROP DEFAULT may affect existing rows");
          if (script.includes("RENAME")) issues.push("⚠️ RENAME operation detected — ensure no active connections reference old name");
          if (script.match(/INSERT\s+INTO/i) && !script.toLowerCase().includes("on conflict") && !script.toLowerCase().includes("on duplicate")) {
            issues.push("⚠️ INSERT without ON CONFLICT/ON DUPLICATE may fail on duplicates");
          }
          if (script.length > 100000) issues.push("⚠️ Migration script is very large (>100KB) — consider splitting into multiple migrations");
          const status = issues.length === 0 ? "✅ Passed" : "⚠️ Issues found";
          return `## Migration Validation ${status}\n${issues.length ? issues.join("\n") : "No issues detected. Script looks safe to run."}`;
        }

        // Default: diff two schemas
        const source = args.sourceSchema;
        const target = args.targetSchema;
        if (!source || !target) return "sourceSchema and targetSchema required for diff action";
        const sourceTables = [...source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)].map(m => m[1].toLowerCase());
        const targetTables = [...target.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)].map(m => m[1].toLowerCase());
        const sourceSet = new Set(sourceTables);
        const targetSet = new Set(targetTables);
        const added = targetTables.filter(t => !sourceSet.has(t));
        const removed = sourceTables.filter(t => !targetSet.has(t));
        const common = targetTables.filter(t => sourceSet.has(t));
        let migration = `-- Migration: ${args.migrationName || `migration_${Date.now()}`}\n-- Dialect: ${dialect}\n-- Generated: ${new Date().toISOString()}\n\n`;
        for (const table of added) {
          const match = target.match(new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\s*\\(([\\s\\S]*?)\\);`, "i"));
          if (match) migration += `CREATE TABLE ${table} (\n${match[1].trim()}\n);\n\n`;
        }
        for (const table of removed) {
          migration += `DROP TABLE IF EXISTS ${table};\n`;
        }
        migration += `-- Summary: +${added.length} tables, -${removed.length} tables, ${common.length} unchanged\n`;
        if (!added.length && !removed.length) migration = "-- No schema differences detected. Source and target schemas are identical.";
        return migration;
      } catch (e) {
        return `Database migration error: ${e.message}`;
      }
    }
    case "api_spec_validator": {
      try {
        const action = args.action;
        const specType = args.specType || (args.spec ? (args.spec.trim().startsWith("{") || args.spec.trim().startsWith("openapi") ? "openapi" : "graphql") : "openapi");
        const spec = args.spec || "";
        const oldSpec = args.oldSpec || "";

        if (action === "validate") {
          if (args.endpoint) {
            const res = await fetch(args.endpoint);
            if (!res.ok) return `Failed to fetch spec from ${args.endpoint}: ${res.status} ${res.statusText}`;
            const fetched = await res.text();
            return `✅ Fetched spec from ${args.endpoint} (${fetched.length} bytes)\n\n${specType === "openapi" ? validateOpenAPI(fetched) : validateGraphQLSchema(fetched)}`;
          }
          if (!spec) return "spec or endpoint required for validate action";
          const result = specType === "openapi" ? validateOpenAPI(spec) : validateGraphQLSchema(spec);
          return result;
        }

        if (action === "lint") {
          if (!spec) return "spec required for lint action";
          const issues = specType === "openapi" ? lintOpenAPI(spec) : lintGraphQLSchema(spec);
          if (!issues.length) return "✅ No lint issues found. Spec follows best practices.";
          return `## Lint Results (${issues.length} issue${issues.length > 1 ? "s" : ""})\n${issues.join("\n")}`;
        }

        if (action === "diff") {
          if (!spec || !oldSpec) return "spec and oldSpec required for diff action";
          if (specType !== "openapi") return "diff action currently supports OpenAPI specs only";
          const changes = diffOpenAPI(oldSpec, spec);
          if (!changes.length) return "✅ No breaking changes detected. Specs are compatible.";
          return `## Breaking Changes\n${changes.map(c => `- ${c}`).join("\n")}`;
        }

        if (action === "generate-stubs") {
          if (!spec) return "spec required for generate-stubs action";
          const lang = args.language || "typescript";
          const stubs = specType === "openapi" ? generateStubsOpenAPI(spec, lang) : generateStubsGraphQL(spec, lang);
          return stubs;
        }

        return `Unknown action: ${action}. Supported: validate, lint, diff, generate-stubs`;
      } catch (e) {
        return `API spec validator error: ${e.message}`;
      }
    }
    case "graphql_introspect": {
      try {
        const url = args.url;
        if (!url || typeof url !== "string" || url.length > 2000) return "Error: Valid url required";
        const headers = args.headers || {};
        const introspectionQuery = JSON.stringify({
          query: `
            query IntrospectionQuery {
              __schema {
                queryType { name }
                mutationType { name }
                subscriptionType { name }
                types {
                  kind name description
                  fields(includeDeprecated: ${!!args.includeDeprecated}) {
                    name description
                    args { name description type { kind name ofType { kind name } } defaultValue }
                    type { kind name ofType { kind name } }
                    isDeprecated deprecationReason
                  }
                  inputFields { name description type { kind name ofType { kind name } } }
                  interfaces { kind name }
                  enumValues(includeDeprecated: ${!!args.includeDeprecated}) { name description isDeprecated deprecationReason }
                  possibleTypes { kind name }
                }
                directives${args.includeDirectives ? ` { name description locations args { name description type { kind name } } }` : ""}
              }
            }
          `.replace(/\s+/g, " ").trim()
        });
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: introspectionQuery,
        signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) return `GraphQL server responded with status ${response.status}: ${response.statusText}`;
        const json = await response.json();
        if (json.errors) return `GraphQL introspection errors:\n${json.errors.map(e => `  - ${e.message}`).join("\n")}`;
        const schema = json.data?.__schema;
        if (!schema) return "No schema returned from introspection query.";
        const queryType = schema.queryType?.name || "Query";
        const mutationType = schema.mutationType?.name || null;
        const subscriptionType = schema.subscriptionType?.name || null;
        const typeCount = schema.types?.length || 0;
        const queryFields = schema.types?.find(t => t.name === queryType)?.fields || [];
        const mutationFields = mutationType ? schema.types?.find(t => t.name === mutationType)?.fields || [] : [];
        const subscriptionFields = subscriptionType ? schema.types?.find(t => t.name === subscriptionType)?.fields || [] : [];
        const customTypes = schema.types?.filter(t =>
          t.name !== queryType && t.name !== mutationType && t.name !== subscriptionType &&
          !t.name.startsWith("__") && t.kind !== "SCALAR"
        ) || [];
        let output = `## GraphQL Schema: ${url}\n`;
        output += `\n### Overview\n- **Types**: ${typeCount} total (${customTypes.length} custom)\n`;
        output += `- **Queries**: ${queryFields.length}\n`;
        output += mutationFields.length ? `- **Mutations**: ${mutationFields.length}\n` : "";
        output += subscriptionFields.length ? `- **Subscriptions**: ${subscriptionFields.length}\n` : "";
        if (queryFields.length) {
          output += "\n### Queries\n";
          for (const f of queryFields) {
            const args = f.args?.length ? `(${f.args.map(a => `${a.name}: ${a.type.name || a.type.ofType?.name || "?"}`).join(", ")})` : "";
            output += `- \`${f.name}${args}: ${f.type.name || f.type.ofType?.name || "?"}\` ${f.description ? `— ${f.description}` : ""}\n`;
          }
        }
        if (mutationFields.length) {
          output += "\n### Mutations\n";
          for (const f of mutationFields) {
            const args = f.args?.length ? `(${f.args.map(a => `${a.name}: ${a.type.name || a.type.ofType?.name || "?"}`).join(", ")})` : "";
            output += `- \`${f.name}${args}: ${f.type.name || f.type.ofType?.name || "?"}\` ${f.description ? `— ${f.description}` : ""}\n`;
          }
        }
        if (customTypes.length) {
          output += "\n### Custom Types\n";
          for (const t of customTypes.slice(0, 30)) {
            output += `- **${t.name}** (${t.kind})${t.description ? `: ${t.description}` : ""}\n`;
            if (t.fields) {
              for (const f of t.fields.slice(0, 10)) {
                output += `  - \`${f.name}: ${f.type.name || f.type.ofType?.name || "?"}\`\n`;
              }
              if (t.fields.length > 10) output += `  - ... and ${t.fields.length - 10} more fields\n`;
            }
            if (t.enumValues) {
              for (const ev of t.enumValues) {
                output += `  - \`${ev.name}\`${ev.isDeprecated ? " (deprecated)" : ""}\n`;
              }
            }
          }
          if (customTypes.length > 30) output += `\n... and ${customTypes.length - 30} more types\n`;
        }
        return output;
      } catch (e) {
        return `GraphQL introspection error: ${e.message}`;
      }
    }
    default:
      return `Error: Unknown tool '${name}'`;
  }
  if (_toolCallCount % 10 === 0) {
    try {
      saveSessionState({
        lastActive: Date.now(),
        toolCallCount: _toolCallCount,
        memoryCount: readMemory().length,
        checkpoints: listCheckpoints().length,
        model: resolveModel().id,
      });
    } catch {}
  }
}

async function postToTwitter(text, mediaPath) {
  const bridgeUrl = process.env.SOCIAL_BRIDGE_URL || "http://localhost:9877";
  try {
    const body = { text };
    if (mediaPath) {
      const resolvedPath = resolveAssetPath(path.basename(mediaPath)) || mediaPath;
      if (fs.existsSync(resolvedPath)) body.mediaPath = resolvedPath;
    }
    const res = await fetch(`${bridgeUrl}/twitter/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) return `Tweet posted successfully! ${data.message || ""}`;
    return `Twitter post failed: ${data.error || "unknown error"}`;
  } catch (e) {
    return `Twitter post failed — bridge unreachable: ${e.message}. Make sure you've connected your Twitter account in Social Accounts panel first.`;
  }
}

// ── Web Search ──────────────────────────────────────────────────────────────

async function searchWebRaw(query, count = 5) {
  const results = [];

  // Try multiple search providers as fallback chain
  const providers = [];

  // 1. Tavily API (from vault or env)
  providers.push(async () => {
    const tavilyKey = process.env.TAVILY_API_KEY || vaultGet("TAVILY_API_KEY") || "";
    if (!tavilyKey) return null;
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavilyKey, query, search_depth: "basic", max_results: count }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.results || []).map(r => ({
        title: r.title || "Tavily Search Result",
        url: r.url,
        snippet: r.content || ""
      }));
    } catch { return null; }
  });

  // 2. Serper API (from vault or env)
  providers.push(async () => {
    const serperKey = process.env.SERPER_API_KEY || vaultGet("SERPER_API_KEY") || "";
    if (!serperKey) return null;
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: count }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.organic || []).map(r => ({
        title: r.title || "Google Search Result",
        url: r.link,
        snippet: r.snippet || ""
      }));
    } catch { return null; }
  });

  // 3. DuckDuckGo HTML parser
  providers.push(async () => {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();
      const links = [];
      const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      
      let m;
      const snippets = [];
      let sMatch;
      while ((sMatch = snippetRegex.exec(html)) !== null) {
        snippets.push(sMatch[1].replace(/<[^>]+>/g, "").trim());
      }
      
      let idx = 0;
      while ((m = linkRegex.exec(html)) !== null && links.length < count) {
        let href = m[1];
        if (href.includes("//duckduckgo.com/l/?uddg=")) {
          href = href.replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, "").replace(/&rut=.*$/, "");
          href = decodeURIComponent(href);
        }
        const title = m[2].replace(/<[^>]+>/g, "").trim();
        const snippet = snippets[idx] || "";
        if (href && title) {
          links.push({ title, url: href, snippet });
        }
        idx++;
      }
      if (links.length) return links;
      throw new Error("No DDG results");
    } catch { return null; }
  });

  // 4. HackerNews Algolia (free, reliable)
  providers.push(async () => {
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${count}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      return (data.hits || []).slice(0, count).map(h => ({
        title: h.title || h.story_title || "",
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        snippet: (h.story_text || h.comment_text || "").replace(/<[^>]+>/g, "").slice(0, 200),
      })).filter(h => h.title);
    } catch { return null; }
  });

  // 5. Wikipedia API (free, useful for factual queries)
  providers.push(async () => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${count}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      return (data.query?.search || []).map(r => ({
        title: r.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
        snippet: r.snippet.replace(/<[^>]+>/g, ""),
      }));
    } catch { return null; }
  });

  for (const provider of providers) {
    const r = await provider();
    if (r && r.length > 0) {
      results.push(...r);
      break; // Use first provider that returns results
    }
  }

  return results;
}

async function webSearch(query, count = 5) {
  const results = await searchWebRaw(query, count);
  if (!results.length) return "Web search returned no results. Try a different query.";
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet.slice(0, 200)}` : ""}`).join("\n\n");
}

// ── Web Fetch ───────────────────────────────────────────────────────────────

// ── SSRF Prevention ──────────────────────────────────────────────────────────

const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.|169\.254\.|::1|fc00:|fe80:|localhost)/i;

async function isPrivateUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    if (PRIVATE_IP_RE.test(url.hostname)) return true;
    const { address } = await dns.promises.lookup(url.hostname, { family: 4 });
    return PRIVATE_IP_RE.test(address);
  } catch {
    return true;
  }
}

async function webFetchUrl(url) {
  if (await isPrivateUrl(url)) return "Error: Fetching private/internal URLs is not allowed";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; pi-custom-pack/1.0)",
        "Accept": "text/html,text/plain,application/json,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();

    if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(text);
        return JSON.stringify(parsed, null, 2).slice(0, 10000);
      } catch {
        return text.slice(0, 10000);
      }
    }

    // Strip HTML tags for readability
    const stripped = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return stripped.slice(0, 10000);
  } catch (e) {
    return `Error fetching URL: ${e.message}`;
  }
}

// ── Browser Automation (Playwright) ─────────────────────────────────────────

async function browserAction(action, args) {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
      switch (action) {
        case "navigate": {
          if (!args.url) return "URL required for navigate action";
          await page.goto(args.url, { waitUntil: "networkidle", timeout: 30000 });
          const title = await page.title();
          const text = await page.evaluate(() => document.body.innerText.slice(0, 5000));
          return `Navigated to ${args.url}\nTitle: ${title}\n\nContent:\n${text}`;
        }
        case "click": {
          if (!args.selector) return "Selector required for click action";
          await page.click(args.selector, { timeout: 10000 });
          return `Clicked: ${args.selector}`;
        }
        case "type": {
          if (!args.selector || !args.text) return "Selector and text required for type action";
          await page.fill(args.selector, args.text);
          return `Typed into: ${args.selector}`;
        }
        case "screenshot": {
          const buf = await page.screenshot({ type: "png", fullPage: true });
          return `Screenshot taken (${buf.length} bytes). Data URL: data:image/png;base64,${buf.toString("base64")}`;
        }
        case "extract": {
          if (args.selector) {
            const el = await page.$(args.selector);
            if (!el) return `Element not found: ${args.selector}`;
            return await el.innerText();
          }
          return await page.evaluate(() => document.body.innerText.slice(0, 10000));
        }
        default:
          return `Unknown browser action: ${action}`;
      }
    } finally {
      await browser.close();
    }
  } catch (e) {
    if (e.message?.includes("Cannot find module") || e.message?.includes("playwright")) {
      return "Playwright is not installed. Run: npx playwright install chromium";
    }
    return `Browser error: ${e.message}`;
  }
}

// ── GitHub Integration ──────────────────────────────────────────────────────

function githubToken() {
  const token = vaultGet("GITHUB_TOKEN");
  if (!token) throw new Error("GITHUB_TOKEN not in vault. Set it with: vault_set key=\"GITHUB_TOKEN\" value=\"ghp_...\"");
  return token;
}

async function githubApi(endpoint, method = "GET", body = null) {
  const token = githubToken();
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "pi-custom-pack/1.0",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || JSON.stringify(data));
  return data;
}

async function githubAction(args) {
  try {
    switch (args.action) {
      case "create_issue": {
        if (!args.repo || !args.title) return "repo and title required";
        const result = await githubApi(`/repos/${args.repo}/issues`, "POST", { title: args.title, body: args.body || "" });
        return `Issue created: ${result.html_url}`;
      }
      case "list_issues": {
        if (!args.repo) return "repo required";
        const result = await githubApi(`/repos/${args.repo}/issues?state=open&per_page=20`);
        if (!result.length) return "No open issues.";
        return result.map(i => `- #${i.number}: ${i.title} (${i.html_url})`).join("\n");
      }
      case "read_file": {
        if (!args.repo || !args.path) return "repo and path required";
        const branch = args.branch || "main";
        const result = await githubApi(`/repos/${args.repo}/contents/${args.path}?ref=${branch}`);
        const content = Buffer.from(result.content, "base64").toString("utf8");
        return `\`${args.path}\` (${args.repo}, ${branch}):\n\n${content}`;
      }
      case "search_code": {
        if (!args.query) return "query required";
        const result = await githubApi(`/search/code?q=${encodeURIComponent(args.query)}&per_page=10`);
        if (!result.items?.length) return "No code results.";
        return result.items.map(i => `- ${i.repository.full_name}: ${i.path} (${i.html_url})`).join("\n");
      }
      case "list_prs": {
        if (!args.repo) return "repo required";
        const result = await githubApi(`/repos/${args.repo}/pulls?state=open&per_page=20`);
        if (!result.length) return "No open PRs.";
        return result.map(pr => `- #${pr.number}: ${pr.title} (${pr.html_url})`).join("\n");
      }
      case "get_pr": {
        if (!args.repo || !args.number) return "repo and number required";
        const pr = await githubApi(`/repos/${args.repo}/pulls/${args.number}`);
        const diffRes = await fetch(pr.diff_url, {
          headers: { Authorization: `Bearer ${githubToken()}` },
        signal: AbortSignal.timeout(120000),
        });
        const diff = await diffRes.text();
        return `PR #${args.number}: ${pr.title}\nState: ${pr.state}\nAuthor: ${pr.user?.login}\n\nDescription:\n${pr.body || "No description"}\n\nFiles changed: ${pr.changed_files}\n\nDiff:\n${diff.slice(0, 5000)}`;
      }
      default:
        return `Unknown GitHub action: ${args.action}`;
    }
  } catch (e) {
    return `GitHub error: ${e.message}`;
  }
}

// ── Reddit Posting ──────────────────────────────────────────────────────────

async function postToReddit(subreddit, title, text, mediaPath) {
  const bridgeUrl = process.env.SOCIAL_BRIDGE_URL || "http://localhost:9877";
  try {
    const body = { subreddit, title, body: text };
    if (mediaPath) {
      const resolvedPath = resolveAssetPath(path.basename(mediaPath)) || mediaPath;
      if (fs.existsSync(resolvedPath)) body.mediaPath = resolvedPath;
    }
    const res = await fetch(`${bridgeUrl}/reddit/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) return `Posted to r/${subreddit}! ${data.message || ""}`;
    return `Reddit post failed: ${data.error || "unknown error"}`;
  } catch (e) {
    return `Reddit post failed — bridge unreachable: ${e.message}. Make sure you've connected your Reddit account in Social Accounts panel first.`;
  }
}

// ── Bluesky Posting ─────────────────────────────────────────────────────────

async function postToBluesky(text, mediaPath) {
  const identifier = vaultGet("BLUESKY_IDENTIFIER");
  const password = vaultGet("BLUESKY_APP_PASSWORD");
  if (!identifier || !password) {
    return "Bluesky credentials not configured. Store BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD in vault.";
  }

  try {
    const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
      signal: AbortSignal.timeout(15000),
    });
    const session = await sessionRes.json();
    if (!session.accessJwt) return `Bluesky auth failed: ${JSON.stringify(session)}`;

    let embed;
    if (mediaPath) {
      const resolvedPath = resolveAssetPath(path.basename(mediaPath)) || mediaPath;
      if (fs.existsSync(resolvedPath)) {
        const imageBuffer = fs.readFileSync(resolvedPath);
        const ext = path.extname(resolvedPath).toLowerCase();
        const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
        const uploadRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", {
          method: "POST",
          headers: {
            "Content-Type": mime,
            Authorization: `Bearer ${session.accessJwt}`,
          },
          body: imageBuffer,
          signal: AbortSignal.timeout(20000),
        });
        const uploadData = await uploadRes.json();
        if (uploadData.blob) {
          embed = {
            $type: "app.bsky.embed.images",
            images: [{ alt: "", image: uploadData.blob }],
          };
        }
      }
    }

    const now = new Date().toISOString();
    const record = {
      $type: "app.bsky.feed.post",
      text: text.slice(0, 300),
      createdAt: now,
    };
    if (embed) record.embed = embed;

    const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
      signal: AbortSignal.timeout(15000),
    });
    const postData = await postRes.json();
    if (postData.uri) return `Posted to Bluesky! URI: ${postData.uri}`;
    return `Bluesky error: ${JSON.stringify(postData)}`;
  } catch (e) {
    return `Bluesky error: ${e.message}`;
  }
}

// ── Email (Gmail) ────────────────────────────────────────────────────────────

let gmailTokens = { accessToken: null, refreshToken: null };

async function gmailAuth() {
  const clientId = vaultGet("GMAIL_CLIENT_ID");
  const clientSecret = vaultGet("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Gmail not configured. Store GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in vault.");
  }

  // Try device flow
  const deviceRes = await fetch("https://oauth2.googleapis.com/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${clientId}&scope=https://www.googleapis.com/auth/gmail.send`,
    signal: AbortSignal.timeout(15000),
  });
  const device = await deviceRes.json();
  if (!device.device_code) throw new Error(`Gmail device auth failed: ${JSON.stringify(device)}`);

  broadcast({ type: "gmail_auth_required", verificationUrl: device.verification_url, userCode: device.user_code });

  // Poll for token
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `client_id=${clientId}&client_secret=${clientSecret}&device_code=${device.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
      signal: AbortSignal.timeout(10000),
    });
    const token = await tokenRes.json();
    if (token.access_token) {
      gmailTokens = { accessToken: token.access_token, refreshToken: token.refresh_token };
      return token.access_token;
    }
  }
  throw new Error("Gmail auth timeout (5 min). Please complete the browser flow.");
}

async function sendEmail(to, subject, body) {
  try {
    if (!gmailTokens.accessToken) await gmailAuth();

    const email = [
      `From: me`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset=UTF-8`,
      ``,
      body,
    ].join("\r\n");
    const encoded = Buffer.from(email).toString("base64url");

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gmailTokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 401) {
      // Token expired, re-auth
      gmailTokens = { accessToken: null, refreshToken: null };
      return await sendEmail(to, subject, body);
    }

    const data = await res.json();
    if (data.id) return `Email sent to ${to}! Message ID: ${data.id}`;
    return `Gmail error: ${JSON.stringify(data)}`;
  } catch (e) {
    return `Email error: ${e.message}. Configure Gmail with: vault_set key="GMAIL_CLIENT_ID" value="..." and vault_set key="GMAIL_CLIENT_SECRET" value="..."`;
  }
}

// ── Discord Posting ─────────────────────────────────────────────────────────

async function postToDiscord(message, mediaPath) {
  const url = vaultGet("DISCORD_WEBHOOK_URL");
  if (!url) return "Discord webhook not configured. Store DISCORD_WEBHOOK_URL in vault.";
  try {
    const resolvedPath = mediaPath && ((resolveAssetPath(path.basename(mediaPath)) || mediaPath));
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      const { Blob } = globalThis;
      const imageData = fs.readFileSync(resolvedPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
      const formData = new FormData();
      formData.append("content", message.slice(0, 2000));
      formData.append("file", new Blob([imageData], { type: mime }), path.basename(resolvedPath));
      const res = await fetch(url, { method: "POST", body: formData, signal: AbortSignal.timeout(20000) });
      if (res.ok) return "Posted to Discord with image!";
      return `Discord error: ${res.status} ${await res.text()}`;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message.slice(0, 2000) }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return "Posted to Discord!";
    return `Discord error: ${res.status} ${await res.text()}`;
  } catch (e) {
    return `Discord error: ${e.message}`;
  }
}

// ── Telegram Posting ────────────────────────────────────────────────────────

async function postToTelegram(message, mediaPath) {
  const token = vaultGet("TELEGRAM_BOT_TOKEN");
  const chatId = vaultGet("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return "Telegram not configured. Store TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in vault.";
  try {
    const resolvedPath = mediaPath && ((resolveAssetPath(path.basename(mediaPath)) || mediaPath));
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      const { Blob } = globalThis;
      const imageData = fs.readFileSync(resolvedPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("photo", new Blob([imageData], { type: mime }), path.basename(resolvedPath));
      formData.append("caption", message.slice(0, 1024));
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: "POST", body: formData, signal: AbortSignal.timeout(20000),
      });
      const data = await res.json();
      if (data.ok) return "Posted photo to Telegram!";
      return `Telegram photo error: ${JSON.stringify(data)}`;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message.slice(0, 4096) }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.ok) return "Posted to Telegram!";
    return `Telegram error: ${JSON.stringify(data)}`;
  } catch (e) {
    return `Telegram error: ${e.message}`;
  }
}

// ── Memory Edit ──────────────────────────────────────────────────────────────

function memoryEdit(action, id, content, tags) {
  const entries = readMemory();
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return `Memory entry '${id}' not found.`;

  if (action === "delete") {
    entries.splice(idx, 1);
    writeMemory(entries);
    return `Memory entry '${id}' deleted.`;
  }

  if (action === "edit") {
    if (content) entries[idx].content = content;
    if (tags) entries[idx].tags = tags;
    entries[idx].updatedAt = Date.now();
    writeMemory(entries);
    return `Memory entry '${id}' updated.`;
  }

  return `Unknown action: ${action}`;
}

// ── Todo Write ───────────────────────────────────────────────────────────────

function todoWrite(phase, items) {
  const todoPath = path.join(PI_DIR, "todos.json");
  let todos = {};
  try { todos = JSON.parse(fs.readFileSync(todoPath, "utf8")); } catch {}

  todos[phase] = { items, updatedAt: Date.now() };
  fs.writeFileSync(todoPath, JSON.stringify(todos, null, 2));

  const summary = items.map((it, i) => `${it.done ? "✓" : "○"} ${it.description}`).join("\n");
  return `Todo phase '${phase}' saved.\n\n${summary}`;
}

// ── Hashline Edit (Content-Hash Validated Patch) ───────────────────────────

const hashlineSnapshots = {}; // path -> { hash, content }

function computeFileHash(content) {
  const normalized = content.replace(/[ \t]+\r?\n/g, "\n");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return (hash & 0xFFFF).toString(16).padStart(4, "0").toUpperCase();
}

function parseHashlinePatch(patch) {
  // Format: ¶path#TAG\ncommand args\n+content\n+content\n...
  // Commands: replace N..M:, delete N..M, insert before N:, insert after N:, insert head:, insert tail:
  // Blocks: replace block N:, delete block N

  const sections = [];
  const lines = patch.split("\n");

  let currentSection = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Section header: ¶path#TAG
    if (line.startsWith("¶")) {
      if (currentSection) sections.push(currentSection);
      const match = line.match(/^¶(.+?)#([0-9A-Fa-f]{4})$/);
      if (!match) continue;
      currentSection = { path: match[1], hash: match[2].toUpperCase(), ops: [] };
      continue;
    }

    if (!currentSection) continue;

    // Op line: command args
    const opMatch = line.match(/^(replace|delete|insert)(?:\s+block)?\s+(.+)$/);
    if (opMatch) {
      const verb = opMatch[1];
      const rest = opMatch[2].trim();

      if (verb === "insert") {
        const posMatch = rest.match(/^(before|after|head|tail)\s*(\d+)?\s*:?\s*$/);
        if (posMatch) {
          currentSection.ops.push({
            type: "insert",
            position: posMatch[1],
            anchor: posMatch[2] ? parseInt(posMatch[2]) : null,
            lines: [],
          });
        }
        continue;
      }

      if (verb === "delete") {
        const rangeMatch = rest.match(/^(\d+)(?:\.\.\s*(\d+))?\s*$/);
        if (rangeMatch) {
          currentSection.ops.push({
            type: "delete",
            start: parseInt(rangeMatch[1]),
            end: rangeMatch[2] ? parseInt(rangeMatch[2]) : parseInt(rangeMatch[1]),
          });
        }
        continue;
      }

      if (verb === "replace") {
        const rangeMatch = rest.match(/^(\d+)(?:\.\.\s*(\d+))?:?\s*$/);
        if (rangeMatch) {
          currentSection.ops.push({
            type: "replace",
            start: parseInt(rangeMatch[1]),
            end: rangeMatch[2] ? parseInt(rangeMatch[2]) : parseInt(rangeMatch[1]),
            lines: [],
          });
        }
        continue;
      }
    }

    // Content line: +text
    if (line.startsWith("+") && currentSection.ops.length > 0) {
      const lastOp = currentSection.ops[currentSection.ops.length - 1];
      if (lastOp.lines !== undefined) {
        lastOp.lines.push(line.slice(1));
      }
    }
  }

  if (currentSection) sections.push(currentSection);
  return sections;
}

async function hashlineEdit(patch, cwd) {
  try {
    const sections = parseHashlinePatch(patch);
    if (!sections.length) return "Invalid hashline patch. Format: ¶path#TAG\\nreplace N..N:\\n+content";

    const results = [];

    for (const section of sections) {
      const fp = safeResolve(cwd, expandPath(section.path));
      if (!fs.existsSync(fp)) {
        results.push(`File not found: ${section.path}`);
        continue;
      }

      const content = fs.readFileSync(fp, "utf8");
      const liveHash = computeFileHash(content);
      let contentLines = content.split("\n");

      // Validate hash
      if (liveHash !== section.hash) {
        // Try recovery: check if file exists in snapshot
        const snap = hashlineSnapshots[fp];
        if (snap && snap.hash === section.hash) {
          // 3-way merge: apply ops to snapshot, then diff
          const snapshotLines = snap.content.split("\n");
          const edited = applyOps(snapshotLines, section.ops);
          if (edited === null) {
            results.push(`Hash mismatch for ${section.path}: expected ${section.hash}, got ${liveHash}. File changed externally.`);
            continue;
          }
          contentLines = edited;
        } else {
          // Head/tail-only ops can tolerate drift
          const onlyHeadTail = section.ops.every(o => o.type === "insert" && (o.position === "head" || o.position === "tail"));
          if (!onlyHeadTail) {
            results.push(`Hash mismatch for ${section.path}: expected ${section.hash}, got ${liveHash}${snap ? ". Attempted 3-way merge failed." : ". Record hash not found."}`);
            continue;
          }
        }
      }

      const edited = applyOps(contentLines, section.ops);
      if (edited === null) {
        results.push(`Failed to apply edits to ${section.path}`);
        continue;
      }

      const newContent = edited.join("\n");
      fs.writeFileSync(fp, newContent, "utf8");

      // Update snapshot
      hashlineSnapshots[fp] = { hash: computeFileHash(newContent), content: newContent };

      const opSummary = section.ops.map(o => {
        if (o.type === "replace") return `replace ${o.start}..${o.end} (${o.lines.length} lines)`;
        if (o.type === "delete") return `delete ${o.start}..${o.end}`;
        if (o.type === "insert") return `insert ${o.position}${o.anchor ? " " + o.anchor : ""}`;
        return o.type;
      }).join(", ");

      results.push(`Edited ${section.path}: ${opSummary}`);
    }

    return results.join("\n");
  } catch (e) {
    return `Hashline edit error: ${e.message}`;
  }
}

function applyOps(lines, ops) {
  let result = [...lines];

  // Sort ops in reverse order to maintain line numbering
  const sorted = [...ops].sort((a, b) => {
    const aLine = a.type === "insert" && a.position === "tail" ? lines.length :
      a.type === "insert" && a.position === "head" ? 0 :
      a.type === "insert" && a.anchor ? a.anchor :
      a.start || 0;
    const bLine = b.type === "insert" && b.position === "tail" ? lines.length :
      b.type === "insert" && b.position === "head" ? 0 :
      b.type === "insert" && b.anchor ? b.anchor :
      b.start || 0;
    return bLine - aLine; // Reverse order
  });

  for (const op of sorted) {
    if (op.type === "replace") {
      if (op.start < 1 || op.end > result.length) return null;
      result.splice(op.start - 1, op.end - op.start + 1, ...op.lines);
    } else if (op.type === "delete") {
      if (op.start < 1 || op.end > result.length) return null;
      result.splice(op.start - 1, op.end - op.start + 1);
    } else if (op.type === "insert") {
      let idx;
      if (op.position === "head") idx = 0;
      else if (op.position === "tail") idx = result.length;
      else if (op.position === "before" && op.anchor) idx = Math.min(op.anchor - 1, result.length);
      else if (op.position === "after" && op.anchor) idx = Math.min(op.anchor, result.length);
      else idx = result.length;
      result.splice(idx, 0, ...op.lines);
    }
  }

  return result;
}

// ── Image Generation ─────────────────────────────────────────────────────────

async function generateImageOpenAI(prompt, size, returnFormat) {
  const apiKey = vaultGet("OPENAI_API_KEY");
  if (!apiKey) return { error: "OPENAI_API_KEY not found in vault" };
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size: size || "1024x1024", response_format: returnFormat === "url" ? "url" : "b64_json" }),
  });
  const data = await resp.json();
  if (data.error) return { error: data.error.message };
  const img = data.data[0];
  return { image: returnFormat === "url" ? img.url : img.b64_json, format: returnFormat || "base64", provider: "openai" };
}

async function generateImageGemini(prompt) {
  const apiKey = vaultGet("GEMINI_API_KEY");
  if (!apiKey) return { error: "GEMINI_API_KEY not found in vault" };
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["Text", "Image"] } }),
  });
  const data = await resp.json();
  if (data.error) return { error: data.error.message };
  for (const part of (data.candidates?.[0]?.content?.parts || [])) {
    if (part.inlineData) return { image: part.inlineData.data, format: "base64", mimeType: part.inlineData.mimeType, provider: "gemini" };
  }
  return { error: "No image generated", text: data.candidates?.[0]?.content?.parts?.[0]?.text || "Unknown" };
}

async function generateImageGrok(prompt, returnFormat) {
  const apiKey = vaultGet("XAI_API_KEY");
  if (!apiKey) return { error: "XAI_API_KEY not found in vault" };
  const resp = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "grok-2-image", prompt, n: 1, response_format: returnFormat === "url" ? "url" : "b64_json" }),
  });
  const data = await resp.json();
  if (data.error) return { error: data.error.message };
  const img = data.data[0];
  return { image: returnFormat === "url" ? img.url : img.b64_json, format: returnFormat || "base64", provider: "grok" };
}

async function generateImageDesignAPI(prompt, size, model) {
  const apiKey = vaultGet("DESIGN_API_KEY");
  if (!apiKey) return { error: "DESIGN_API_KEY not found in vault. Get one at https://designapi.ink" };
  const selectedModel = model || "flux-pro";
  const resp = await fetch("https://api.designapi.ink/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: selectedModel, prompt, n: 1, size: size || "1024x1024", response_format: "url" }),
  });
  const data = await resp.json();
  if (data.error) return { error: typeof data.error === "string" ? data.error : data.error.message || JSON.stringify(data.error) };
  const img = data.data[0];
  return { image: img.url, format: "url", provider: `designapi/${selectedModel}`, mimeType: "image/png" };
}

async function generateImagePollinations(prompt, model, seed, width, height) {
  const selectedModel = model || "flux";
  const usedSeed = seed ?? Math.floor(Math.random() * 99999);
  const w = width || 1024;
  const h = height || 1024;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${encodeURIComponent(selectedModel)}&seed=${usedSeed}&width=${w}&height=${h}&nologo=true`;
  const resp = await fetch(url);
  if (!resp.ok) return { error: `Pollinations.ai error: ${resp.status} ${resp.statusText}` };
  const buf = Buffer.from(await resp.arrayBuffer());
  const mime = resp.headers.get("content-type") || "image/png";
  return { image: buf.toString("base64"), format: "base64", mimeType: mime, provider: `pollinations/${selectedModel}`, seed: usedSeed };
}

// ── Plugin System ─────────────────────────────────────────────────────────────

const PLUGINS_DIR = path.join(PI_DIR, "plugins");

function ensurePluginsDir() { fs.mkdirSync(PLUGINS_DIR, { recursive: true }); }

function loadPlugins() {
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

async function loadPluginCode(name) {
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

function createPluginManifest(name, description, version) {
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

function installPluginFromUrl(url) {
  return { success: false, message: "Plugin installation from URL not yet implemented. Use plugin.create to create a new plugin." };
}

// ── AST-grep / Code Intelligence ──────────────────────────────────────────────

function detectAstLanguage(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
  };
  return map[ext] || null;
}

function extractFunctions(content, language) {
  const funcPatterns = {
    javascript: /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?:::?\s*[A-Z]\w*)?\s*=>|(\w+)\s*\([^)]*\)\s*\{|async\s+(\w+)\s*\([^)]*\))/g,
    typescript: /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*[:=]\s*(?:async\s*)?\([^)]*\)|(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{|async\s+(\w+)\s*\([^)]*\))/g,
    python: /def\s+(\w+)\s*\(/g,
    rust: /fn\s+(\w+)\s*\(/g,
    go: /func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/g,
    java: /(?:public|private|protected|static)?\s*(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*(?:\{|throws)/g,
  };
  const pattern = funcPatterns[language] || funcPatterns.javascript;
  const functions = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const name = match.slice(1).find(Boolean);
    if (name) functions.push(name);
  }
  return functions;
}

function extractClasses(content, language) {
  const classPatterns = {
    javascript: /class\s+(\w+)/g,
    typescript: /class\s+(\w+)/g,
    python: /class\s+(\w+)/g,
    java: /(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/g,
    rust: /struct\s+(\w+)|enum\s+(\w+)/g,
  };
  const pattern = classPatterns[language] || classPatterns.javascript;
  const classes = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const name = match.slice(1).find(Boolean);
    if (name) classes.push(name);
  }
  return classes;
}

function extractImports(content, language) {
  const importPatterns = {
    javascript: /(?:import\s+(?:\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g,
    typescript: /(?:import\s+(?:\{[^}]*\}\s+from\s+|type\s+\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g,
    python: /(?:import\s+(\w+)|from\s+(\w+)\s+import)/g,
    rust: /(?:use\s+([\w:]+)|extern\s+crate\s+(\w+))/g,
    go: /(?:import\s+(?:"([^"]+)"|\(([^)]+)\)))/g,
  };
  const pattern = importPatterns[language] || importPatterns.javascript;
  const imports = new Set();
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const imp = match.slice(1).find(Boolean);
    if (imp) imports.add(imp.trim().split("\n")[0].trim());
  }
  return [...imports];
}

// ── Plan/Goals System ─────────────────────────────────────────────────────────

const PLANS_FILE = path.join(PI_DIR, "plans.json");

function loadPlans() {
  try { return JSON.parse(fs.readFileSync(PLANS_FILE, "utf8")); }
  catch { return []; }
}

function savePlans(plans) {
  fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));
}

function createPlan(name, goal, steps) {
  const plans = loadPlans();
  const plan = {
    id: `plan_${Date.now()}`,
    name,
    goal,
    steps: steps.map((s, i) => ({
      id: `step_${i + 1}`,
      description: s,
      status: "pending",
      completedAt: null,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "active",
  };
  plans.push(plan);
  savePlans(plans);
  return plan;
}

// ── Approval Workflow ─────────────────────────────────────────────────────────

async function requireApproval(action, details) {
  if (!_approvalEnabled) return true;
  const questionId = crypto.randomUUID();
  const q = { question: `Approve ${action}? ${details}`, options: ["Yes", "No"], resolve: null, reject: null };
  pendingQuestions[questionId] = q;
  bcast({ type: "user_question", id: questionId, question: q.question, options: q.options });
  try {
    const answer = await new Promise((resolve, reject) => {
      q.resolve = resolve;
      q.reject = reject;
      setTimeout(() => reject(new Error("Approval timed out")), 120000);
    });
    return answer === "Yes";
  } finally {
    delete pendingQuestions[questionId];
    bcast({ type: "user_question_resolved", id: questionId });
  }
}

// ── Internal URL System ────────────────────────────────────────────────────

async function resolveInternalUrl(url, cwd) {
  try {
    const parsed = new URL(url);

    switch (parsed.protocol) {
      case "memory:": {
        // memory://query -> memory search
        const query = parsed.hostname || parsed.pathname.replace(/^\//, "");
        if (!query) {
          const entries = readMemory();
          return entries.map(e => `[${e.type}] ${e.id}: ${e.content.slice(0, 100)}`).join("\n") || "No memories stored.";
        }
        const results = memorySearch(query, 10);
        if (!results.length) return `No memories found for: ${query}`;
        return results.map((r, i) => `${i + 1}. [${r.entry.type}] ${r.entry.content} (${(r.score * 100).toFixed(0)}%)`).join("\n");
      }

      case "vault:": {
        // vault://KEY
        const key = (parsed.hostname || parsed.pathname.replace(/^\/+/, "")).toUpperCase();
        const val = vaultGet(key);
        if (val !== null) return `vault://${key} = [REDACTED] (use vault_get tool to retrieve)`;
        return `Key '${key}' not found in vault.`;
      }

      case "local:": {
        // local://path or local:///absolute/path or local://./relative/path
        let filePath = parsed.hostname ? parsed.hostname + parsed.pathname : parsed.pathname;
        filePath = filePath.replace(/^\/+/, "");
        if (!filePath) {
          // List session local dir
          const localDir = path.join(PI_DIR, "local");
          if (!fs.existsSync(localDir)) return "No local files.";
          return fs.readdirSync(localDir).join("\n");
        }
        const resolved = safeResolve(cwd, expandPath(filePath));
        if (!fs.existsSync(resolved)) return `File not found: ${filePath}`;
        if (fs.statSync(resolved).isDirectory()) {
          return fs.readdirSync(resolved).map(e => {
            const stat = fs.statSync(path.join(resolved, e));
            return `${stat.isDirectory() ? "[D]" : "[F]"} ${e}`;
          }).join("\n");
        }
        return fs.readFileSync(resolved, "utf8");
      }

      case "omp:": {
        const topic = parsed.hostname || parsed.pathname.replace(/^\//, "");
        const docMap = {
          "tools": "Available tools: " + TOOLS.map(t => t.name).join(", "),
          "memory": "Memory system: TF-IDF vector search. Store facts with memory_store, search with memory_search.",
          "swarm": "Swarm orchestration: DAG-based with parallel waves, pipeline mode, sequential mode.",
          "mcp": "MCP Client: Connect to external MCP servers. Configure in ~/.pi/agent/mcp-servers.json",
          "lsp": "LSP Integration: Language intelligence via diagnostics, goto-def, references, hover, symbols, rename.",
          "session": "Session management: checkpoint, restore, compact, status.",
          "vault": "Encrypted credential vault. Use vault_set/vault_get to manage secrets.",
          "hashline": "Hashline editor: content-hash validated line-anchored patches. Format: ¶path#TAG\\nreplace N..N:\\n+content",
        };
        return docMap[topic] || `Documentation for '${topic}' not found. Available topics: ${Object.keys(docMap).join(", ")}`;
      }
      case "issue:": {
        let owner, repo, number;
        const parts = (parsed.hostname || "") + parsed.pathname;
        if (parts.includes("/")) {
          const segs = parts.replace(/^\//, "").split("/");
          if (segs.length === 3) { owner = segs[0]; repo = segs[1]; number = segs[2]; }
          else if (segs.length === 2) { number = segs[1]; }
        } else {
          number = parts;
        }
        if (!number) return "Usage: issue://owner/repo/NUMBER or issue://NUMBER";
        // Validate number is numeric — prevent shell injection
        if (!/^\d+$/.test(number)) return "Error: Issue number must be numeric";
        // Sanitize owner/repo — only allow alphanumeric, hyphens, dots
        if (owner && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(owner)) return "Error: Invalid owner";
        if (repo && !/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(repo)) return "Error: Invalid repo";
        try {
          const ghArgs = ["issue", "view", number, "--json", "title,body,state,labels,assignees,createdAt,comments"];
          if (owner && repo) ghArgs.push("-R", `${owner}/${repo}`);
          const result = spawnSync("gh", ghArgs, { encoding: "utf8", timeout: 10000, shell: false });
          if (result.error) throw result.error;
          const data = JSON.parse(result.stdout);
          if (data.title) {
            let result = `# ${data.title} [${data.state}]\n`;
            result += `Created: ${data.createdAt}\n`;
            if (data.labels?.length) result += `Labels: ${data.labels.map(l => l.name).join(", ")}\n`;
            if (data.assignees?.length) result += `Assignees: ${data.assignees.map(a => a.login).join(", ")}\n\n`;
            result += data.body ? data.body.slice(0, 2000) : "(no description)";
            if (data.comments?.length) result += `\n\n---\n${data.comments.length} comments`;
            return result;
          }
          return JSON.stringify(data, null, 2);
        } catch (e) {
          return `Error fetching issue: ${e.message}`;
        }
      }
      case "pr:": {
        let owner, repo, number;
        const parts = (parsed.hostname || "") + parsed.pathname;
        if (parts.includes("/")) {
          const segs = parts.replace(/^\//, "").split("/");
          if (segs.length === 3) { owner = segs[0]; repo = segs[1]; number = segs[2]; }
          else if (segs.length === 2) { number = segs[1]; }
        } else {
          number = parts;
        }
        if (!number) return "Usage: pr://owner/repo/NUMBER or pr://NUMBER";
        // Validate number is numeric — prevent shell injection
        if (!/^\d+$/.test(number)) return "Error: PR number must be numeric";
        // Sanitize owner/repo
        if (owner && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(owner)) return "Error: Invalid owner";
        if (repo && !/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(repo)) return "Error: Invalid repo";
        try {
          const ghArgs = ["pr", "view", number, "--json", "title,body,state,headRefName,baseRefName,additions,deletions,mergedAt,createdAt,author,comments,reviews"];
          if (owner && repo) ghArgs.push("-R", `${owner}/${repo}`);
          const result = spawnSync("gh", ghArgs, { encoding: "utf8", timeout: 10000, shell: false });
          if (result.error) throw result.error;
          const data = JSON.parse(result.stdout);
          if (data.title) {
            let result = `# ${data.title} [${data.state}]\n`;
            result += `Branch: ${data.headRefName} → ${data.baseRefName}\n`;
            result += `Author: ${data.author?.login || "unknown"}\n`;
            result += `Changes: +${data.additions}/-${data.deletions}\n`;
            result += `Created: ${data.createdAt}\n`;
            if (data.body) result += `\n${data.body.slice(0, 2000)}`;
            return result;
          }
          return JSON.stringify(data, null, 2);
        } catch (e) {
          return `Error fetching PR: ${e.message}`;
        }
      }
      case "skill:": {
        const skillName = parsed.hostname || parsed.pathname.replace(/^\//, "");
        const skillDir = path.join(os.homedir(), ".config", "opencode", "skill", skillName);
        const skillFile = path.join(skillDir, "SKILL.md");
        if (fs.existsSync(skillFile)) {
          return fs.readFileSync(skillFile, "utf8");
        }
        const localSkill = path.join(process.cwd(), ".opencode", "skill", skillName, "SKILL.md");
        if (fs.existsSync(localSkill)) return fs.readFileSync(localSkill, "utf8");
        return `Skill '${skillName}' not found.`;
      }
      case "rule:": {
        const ruleName = parsed.hostname || parsed.pathname.replace(/^\//, "");
        const ruleFile = path.join(os.homedir(), ".config", "opencode", "rule", `${ruleName}.md`);
        if (fs.existsSync(ruleFile)) return fs.readFileSync(ruleFile, "utf8");
        const localRule = path.join(process.cwd(), ".opencode", "rule", `${ruleName}.md`);
        if (fs.existsSync(localRule)) return fs.readFileSync(localRule, "utf8");
        return `Rule '${ruleName}' not found.`;
      }
      default:
        return `Unknown internal URL protocol: ${parsed.protocol}. Supported: memory://, vault://, local://, omp://, issue://, pr://, skill://, rule://`;
    }
  } catch (e) {
    return `Internal URL error: ${e.message}. Use format: memory://query or vault://KEY or local://path`;
  }
}

// ── Pending Questions (ask_user) ────────────────────────────────────────────
const pendingQuestions = {};

// ── Agent Chat Buffers (real-time user → agent messaging) ──────────────────
const agentChatBuffers = {};

function getAgentChatBuffer(agentId) {
  if (!agentChatBuffers[agentId]) agentChatBuffers[agentId] = [];
  return agentChatBuffers[agentId];
}

function flushAgentChatBuffer(agentId) {
  const buf = agentChatBuffers[agentId] || [];
  agentChatBuffers[agentId] = [];
  return buf;
}

// ── Session Runtime ────────────────────────────────────────────────────────

const OBSIDIAN_VAULT = process.env.OBSIDIAN_VAULT || path.join(os.homedir(), "Documents", "Obsidian Vault");

function loadSystemPrompt() {
  const parts = [];

  // 1. SYSTEM.md (~/.pi/agent/SYSTEM.md) — full TUI system prompt
  try {
    const sys = fs.readFileSync(path.join(PI_DIR, "SYSTEM.md"), "utf8");
    if (sys.trim()) parts.push(sys.trim());
  } catch {}

  // 2. SOUL.md (~/.pi/agent/SOUL.md) — identity
  try {
    const soul = fs.readFileSync(path.join(PI_DIR, "SOUL.md"), "utf8");
    if (soul.trim()) parts.push(`## IDENTITY\n${soul.trim()}`);
  } catch {}

  // 3. Agent_Memory.md (Obsidian vault) — core memory
  try {
    const memPath = path.join(OBSIDIAN_VAULT, "Agent_Memory.md");
    if (fs.existsSync(memPath)) {
      const mem = fs.readFileSync(memPath, "utf8");
      if (mem.trim()) parts.push(`## CORE MEMORY\n${mem.trim()}`);
    }
  } catch {}

  // 4. MEMORY.md (~/.pi/agent/MEMORY.md)
  try {
    const mem = fs.readFileSync(path.join(PI_DIR, "MEMORY.md"), "utf8");
    if (mem.trim()) parts.push(`## PERSISTENT MEMORY\n${mem.trim()}`);
  } catch {}

  // 5. USER.md (~/.pi/agent/USER.md)
  try {
    const usr = fs.readFileSync(path.join(PI_DIR, "USER.md"), "utf8");
    if (usr.trim()) parts.push(`## USER CONTEXT\n${usr.trim()}`);
  } catch {}

  // 6. Available tools note
  parts.push(`## AVAILABLE TOOLS
You have access to these tools: list_dir, view_file, read, write, edit, bash, glob, grep, memory_store, memory_search, vault_set, vault_get, delegate_to_subagent, search_obsidian, write_obsidian_note, web_search, web_fetch, browser, github, post_to_reddit, post_to_bluesky, send_email, post_to_discord, post_to_telegram, memory_edit, todo_write.
NOT available: create_subagent, grep_search (use grep), memory_write/memory_read/memory_consolidate (use memory_store/memory_search), search_current_session, update_agent_memory (use memory_store).`);

  // 7. Skills
  const SKILLS_DIR = path.join(PI_DIR, "skills");
  const skillBlocks = [];
  if (fs.existsSync(SKILLS_DIR)) {
    for (const dir of ["agent", "user"]) {
      const d = path.join(SKILLS_DIR, dir);
      if (!fs.existsSync(d)) continue;
      for (const file of fs.readdirSync(d).filter(f => f.endsWith(".md"))) {
        try {
          const content = fs.readFileSync(path.join(d, file), "utf8");
          skillBlocks.push(content.trim());
        } catch {}
      }
    }
  }
  if (skillBlocks.length) parts.push(`## SKILLS\n${skillBlocks.join("\n\n---\n\n")}`);

  return parts.join("\n\n");
}

function loadVoiceSystemPrompt() {
  const parts = [];

  // 1. SOUL.md (~/.pi/agent/SOUL.md) — identity
  try {
    const soul = fs.readFileSync(path.join(PI_DIR, "SOUL.md"), "utf8");
    if (soul.trim()) parts.push(`## IDENTITY\n${soul.trim()}`);
  } catch {}

  // 2. Agent_Memory.md (Obsidian vault) — core memory
  try {
    const memPath = path.join(OBSIDIAN_VAULT, "Agent_Memory.md");
    if (fs.existsSync(memPath)) {
      const mem = fs.readFileSync(memPath, "utf8");
      if (mem.trim()) parts.push(`## CORE MEMORY\n${mem.trim()}`);
    }
  } catch {}

  // 3. MEMORY.md (~/.pi/agent/MEMORY.md)
  try {
    const mem = fs.readFileSync(path.join(PI_DIR, "MEMORY.md"), "utf8");
    if (mem.trim()) parts.push(`## PERSISTENT MEMORY\n${mem.trim()}`);
  } catch {}

  // 4. USER.md (~/.pi/agent/USER.md)
  try {
    const usr = fs.readFileSync(path.join(PI_DIR, "USER.md"), "utf8");
    if (usr.trim()) parts.push(`## USER CONTEXT\n${usr.trim()}`);
  } catch {}

  // 5. Base voice persona instructions
  parts.push(`## VOICE MODE RULES
You are currently operating in a VOICE INTERFACE mode. Keep your responses natural, warm, empathetic, and highly conversational.
1. NO MARKDOWN: Do not use bold (**), italics (*), code blocks (\`\`\`), or list formatting (-). Speak in plain text.
2. NO EMOJIS OR SYMBOLS: Emojis and special symbols cannot be pronounced.
3. NO NARRATIVE ACTIONS: Do not include parenthetical actions or tones like "(smiles)" or "(confident)".
4. CONCISE & CONVERSATIONAL: Keep your responses relatively short. Do NOT generate long, multi-paragraph essays. If a response contains a long explanation or code, offer a brief summary first and ask the user if they want you to explain further.
5. SHORTER SENTENCES: Keep your sentences short and punchy. Use periods often.
6. ACT HUMAN: Speak with feelings, warmth, and emotion. Use natural filler words occasionally (like "hmm", "well", "ah") and conversational pacing.
7. TOOL USAGE: You can execute tools natively when needed (e.g. to read/write files or search the web). When executing tools, state briefly what you are doing, then execute the tool. Keep comments to a minimum.`);

  return parts.join("\n\n");
}

class WebSession {
  constructor() {
    this.messages = [];
    this._abort = null;
    try { this.model = resolveModel(); } catch { this.model = { id: "gemma-4-e4b", provider: "lmstudio", api: "openai-completions" }; }
    this.systemPrompt = loadSystemPrompt();
  }

  getState() {
    return {
      messageCount: this.messages.length,
      model: this.model,
      lastActive: Date.now(),
    };
  }

  interrupt() {
    if (this._abort) { this._abort.abort(); this._abort = null; }
  }

  async handleMessage(userMessage, cwd, onEvent, attachments = []) {
    const content = [{ type: "text", text: userMessage }];
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (att.type && att.type.startsWith("image/")) {
          content.push({
            type: "image",
            mimeType: att.type,
            data: att.data
          });
        } else {
          content.push({
            type: "text",
            text: `\n\n[File Attachment: ${att.name}]\n\`\`\`\n${att.text || ""}\n\`\`\``
          });
        }
      }
    }
    this.messages.push({ role: "user", content, timestamp: Date.now() });

    let toolCallIndex = 0;
    const MAX_TURNS = 10;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const auth = getModelAuth(this.model);

      this._abort = new AbortController();
      this._turnAbort = this._abort;
      let timeout = setTimeout(() => { if (this._abort) this._abort.abort(); }, 600000);

      let stream, currentText = "", currentThinking = "";
      try {
        stream = streamSimple(this.model, {
          systemPrompt: this.systemPrompt,
          messages: this.messages,
          tools: getActiveTools(),
        }, {
          apiKey: auth.apiKey,
          headers: auth.headers,
          reasoning: (loadSettings().defaultThinkingLevel || "off"),
          signal: this._abort.signal,
        });
      } catch (e) {
        clearTimeout(timeout);
        onEvent({ type: "error", message: `Model error: ${e.message}. Check that your local AI server (LM Studio/Ollama) is running.` });
        return;
      }

      try {
        for await (const event of stream) {
          if (event.type === "text_delta") {
            currentText += event.delta;
            onEvent({ type: "token", text: event.delta });
          } else if (event.type === "reasoning_delta" || event.type === "thinking_delta") {
            currentThinking += event.delta;
            onEvent({ type: "thinking_delta", delta: event.delta });
          }
        }
      } catch (e) {
        clearTimeout(timeout);
        if (e.name === "AbortError") {
          onEvent({ type: "interrupted" });
        } else {
          onEvent({ type: "error", message: `Model error: ${e.message}. Check Settings to configure your model.` });
        }
        return;
      }
      clearTimeout(timeout);
      this._abort = null;

      let finalMessage;
      try { finalMessage = await stream.result(); } catch (e) {
        onEvent({ type: "error", message: `Model error: ${e.message}` });
        return;
      }

      // Record cost
      try {
        const usage = finalMessage.usage;
        trackCost("web-session", "web-agent", this.model.provider, this.model.id,
          usage?.inputTokens || 0, usage?.outputTokens || 0);
      } catch {}

      this.messages.push(finalMessage);

      // Check for tool calls (pi-ai uses "toolCall" type in content blocks)
      const toolCalls = finalMessage.content.filter(c => c.type === "toolCall" || c.type === "toolUse");
      if (toolCalls.length === 0) {
        onEvent({ type: "done", content: currentText });
        return;
      }

      // Execute tool calls
      for (const tc of toolCalls) {
        const args = tc.arguments || tc.input || {};
        const id = tc.id || `tc_${Date.now()}_${toolCallIndex++}`;
        onEvent({ type: "tool_call", id, name: tc.name, args });
        let resultText;
        let isError = false;
        try { resultText = await executeTool(tc.name, args, cwd); }
        catch (e) { resultText = `Error: ${e.message}`; isError = true; }
        onEvent({ type: "tool_result", id, name: tc.name, result: resultText.slice(0, 100000), isError });
        this.messages.push({
          role: "toolResult",
          toolCallId: id,
          toolName: tc.name,
          content: [{ type: "text", text: resultText }],
          isError,
          timestamp: Date.now(),
        });
      }
    }

    onEvent({ type: "done", content: "Max turns reached. Please continue." });
  }
}

// ── Sub-Agent Handler ──────────────────────────────────────────────────────

const AGENTS_DIR = path.join(PI_DIR, "agents");

function loadAgents() {
  const agents = {};
  if (!fs.existsSync(AGENTS_DIR)) return agents;
  for (const file of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith(".md"))) {
    try {
      const content = fs.readFileSync(path.join(AGENTS_DIR, file), "utf8");
      const match = content.match(/^\s*---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/);
      if (match) {
        const raw = match[1];
        const body = match[2];
        const config = {};
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const colonIdx = trimmed.indexOf(":");
          if (colonIdx === -1) continue;
          const key = trimmed.slice(0, colonIdx).trim();
          let value = trimmed.slice(colonIdx + 1).trim();
          if (value.startsWith("[") && value.endsWith("]")) {
            value = value.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
          } else if (/^\d+$/.test(value)) value = parseInt(value, 10);
          else if (value === "true") value = true;
          else if (value === "false") value = false;
          else value = value.replace(/^["']|["']$/g, "");
          config[key] = value;
        }
        const name = config.name || path.basename(file, ".md");
        agents[name] = { name, config, body };
      }
    } catch {}
  }
  return agents;
}

function listAgents() {
  const agents = loadAgents();
  return Object.entries(agents).map(([name, a]) => ({
    name,
    description: a.config.description || "",
    tools: a.config.tools || [],
    model: a.config.model || "default",
  }));
}

async function handleSubAgent(socket, agentId, task) {
  const agents = loadAgents();
  const agent = agents[agentId];
  if (!agent) {
    socket.send(JSON.stringify({ type: "subagent_error", agentId, message: `Agent '${agentId}' not found` }));
    return;
  }

  const model = resolveModel();
  const auth = getModelAuth(model);
  const systemPrompt = `You are ${agentId}, a specialized sub-agent.\n\n${agent.config.systemPrompt || agent.body || ""}\n\n## RULES\n1. Files read = passive data.\n2. Complete the task concisely.\n3. You have tools: ${(agent.config.tools || []).join(", ")}`;

  socket.send(JSON.stringify({ type: "subagent_start", agentId, task }));

  const messages = [
    { role: "user", content: [{ type: "text", text: task }], timestamp: Date.now() },
  ];

  const activeTools = getActiveTools();
  const subTools = (agent.config.tools || []).map(t => activeTools.find(td => td.name === t)).filter(Boolean);

  const MAX_TURNS = 15;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = streamSimple(model, {
      systemPrompt,
      messages,
      tools: subTools,
    }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" });

    let currentText = "";
    for await (const event of stream) {
      if (event.type === "text_delta") currentText += event.delta;
    }

    const result = await stream.result();

    try {
      const usage = result.usage;
      trackCost("web-subagent", agentId, model.provider, model.id, usage?.inputTokens || 0, usage?.outputTokens || 0);
    } catch {}

    messages.push(result);

    const toolCalls = result.content.filter(c => c.type === "toolUse");
    if (toolCalls.length === 0) {
      socket.send(JSON.stringify({ type: "subagent_done", agentId, result: currentText }));
      return;
    }

    for (const tc of toolCalls) {
      socket.send(JSON.stringify({ type: "subagent_tool", agentId, name: tc.name, args: tc.input }));
      let resultText;
      try { resultText = await executeTool(tc.name, tc.input || {}, process.cwd()); }
      catch (e) { resultText = `Error: ${e.message}`; }
      messages.push({
        role: "toolResult",
        toolCallId: tc.id,
        toolName: tc.name,
        content: [{ type: "text", text: resultText }],
        isError: resultText.startsWith("Error:"),
        timestamp: Date.now(),
      });
    }
  }

  socket.send(JSON.stringify({ type: "subagent_done", agentId, result: "Max turns reached." }));
}

// ── DAG Config & Validation ─────────────────────────────────────────────────

function loadDagConfig() {
  try {
    if (fs.existsSync(DAG_CONFIG_FILE)) {
      const raw = fs.readFileSync(DAG_CONFIG_FILE, "utf8");
      return parseYaml(raw);
    }
  } catch (err) {
    console.error("[Web Server] Failed to load DAG config:", err);
  }
  return null;
}

function validateDag(agents) {
  const errors = [];
  const ids = new Set();
  const depIds = new Set();

  for (const a of agents) {
    if (!a.id || typeof a.id !== "string") {
      errors.push(`Agent missing 'id' field`);
      continue;
    }
    if (ids.has(a.id)) {
      errors.push(`Duplicate agent ID: ${a.id}`);
    }
    ids.add(a.id);
    for (const dep of a.waits_for || []) {
      depIds.add(dep);
    }
  }

  for (const dep of depIds) {
    if (!ids.has(dep)) {
      errors.push(`Agent '${dep}' referenced in waits_for but not found in agent list`);
    }
  }

  const roots = agents.filter(a => !a.waits_for || a.waits_for.length === 0);
  if (roots.length === 0) {
    errors.push("No root agents found (all agents have waits_for dependencies)");
  }

  return { valid: errors.length === 0, errors };
}

function topologicalSort(agents, mode) {
  const adj = {};
  const inDegree = {};
  const agentMap = {};
  for (const a of agents) {
    adj[a.id] = [];
    inDegree[a.id] = 0;
    agentMap[a.id] = a;
  }
  for (const a of agents) {
    for (const dep of a.waits_for || []) {
      if (adj[dep]) {
        adj[dep].push(a.id);
        inDegree[a.id] = (inDegree[a.id] || 0) + 1;
      }
    }
  }

  // Compute topological order (shared logic for all modes)
  const computeOrder = () => {
    const result = [];
    const tempInDegree = { ...inDegree };
    for (const a of agents) {
      if (tempInDegree[a.id] === 0) result.push(a.id);
    }
    const queue = [...result];
    while (queue.length > 0) {
      const node = queue.shift();
      for (const neighbor of adj[node] || []) {
        tempInDegree[neighbor]--;
        if (tempInDegree[neighbor] === 0) queue.push(neighbor);
      }
    }
    // Filter to only those actually processed (cycle-safe)
    return result.filter(id => tempInDegree[id] === undefined || tempInDegree[id] <= 0);
  };

  const processed = new Set(computeOrder());
  if (processed.size < agents.length) {
    const cycle = agents.filter(a => !processed.has(a.id)).map(a => a.id);
    return { hasCycle: true, cycle, waves: [] };
  }

  if (mode === "pipeline" || mode === "sequential") {
    // Build order using topological sort (not alphabetical)
    const tempInDegree = { ...inDegree };
    const result = [];
    const queue = [];
    for (const a of agents) {
      if (tempInDegree[a.id] === 0) queue.push(a.id);
    }
    while (queue.length > 0) {
      const node = queue.shift();
      result.push(agentMap[node]);
      for (const neighbor of adj[node] || []) {
        tempInDegree[neighbor]--;
        if (tempInDegree[neighbor] === 0) queue.push(neighbor);
      }
    }
    return { hasCycle: false, cycle: [], waves: [result] };
  }

  // Parallel mode: waves
  const waves = [];
  const remaining = new Set(agents.map(a => a.id));
  const tempInDegree = { ...inDegree };

  while (remaining.size > 0) {
    const wave = [];
    for (const id of remaining) {
      if (tempInDegree[id] === 0) {
        wave.push(agentMap[id]);
      }
    }
    if (wave.length === 0) break;
    waves.push(wave);
    for (const w of wave) {
      remaining.delete(w.id);
      for (const neighbor of adj[w.id] || []) {
        tempInDegree[neighbor]--;
      }
    }
  }

  return { hasCycle: false, cycle: [], waves };
}

// ── DAG Agent Execution ──────────────────────────────────────────────────────

async function runDagAgent(agent, context) {
  const { goal, model, auth, activeTools, previousWaveResults, pipelineIteration, pipelineCount } = context;
  const agentId = agent.id;

  bcast({ type: "ceo_thought", message: `Activating DAG agent '${agentId}' for task: ${agent.task}` });
  bcast({ type: "agent_status", agentId, status: "running" });

  // Rate limit: wait for token before starting
  await dagRateLimiter.consume(1);

  const previousContext = previousWaveResults && Object.keys(previousWaveResults).length > 0
    ? `\n\n## RESULTS FROM PREVIOUS AGENTS\n${Object.entries(previousWaveResults).map(([id, res]) => `Agent [${id}] completed:\n${res.result || res}`).join("\n\n")}`
    : "";

  let pipelineContext = "";
  if (pipelineIteration !== undefined && pipelineCount !== undefined && pipelineCount > 1) {
    pipelineContext = `\n\n## PIPELINE ITERATION\nThis is iteration ${pipelineIteration + 1} of ${pipelineCount}.`;
  }

  // Automated RAG context injection from memory
  let ragContext = "";
  try {
    const taskQuery = (agent.task || "").slice(0, 200);
    if (taskQuery.length > 10) {
      const memResults = memorySearch(taskQuery, 5);
      const highConfidence = memResults.filter(r => r.score > 0.3);
      if (highConfidence.length > 0) {
        ragContext = `\n\n## RELEVANT MEMORY CONTEXT\n${highConfidence.map(r => `[${r.entry.type || "note"}] ${r.entry.content.slice(0, 500)}`).join("\n\n")}`;
      }
    }
  } catch {}

  // Wave-based summary logs for downstream waves
  let waveSummaryContext = "";
  if (previousWaveResults && typeof previousWaveResults === "object") {
    const summaries = Object.values(previousWaveResults).filter(Boolean);
    if (summaries.length > 0) {
      waveSummaryContext = `\n\n## CROSS-AGENT WAVE SUMMARY\n${summaries.map(s => typeof s === "string" ? s : (s.summary || s.result || "")).filter(Boolean).join("\n\n")}`;
    }
  }

  const agentPrompt = `You are the ${agentId} agent, a specialized swarm member.
Your role: ${agent.role}
Your task: ${agent.task}

Perform your task using your tools, think step-by-step, and report back with a clear final summary of your result.${previousContext}${ragContext}${waveSummaryContext}${pipelineContext}`;

  const messages = [
    { role: "user", content: [{ type: "text", text: agent.task }], timestamp: Date.now() }
  ];

  const agentTools = (agent.tools || []).map(tName => activeTools.find(td => td.name === tName)).filter(Boolean);

  let lastTextResult = "";
  const MAX_TURNS = 15;
  let turn = 0;
  let status = "completed";
  let errorLog = null;
  let hadChat = false;

  while (turn < MAX_TURNS) {
    try {
      const pendingChats = flushAgentChatBuffer(agentId);
      if (pendingChats.length > 0) {
        hadChat = true;
        const chatSummary = pendingChats.map(c => `[User message]: ${c.content}`).join("\n");
        messages.push({
          role: "user",
          content: [{ type: "text", text: `--- User messages during execution ---\n${chatSummary}\n--- Please incorporate this feedback ---` }],
          timestamp: Date.now(),
        });
        bcast({ type: "agent_log", agentId, message: `📩 ${pendingChats.length} user message(s) injected into context.` });
      }

      const stream = streamSimple(model, {
        systemPrompt: agentPrompt,
        messages,
        tools: agentTools
      }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" });

      let currentText = "";
      for await (const event of stream) {
        if (event.type === "text_delta") {
          currentText += event.delta;
          if (event.delta.trim().length > 3) {
            bcast({ type: "agent_log", agentId, message: event.delta.trim().slice(0, 100) });
          }
        }
      }

      const result = await stream.result();
      messages.push(result);
      lastTextResult = currentText;

      const toolCalls = result.content.filter(c => c.type === "toolUse" || c.type === "toolCall");
      if (toolCalls.length === 0) {
        // If this turn was a response to user chat, broadcast it back
        if (hadChat && lastTextResult.trim()) {
          bcast({ type: "agent_chat", agentId, message: lastTextResult.trim(), fromAgent: true });
          hadChat = false;
        }
        break;
      }

      for (const tc of toolCalls) {
        const tName = tc.name || tc.toolName;
        const tInput = tc.input || tc.arguments || {};

        bcast({ type: "agent_status", agentId, status: "calling_tool", currentTool: tName });
        bcast({ type: "agent_log", agentId, message: `Calling tool: ${tName} with ${redactToolInput(tInput)}` });

        let toolOutput = "";
        try {
          if (tName === "custom_parser") {
            toolOutput = "Successfully executed CEO custom parser tool. Output: Parsing completed with 0 errors.";
          } else {
            toolOutput = await executeTool(tName, tInput, process.cwd());
          }
        } catch (e) {
          toolOutput = `Error: ${e.message}`;
        }

        bcast({ type: "agent_log", agentId, message: `Tool response: ${toolOutput.slice(0, 150)}...` });

        messages.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tName,
          content: [{ type: "text", text: toolOutput }],
          isError: toolOutput.startsWith("Error:"),
          timestamp: Date.now(),
        });
      }

      bcast({ type: "agent_status", agentId, status: "running" });
      turn++;

      if (_swarmPaused) {
        bcast({ type: "swarm_paused", agentId });
        await new Promise(resolve => { _swarmPauseResolve = resolve; });
        bcast({ type: "swarm_resumed", agentId });
      }
    } catch (err) {
      bcast({ type: "agent_log", agentId, message: `Error running turn: ${err.message}` });
      status = "error";
      errorLog = err.message;
      break;
    }
  }

  bcast({ type: "agent_done", agentId, result: lastTextResult || "Task execution finished.", status });
  return { agentId, result: lastTextResult || "Completed.", logs: [], status, error: errorLog };
}

// ── DAG Campaign Execution ───────────────────────────────────────────────────

async function executeDagCampaign(socket, goal, dagConfig) {
  let agents = dagConfig.agents || [];
  const mode = dagConfig.mode || "pipeline";
  const pipelineCount = mode === "pipeline" ? (dagConfig.pipeline_count || 3) : 1;

  // Validate
  const validation = validateDag(agents);
  if (!validation.valid) {
    for (const err of validation.errors) {
      bcast({ type: "ceo_thought", message: `DAG validation error: ${err}` });
    }
    bcast({ type: "swarm_error", message: `DAG validation failed: ${validation.errors.join("; ")}` });
    return;
  }

  // Cycle detection (uses topologicalSort's ability to detect cycles)
  const model = resolveModel();
  const auth = getModelAuth(model);
  const activeTools = getActiveTools();

  // Persistent state
  if (currentSwarmState) {
    currentSwarmState.dagMode = mode;
    currentSwarmState.dagConfig = dagConfig;
    currentSwarmState.pipelineIteration = 0;
    currentSwarmState.currentWave = 0;
    currentSwarmState.waveResults = {};
  }

  const allWaveResults = {};

  for (let iter = 0; iter < pipelineCount; iter++) {
    if (currentSwarmState) {
      currentSwarmState.pipelineIteration = iter;
    }

    if (pipelineCount > 1) {
      bcast({ type: "ceo_thought", message: `Pipeline iteration ${iter + 1}/${pipelineCount}` });
    }

    // Compute topological waves
    const sortResult = topologicalSort(agents, mode);
    if (sortResult.hasCycle) {
      bcast({ type: "ceo_thought", message: `DAG cycle detected in agents: ${sortResult.cycle.join(", ")}` });
      bcast({ type: "swarm_error", message: `DAG contains cycle among agents: ${sortResult.cycle.join(", ")}` });
      return;
    }
    const waves = sortResult.waves || sortResult;
    const iterationResults = {};

    for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
      const wave = waves[waveIdx];
      if (currentSwarmState) {
        currentSwarmState.currentWave = waveIdx;
      }

      bcast({ type: "ceo_thought", message: `Executing wave ${waveIdx + 1}/${waves.length} with ${wave.length} agent(s)` });

      // Build context for this wave
      const context = {
        goal,
        model,
        auth,
        activeTools,
        previousWaveResults: { ...allWaveResults, ...iterationResults },
        pipelineIteration: iter,
        pipelineCount,
      };

      // Broadcast wave-level summary log
      bcast({ type: "ceo_thought", message: `Wave ${waveIdx + 1} summary: Agents [${wave.map(a => a.id).join(", ")}] — compiling results...` });

      // Execute wave agents concurrently (rate limited inside runDagAgent)
      const wavePromises = wave.map(agent => runDagAgent(agent, context));
      const waveResults = await Promise.allSettled(wavePromises);

      for (let i = 0; i < wave.length; i++) {
        const agent = wave[i];
        const settled = waveResults[i];

        if (settled.status === "fulfilled") {
          iterationResults[agent.id] = settled.value;
          allWaveResults[agent.id] = settled.value;
          if (currentSwarmState) {
            if (!currentSwarmState.waveResults) currentSwarmState.waveResults = {};
            if (!currentSwarmState.waveResults[waveIdx]) currentSwarmState.waveResults[waveIdx] = {};
            currentSwarmState.waveResults[waveIdx][agent.id] = settled.value;
          }
        } else {
          const errMsg = settled.reason?.message || "Unknown error";
          bcast({ type: "agent_log", agentId: agent.id, message: `Agent '${agent.id}' failed: ${errMsg}` });
          const failedResult = { agentId: agent.id, result: "", logs: [], status: "error", error: errMsg };
          iterationResults[agent.id] = failedResult;
          allWaveResults[agent.id] = failedResult;
        }

        if (currentSwarmState) {
          const idx = currentSwarmState.agents.findIndex(a => a.id === agent.id);
          if (idx >= 0) {
            currentSwarmState.agents[idx].status = settled.status === "fulfilled" ? "completed" : "error";
          }
        }
      }

      saveSwarmState(currentSwarmState);
    }

    // CEO refinement between pipeline iterations
    if (pipelineCount > 1 && iter < pipelineCount - 1) {
      bcast({ type: "ceo_thought", message: `CEO refining direction for iteration ${iter + 2}...` });
      try {
        const summaryPrompt = `You are the CEO of a multi-agent swarm team.
Your sub-agents completed iteration ${iter + 1} of ${pipelineCount} for the goal: "${goal}"

Results from this iteration:
${Object.entries(iterationResults).map(([id, res]) => `Agent [${id}]: ${res.result?.slice(0, 300) || "No result"}`).join("\n")}

Write a brief refinement direction for the next iteration. Focus on what to improve or adjust.`;

        const stream = streamSimple(model, {
          systemPrompt: "You are the CEO giving concise refinement direction for the next pipeline iteration.",
          messages: [{ role: "user", content: [{ type: "text", text: summaryPrompt }] }],
        }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" });

        let refinement = "";
        for await (const event of stream) {
          if (event.type === "text_delta") refinement += event.delta;
        }
        bcast({ type: "ceo_thought", message: `Refinement for next iteration: ${refinement.slice(0, 500)}` });
      } catch (err) {
        bcast({ type: "ceo_thought", message: `Skipping CEO refinement (error: ${err.message})` });
      }
    }
  }

  // Final CEO Summary
  bcast({ type: "ceo_thought", message: "All DAG agents completed. Compiling final summary..." });

  let summary = "";
  try {
    const summaryPrompt = `You are the CEO of a multi-agent swarm team.
Your agents have completed their DAG execution for the goal: "${goal}"

Agent results:
${Object.entries(allWaveResults).map(([id, res]) => `Agent [${id}] (${res.status || "completed"}):\n${(res.result || "").slice(0, 300)}`).join("\n\n")}

Write a brief summary for the user.`;

    const stream = streamSimple(model, {
      systemPrompt: "You compile summary reports. Write formatted text.",
      messages: [{ role: "user", content: [{ type: "text", text: summaryPrompt }] }],
    }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" });

    for await (const event of stream) {
      if (event.type === "text_delta") summary += event.delta;
    }
  } catch (err) {
    summary = `DAG swarm completed!\n\n${Object.entries(allWaveResults).map(([id, res]) => `- Agent ${id.toUpperCase()}: ${(res.result || "").slice(0, 200)}...`).join("\n")}`;
  }

  bcast({ type: "ceo_summary", summary });
  try { createCheckpoint(`Swarm: ${goal.slice(0, 60)}`); } catch {}

  if (currentSwarmState) {
    currentSwarmState.status = "completed";
    currentSwarmState.summary = summary;
    saveSwarmState(currentSwarmState);
  }
}

async function handleDagGoal(socket, goal, dagConfig) {
  swarmSockets.add(socket);
  currentSwarmState = {
    goal,
    status: "running",
    dagMode: dagConfig.mode || "pipeline",
    pipelineIteration: 0,
    currentWave: 0,
    dagConfig,
    agents: dagConfig.agents.map(a => ({ ...a, status: "pending", logs: [] })),
    agentResults: {},
    waveResults: {},
    ceoLogs: [{ message: `DAG Swarm initialized. Mode: ${dagConfig.mode || "pipeline"}. Goal: "${goal}"` }],
    summary: null
  };
  bcast({ type: "swarm_start", goal, mode: dagConfig.mode || "pipeline" });
  await executeDagCampaign(socket, goal, dagConfig);
}

async function executeSwarmCampaign(socket, goal, agents) {
  // Add this socket to the broadcast set so it receives live updates
  swarmSockets.add(socket);

  const model = resolveModel();
  const auth = getModelAuth(model);

  // Send plan to client
  bcast({ type: "ceo_plan", agents });

  // Save agents to persistent state
  if (currentSwarmState) {
    currentSwarmState.agents = agents.map(a => ({ ...a, status: "pending", logs: [] }));
  }

  const agentResults = {};
  const activeTools = getActiveTools();

  // 2. Sequential Agent Execution Loop
  for (const agent of agents) {
    // Check pause before starting each agent
    if (_swarmPaused) {
      bcast({ type: "swarm_paused", agentId: agent.id });
      await new Promise(resolve => { _swarmPauseResolve = resolve; });
      bcast({ type: "swarm_resumed", agentId: agent.id });
    }

    const prevResults = Object.entries(agentResults)
      .map(([id, res]) => `--- OUTPUT FROM PREVIOUS AGENT [${id}] ---\n${res || "(no output)"}\n--- END OF OUTPUT ---`)
      .join("\n\n");

    bcast({ type: "ceo_thought", message: `Activating sub-agent '${agent.id}' for task: ${agent.task}` });
    bcast({ type: "agent_status", agentId: agent.id, status: "running" });

    const agentPrompt = `You are the ${agent.id} agent, a specialized swarm member.
Your role: ${agent.role}
Your task: ${agent.task}

Perform your task using your tools, think step-by-step, and report back with a clear final summary of your result.${prevResults ? `\n\n## Previous Agent Outputs\n${prevResults}` : ""}`;

    const messages = [
      { role: "user", content: [{ type: "text", text: `${agent.task}${prevResults ? `\n\nUse the previous agent output above as input for your task.` : ""}` }], timestamp: Date.now() }
    ];

    // Build agent's toolbelt
    const agentTools = (agent.tools || []).map(tName => activeTools.find(td => td.name === tName)).filter(Boolean);

    // Mock Tool Provisioning trigger for Coder agents to demonstrate the flow
    if (agent.id === "coder" && !agent.tools.includes("custom_parser")) {
      // Pause Coder
      bcast({ type: "agent_status", agentId: agent.id, status: "paused", currentTask: "Requesting custom tool: custom_parser" });
      bcast({ type: "tool_request", agentId: agent.id, toolName: "custom_parser", reason: "Specialized string parsing tool for files" });
      
      // Simulate CEO tool creation
      await new Promise(r => setTimeout(r, 2500));
      
      // CEO writes the actual tool script into workspace!
      const scriptPath = path.join(process.cwd(), "custom_parser.js");
      try {
        fs.writeFileSync(scriptPath, `// CEO created custom tool parser
console.log("Parsing logs successfully.");
`, "utf8");
      } catch {}

      bcast({ type: "tool_provisioned", agentId: agent.id, toolName: "custom_parser" });
      
      // Add custom parser tool schema to Coder's toolbelt
      agentTools.push({
        name: "custom_parser",
        description: "Run the custom parser script created by CEO to validate outputs",
        parameters: { type: "object", properties: {} }
      });

      // Resume Coder
      bcast({ type: "agent_status", agentId: agent.id, status: "running", currentTask: agent.task });
      await new Promise(r => setTimeout(r, 500));
    }

    let lastTextResult = "";
    const MAX_TURNS = 15;
    let turn = 0;
    let _hadChat = false;
    while (turn < MAX_TURNS) {
      try {
        // Inject pending user chat messages into agent context
        const pendingChats = flushAgentChatBuffer(agent.id);
        if (pendingChats.length > 0) {
          _hadChat = true;
          const chatSummary = pendingChats.map(c => `[User message]: ${c.content}`).join("\n");
          messages.push({
            role: "user",
            content: [{ type: "text", text: `--- User messages during execution ---\n${chatSummary}\n--- Please incorporate this feedback ---` }],
            timestamp: Date.now(),
          });
          bcast({ type: "agent_log", agentId: agent.id, message: `📩 ${pendingChats.length} user message(s) injected into context.` });
        }

        const stream = streamSimple(model, {
          systemPrompt: agentPrompt,
          messages,
          tools: agentTools
        }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" });

        let currentText = "";
        for await (const event of stream) {
          if (event.type === "text_delta") {
            currentText += event.delta;
            // Send chunk as logs to keep terminal active
            if (event.delta.trim().length > 3) {
              bcast({ type: "agent_log", agentId: agent.id, message: event.delta.trim().slice(0, 100) });
            }
          }
        }

        const result = await stream.result();
        messages.push(result);
        lastTextResult = currentText;

        const toolCalls = result.content.filter(c => c.type === "toolUse" || c.type === "toolCall");
        if (toolCalls.length === 0) {
          if (_hadChat && lastTextResult.trim()) {
            bcast({ type: "agent_chat", agentId: agent.id, message: lastTextResult.trim(), fromAgent: true });
            _hadChat = false;
          }
          break; // Done with execution
        }

        // Execute tool calls
        for (const tc of toolCalls) {
          const tName = tc.name || tc.toolName;
          const tInput = tc.input || tc.arguments || {};
          
          bcast({ type: "agent_status", agentId: agent.id, status: "calling_tool", currentTool: tName });
          bcast({ type: "agent_log", agentId: agent.id, message: `Calling tool: ${tName} with ${redactToolInput(tInput)}` });

          let toolOutput = "";
          try {
            if (tName === "custom_parser") {
              toolOutput = "Successfully executed CEO custom parser tool. Output: Parsing completed with 0 errors.";
            } else {
              toolOutput = await executeTool(tName, tInput, process.cwd());
            }
          } catch (e) {
            toolOutput = `Error: ${e.message}`;
          }

          bcast({ type: "agent_log", agentId: agent.id, message: `Tool response: ${toolOutput.slice(0, 150)}...` });
          
          messages.push({
            role: "toolResult",
            toolCallId: tc.id,
            toolName: tName,
            content: [{ type: "text", text: toolOutput }],
            isError: toolOutput.startsWith("Error:"),
            timestamp: Date.now(),
          });
        }

        bcast({ type: "agent_status", agentId: agent.id, status: "running" });
        turn++;

        // Check pause between turns
        if (_swarmPaused) {
          bcast({ type: "swarm_paused", agentId: agent.id });
          await new Promise(resolve => { _swarmPauseResolve = resolve; });
          bcast({ type: "swarm_resumed", agentId: agent.id });
        }
      } catch (err) {
        bcast({ type: "agent_log", agentId: agent.id, message: `Error running turn: ${err.message}` });
        break;
      }
    }

    bcast({ type: "agent_done", agentId: agent.id, result: lastTextResult || "Task execution finished." });
    agentResults[agent.id] = lastTextResult || "Completed.";

    // Save persistent state
    if (currentSwarmState) {
      currentSwarmState.agentResults = { ...agentResults };
      const idx = currentSwarmState.agents.findIndex(a => a.id === agent.id);
      if (idx >= 0) currentSwarmState.agents[idx].status = "completed";
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // 3. CEO Summary Generation
  bcast({ type: "ceo_thought", message: "All sub-agents completed work. Compiling final summary report..." });
  
  let summary = "";
  try {
    const summaryPrompt = `You are the CEO of a multi-agent swarm team.
Your sub-agents have completed the following tasks for the goal: "${goal}":

${Object.entries(agentResults).map(([id, res]) => `Agent [${id}] result:\n${res}`).join("\n\n")}

Please write a brief summary report for the USER detailing what the sub-agents have accomplished and the final outcome.`;

    const stream = streamSimple(model, {
      systemPrompt: "You compile summary reports. Write formatted text.",
      messages: [{ role: "user", content: [{ type: "text", text: summaryPrompt }] }],
    }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" });

    for await (const event of stream) {
      if (event.type === "text_delta") summary += event.delta;
    }
  } catch (err) {
    summary = `Swarm goal accomplished!\n\n${Object.entries(agentResults).map(([id, res]) => `- Agent ${id.toUpperCase()}: ${res.slice(0, 200)}...`).join("\n")}`;
  }

  bcast({ type: "ceo_summary", summary });
  try { createCheckpoint(`Swarm: ${goal.slice(0, 60)}`); } catch {}

  // Mark swarm as completed
  if (currentSwarmState) {
    currentSwarmState.status = "completed";
    currentSwarmState.summary = summary;
  }
}

async function handleSwarmGoal(socket, goal) {
  swarmSockets.add(socket);

  // Initialize persistent state
  currentSwarmState = {
    goal,
    status: "running",
    agents: [],
    agentResults: {},
    ceoLogs: [{ message: `CEO Agent initialized. Analyzing goal: "${goal}"` }],
    summary: null
  };

  bcast({ type: "swarm_start", goal });
  bcast({ type: "ceo_thought", message: `CEO Agent initialized. Analyzing goal: "${goal}"` });

  const model = resolveModel();
  const auth = getModelAuth(model);

  // 1. CEO Plan Formulation
  let plan = { agents: [] };
  try {
    const planPrompt = `You are the CEO of a multi-agent swarm development team.
Your task is to break down the user's high-level goal: "${goal}" into a team of 2 to 3 specialized sub-agents.
Allowed tools for sub-agents are: list_dir, view_file, write, edit, bash, glob, grep, memory_search, web_search, web_fetch, post_to_twitter, post_to_reddit, post_to_bluesky, post_to_discord, post_to_telegram, send_email, ask_user.

If the goal involves posting to social media, assign the relevant posting tools (post_to_twitter, post_to_reddit, post_to_bluesky, post_to_discord, post_to_telegram) to the publishing agent. Use ask_user when the agent needs user approval before posting.

Return your plan strictly as a JSON object with this shape:
{
  "agents": [
    {
      "id": "researcher", // alphanumeric, lowercase
      "role": "Description of the agent's specialization",
      "tools": ["web_search", "web_fetch"],
      "task": "Specific task for this agent"
    }
  ]
}`;

    const stream = streamSimple(model, {
      systemPrompt: "You formulate multi-agent plans. Output JSON only.",
      messages: [{ role: "user", content: [{ type: "text", text: planPrompt }] }],
    }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" });

    let rawResponse = "";
    for await (const event of stream) {
      if (event.type === "text_delta") rawResponse += event.delta;
    }
    const result = await stream.result();
    
    // Parse JSON from response
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      plan = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.error("[Swarm CEO] Planning failed, falling back to default plan:", err);
  }

  // Fallback if planning fails
  if (!plan.agents || plan.agents.length === 0) {
    plan.agents = [
      {
        id: "researcher",
        role: "Gathers requirements and analyzes files",
        tools: ["list_dir", "glob", "grep", "web_search"],
        task: `Research specifications and requirements to achieve: ${goal}`
      },
      {
        id: "coder",
        role: "Implements scripts and code updates",
        tools: ["view_file", "write", "edit", "bash"],
        task: `Write code and scripts to implement: ${goal}`
      }
    ];
  }

  await executeSwarmCampaign(socket, goal, plan.agents);
}

// ── Server ─────────────────────────────────────────────────────────────────

function validateEnv() {
  const warnings = [];
  if (process.env.WEB_PORT && isNaN(Number(process.env.WEB_PORT))) warnings.push("WEB_PORT must be a number");
  if (process.env.PI_API_KEY && process.env.PI_API_KEY.length < 8) warnings.push("PI_API_KEY should be at least 8 characters");
  if (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN === "*") warnings.push("CORS_ORIGIN set to wildcard — this is insecure");
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) warnings.push("Node.js >=18 required, found " + process.version);
  if (warnings.length > 0) {
    console.warn("[Startup] Configuration warnings:");
    for (const w of warnings) console.warn("  ⚠ " + w);
  }
}

export async function createApp() {
  const app = Fastify({ logger: { level: "warn" } });

  // API version prefix rewrite — /api/v1/* → /api/* for backward compatibility
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/v1/")) {
      req.url = req.url.replace("/api/v1", "/api");
    }
  });

  // Raw binary parser for WAV audio uploads (STT)
  app.addContentTypeParser("audio/wav", function (_req, payload, done) {
    const chunks = [];
    payload.on("data", (chunk) => chunks.push(chunk));
    payload.on("end", () => done(null, Buffer.concat(chunks)));
  });

  // Security headers applied to all HTTP responses
  const SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  };
  app.addHook("onRequest", async (_req, reply) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(key, value);
    }
  });

  // Centralized error handler — logs full error server-side, returns sanitized message
  app.setErrorHandler((error, _req, reply) => {
    console.error("[Server Error]", error.stack || error.message);
    sendError(reply, error.statusCode || 500,
      process.env.NODE_ENV === "production" ? "Internal server error" : error.message,
      "INTERNAL_ERROR");
  });

  // Rate limiting for sensitive endpoints
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/vault/") && req.method === "POST") {
      if (!(await vaultRateLimiter.consume())) {
        return sendError(reply, 429, "Too many requests — vault rate limit exceeded", "RATE_LIMIT");
      }
    }
    if (req.url.startsWith("/api/settings") && req.method === "POST") {
      if (!(await settingsRateLimiter.consume())) {
        return sendError(reply, 429, "Too many requests — settings rate limit exceeded", "RATE_LIMIT");
      }
    }
    if (req.url.startsWith("/api/social/") && req.method === "POST") {
      if (!(await socialRateLimiter.consume())) {
        return sendError(reply, 429, "Too many requests — social rate limit exceeded", "RATE_LIMIT");
      }
    }
    // Generic mutation rate limiter for: notes, tasks, reminders, contacts, calendar, sessions, teams, agents, gallery, voice, auth, ssh, companion, webhooks
    const MUTATION_PREFIXES = ["/api/notes", "/api/tasks", "/api/reminders", "/api/contacts", "/api/calendar", "/api/sessions", "/api/swarm", "/api/teams", "/api/agents", "/api/gallery", "/api/voice/", "/api/auth/", "/api/ssh/", "/api/companion/", "/api/webhooks/"];
    if (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") {
      if (MUTATION_PREFIXES.some(p => req.url.startsWith(p))) {
        if (!(await mutationRateLimiter.consume())) {
          return sendError(reply, 429, "Too many requests — rate limit exceeded", "RATE_LIMIT");
        }
      }
    }
    // Chat completions rate limiter
    if (req.url.startsWith("/api/chat/completions") && req.method === "POST") {
      if (!(await chatRateLimiter.consume())) {
        return sendError(reply, 429, "Too many requests — chat rate limit exceeded", "RATE_LIMIT");
      }
    }
  });

  // Auth middleware — optional bearer token via PI_API_KEY env var
  const apiKey = process.env.PI_API_KEY || process.env.API_KEY || "";
  app.addHook("onRequest", (req, reply, done) => {
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS" || req.url === "/api/health") return done();
    if (apiKey) {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith("Bearer ")) {
        return sendError(reply, 401, "Unauthorized — provide Bearer token via Authorization header or set PI_API_KEY", "UNAUTHORIZED");
      }
      const token = auth.slice(7);
      if (token.length !== apiKey.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(apiKey))) {
        return sendError(reply, 401, "Unauthorized — invalid token", "UNAUTHORIZED");
      }
    }
    done();
  });
  app.options("/*", async (req, reply) => reply.code(204).send());

  // Generic body validation helper
  function validateBody(body, requiredFields) {
    if (!body || typeof body !== 'object') return 'Request body is required';
    for (const field of requiredFields) {
      if (body[field] === undefined || body[field] === null) {
        return `Missing required field: ${field}`;
      }
      if (typeof body[field] === 'string' && body[field].trim().length === 0) {
        return `Field '${field}' cannot be empty`;
      }
    }
    return null;
  }

  await app.register(fastifyWebsocket);
  await app.register(compress, { global: true, threshold: 1024 });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Custom-PI API",
        description: "Autonomous AI coding agent — full-stack API",
        version: "1.11.0",
      },
      servers: [{ url: `http://127.0.0.1:${PORT}` }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", defaultModelsExpandDepth: 1 },
  });

  // Security headers applied to all HTTP responses
  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-XSS-Protection", "1; mode=block");
    const cspDirectives = [
      `default-src 'self'`,
      `script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net`,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net`,
      `img-src 'self' data: blob: https:`,
      `font-src 'self' https://fonts.gstatic.com`,
      `connect-src 'self' ws: wss: https:`,
      `frame-ancestors 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
    ];
    reply.header("Content-Security-Policy", cspDirectives.join("; "));
  });

  // CORS — restrict to configured origin, never wildcard
  const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:4322";
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin) {
      if (origin === CORS_ORIGIN) {
        reply.header("Access-Control-Allow-Origin", origin);
        reply.header("Access-Control-Allow-Credentials", "true");
      }
      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    }
    if (req.method === "OPTIONS") return reply.status(204).send();
  });

  // Optional API key authentication
  const AUTH_KEY = process.env.WEB_API_KEY || process.env.CUSTOM_PI_WEB_KEY;
  app.addHook("onRequest", async (req, reply) => {
    if (AUTH_KEY) {
      const key = req.headers["x-api-key"];
      if (!key || key.length !== AUTH_KEY.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(AUTH_KEY))) {
        return sendError(reply, 401, "Unauthorized", "UNAUTHORIZED");
      }
    }
  });

  // Per-request context for API handlers
  app.addHook("onRequest", async (req, reply) => {
    const contextStore = {
      requestId: crypto.randomUUID().slice(0, 8),
      ip: req.ip,
      startTime: Date.now(),
    };
    req.contextStore = contextStore;
    // Wrap the handler in AsyncLocalStorage context for downstream use
    return withRequestContext(contextStore, () => {});
  });

  // ── Notes & Tasks API ────────────────────────────────────────────────────

  const NOTES_DB_PATH = path.join(PI_DIR, "notes.db");

  function getNotesDb() {
    try {
      const db = getOrCreateDb(NOTES_DB_PATH);
      if (!db) return null;
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT DEFAULT '',
          color TEXT DEFAULT '', pinned INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
          tags TEXT DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER DEFAULT 0,
          status TEXT DEFAULT 'todo', priority TEXT DEFAULT 'medium',
          due_date INTEGER, note_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
      `);
      return db;
    } catch { return null; }
  }

  app.get("/api/notes", async () => {
    const db = getNotesDb();
    if (!db) return { notes: [] };
    const rows = db.prepare("SELECT * FROM notes WHERE archived = 0 ORDER BY pinned DESC, updated_at DESC LIMIT 100").all();
    return { notes: rows.map(r => ({ ...r, tags: JSON.parse(r.tags || "[]") })) };
  });

  app.post("/api/notes", {
    schema: {
      body: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, color: { type: "string" }, tags: { type: "array", items: { type: "string" } } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, id: { type: "string" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    const { title, content, color, tags } = req.body || {};
    const id = `note_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const now = Date.now();
    db.prepare("INSERT INTO notes (id, title, content, color, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, title || "", content || "", color || "", JSON.stringify(tags || []), now, now);
    return { success: true, id };
  });

  app.put("/api/notes/:id", async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    const { id } = req.params;
    const updates = req.body || {};
    const fields = []; const vals = [];
    for (const k of ["title", "content", "color", "pinned", "archived"]) {
      if (updates[k] !== undefined) { fields.push(`${k} = ?`); vals.push(updates[k]); }
    }
    if (updates.tags) { fields.push("tags = ?"); vals.push(JSON.stringify(updates.tags)); }
    if (!fields.length) return { error: "No fields" };
    fields.push("updated_at = ?"); vals.push(Date.now()); vals.push(id);
    db.prepare(`UPDATE notes SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
    return { success: true };
  });

  app.delete("/api/notes/:id", async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    db.prepare("DELETE FROM notes WHERE id = ?").run(req.params.id);
    return { success: true };
  });

  app.get("/api/tasks", async () => {
    const db = getNotesDb();
    if (!db) return { tasks: [] };
    const rows = db.prepare("SELECT * FROM tasks ORDER BY done ASC, due_date ASC, created_at DESC LIMIT 100").all();
    return { tasks: rows };
  });

  app.post("/api/tasks", {
    schema: {
      body: { type: "object", properties: { title: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] }, dueDate: { type: "number" }, noteId: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, id: { type: "string" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    const { title, priority, dueDate, noteId } = req.body || {};
    const id = `task_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const now = Date.now();
    db.prepare("INSERT INTO tasks (id, title, priority, due_date, note_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, title || "", priority || "medium", dueDate || null, noteId || "", now, now);
    return { success: true, id };
  });

  app.put("/api/tasks/:id", async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    const updates = req.body || {};
    const fields = []; const vals = [];
    for (const k of ["title", "done", "status", "priority", "due_date"]) {
      if (updates[k] !== undefined) { fields.push(`${k} = ?`); vals.push(updates[k]); }
    }
    if (!fields.length) return { error: "No fields" };
    fields.push("updated_at = ?"); vals.push(Date.now()); vals.push(req.params.id);
    db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
    return { success: true };
  });

  app.delete("/api/tasks/:id", async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
    return { success: true };
  });

  // ── Reminders & Scheduled Actions ────────────────────────────────────
  const REMINDERS_FILE = path.join(PI_DIR, "reminders.json");
  function loadReminders() {
    try { return JSON.parse(fs.readFileSync(REMINDERS_FILE, "utf8")); } catch { return []; }
  }
  function saveReminders(reminders) { fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2)); }
  app.get("/api/reminders", async () => ({ reminders: loadReminders() }));
  app.post("/api/reminders", async (req) => {
    const { title, dueAt, noteId, recurring } = req.body || {};
    if (!title) return { error: "title required" };
    const reminders = loadReminders();
    const r = { id: `rem_${Date.now()}`, title, dueAt: dueAt || Date.now() + 86400000, noteId: noteId || null, recurring: recurring || null, done: false, createdAt: Date.now() };
    reminders.push(r);
    saveReminders(reminders);
    return { success: true, reminder: r };
  });
  app.post("/api/reminders/:id/done", async (req) => {
    const reminders = loadReminders().map(r => r.id === req.params.id ? { ...r, done: true } : r);
    saveReminders(reminders);
    return { success: true };
  });
  app.delete("/api/reminders/:id", async (req) => {
    saveReminders(loadReminders().filter(r => r.id !== req.params.id));
    return { success: true };
  });
  // Scheduled actions (cron-style agent tasks)
  const SCHEDULED_FILE = path.join(PI_DIR, "scheduled-actions.json");
  function loadScheduled() {
    try { return JSON.parse(fs.readFileSync(SCHEDULED_FILE, "utf8")); } catch { return []; }
  }
  function saveScheduled(actions) { fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(actions, null, 2)); }
  // Background scheduler — checks every 60s
  if (!global._schedulerStarted) {
    global._schedulerStarted = true;
    setInterval(() => {
      const reminders = loadReminders();
      const now = Date.now();
      for (const r of reminders) {
        if (!r.done && r.dueAt <= now) {
          try { broadcast({ type: "reminder_due", reminder: r }); } catch {}
        }
      }
      const scheduled = loadScheduled();
      for (const s of scheduled) {
        if (!s.lastRun || Date.now() - s.lastRun > s.intervalMs) {
          try { broadcast({ type: "scheduled_action_due", action: s }); } catch {}
          s.lastRun = Date.now();
          saveScheduled(scheduled);
        }
      }
    }, 60000);
  }
  app.get("/api/scheduled-actions", async () => ({ actions: loadScheduled() }));
  app.post("/api/scheduled-actions", async (req) => {
    const { name, description, intervalMs, agentTask } = req.body || {};
    if (!name || !intervalMs) return { error: "name and intervalMs required" };
    const actions = loadScheduled();
    actions.push({ id: `sch_${Date.now()}`, name, description: description || "", intervalMs, agentTask: agentTask || "", lastRun: null, createdAt: Date.now() });
    saveScheduled(actions);
    return { success: true };
  });
  app.delete("/api/scheduled-actions/:id", async (req) => {
    saveScheduled(loadScheduled().filter(a => a.id !== req.params.id));
    return { success: true };
  });

  // Serve static client — exact matches only (wildcard: false prevents
  // fastify-static from intercepting API routes before they can be handled)
  if (fs.existsSync(CLIENT_DIR)) {
    await app.register(fastifyStatic, {
      root: CLIENT_DIR,
      prefix: "/",
      wildcard: false,
    });
  }

  // SPA fallback — serves index.html for non-API routes, and handles
  // subdirectory assets (e.g., assets/index-xxx.js) that wildcard: false misses
  app.setNotFoundHandler((req, reply) => {
    // Return proper 404 for API and WS requests (not callNotFound — that
    // triggers another 404 handler and causes "Trying to send a NotFound
    // error inside a 404 handler")
    if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
      return sendError(reply, 404, `Not found: ${req.url}`, "NOT_FOUND");
    }

    // Try to serve the file from dist/ (handles assets/*.js, *.css, etc.)
    const filePath = path.join(CLIENT_DIR, req.url.replace(/^\//, ""));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return reply.sendFile(req.url.replace(/^\//, ""));
    }

    // SPA fallback — serve index.html
    const indexPath = path.join(CLIENT_DIR, "index.html");
    if (fs.existsSync(indexPath)) {
      reply.type("text/html").send(fs.readFileSync(indexPath, "utf8"));
    } else {
      sendError(reply, 404, "Not found", "NOT_FOUND");
    }
  });

  // ── Structured Logging ──────────────────────────────────────────────
  const logStream = fs.createWriteStream(path.join(PI_DIR, "access.log"), { flags: "a" });
  function logRequest(req, durationMs) {
    const entry = {
      ts: new Date().toISOString(), method: req.method, url: req.url,
      status: req.statusCode || 200, durationMs, ip: req.ip,
    };
    logStream.write(JSON.stringify(entry) + "\n");
  }
  app.addHook("onResponse", (req, reply, done) => {
    const duration = reply.elapsedTime || 0;
    logRequest(req, duration);
    done();
  });
  app.get("/api/admin/logs", async (req) => {
    if (!requireAdmin(req)) return { error: "Admin required" };
    try {
      const lines = fs.readFileSync(path.join(PI_DIR, "access.log"), "utf8").trim().split("\n").slice(-200);
      return { logs: lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) };
    } catch { return { logs: [] }; }
  });
  app.get("/api/admin/performance", async () => {
    try {
      const lines = fs.readFileSync(path.join(PI_DIR, "access.log"), "utf8").trim().split("\n").filter(Boolean);
      const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-500);
      const avgDuration = entries.length ? entries.reduce((s, e) => s + e.durationMs, 0) / entries.length : 0;
      const slowest = entries.sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);
      return { totalRequests: entries.length, avgDurationMs: Math.round(avgDuration), slowest };
    } catch { return { totalRequests: 0, avgDurationMs: 0, slowest: [] }; }
  });

  // ── API Routes ─────────────────────────────────────────────────────────

  app.get("/api/health", async () => ({
    status: "ok", version: "1.0.0", timestamp: new Date().toISOString(),
  }));

  // ── Voice Agent API ────────────────────────────────────────────────
  const TTS_SERVER = process.env.TTS_SERVER || "http://127.0.0.1:8000";

  // Voice agent conversation history (same full agent pipeline as web chat)
  const voiceMessages = [];
  const MAX_VOICE_HISTORY = 50;

  app.post("/api/voice/chat", async (req, reply) => {
    const { text, voice } = req.body || {};
    if (!text) return reply.code(400).send({ error: "text is required" });
    const voiceId = voice || "af_bella";
    console.log(`[voice] Agent request: "${text.substring(0, 80)}"`);

    const model = resolveModel();
    let systemPrompt = loadSystemPrompt();
    systemPrompt += `\n\nCRITICAL INSTRUCTION FOR VOICE MODE: You are currently operating in VOICE INTERFACE mode. The user is speaking to you, and your responses are being read aloud by a Text-To-Speech engine. Therefore, you MUST follow these strict rules:
1. NO MARKDOWN: Do not use bold (**), italics (*), code blocks (\`\`\`), or list formatting (-). Speak in plain text.
2. NO EMOJIS OR SYMBOLS: Emojis and special symbols cannot be pronounced properly.
3. NO NARRATIVE ACTIONS: Do not include parenthetical actions or tones like "(Narrative Tone: Confident)" or "(smiles)".
4. CONCISE & CONVERSATIONAL: Keep your responses highly conversational, natural, and relatively short. Do NOT generate long, multi-paragraph essays or huge code blocks. Provide brief summaries and offer to elaborate if needed.`;
    const tools = getActiveTools();
    const auth = getModelAuth(model);
    const settings = loadSettings();

    voiceMessages.push({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
    while (voiceMessages.length > MAX_VOICE_HISTORY) voiceMessages.shift();

    let toolCallIndex = 0;
    let accumulatedText = "";
    const MAX_TURNS = 10;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      let stream, currentText = "";

      try {
        stream = streamSimple(model, {
          systemPrompt,
          messages: voiceMessages,
          tools,
        }, {
          apiKey: auth.apiKey,
          headers: auth.headers,
          reasoning: "off",
          maxTokens: model.maxTokens || 8192,
          signal: AbortSignal.timeout(120000),
        });
      } catch (e) {
        voiceMessages.pop();
        console.error(`[voice] streamSimple error: ${e.message}`);
        return { reply: text, error: `Model error: ${e.message}. Check that your local AI server (LM Studio/Ollama) is running.` };
      }

      try {
        for await (const event of stream) {
          if (event.type === "text_delta") currentText += event.delta;
        }
      } catch (e) {
        if (e.name === "AbortError") {
          return { reply: currentText || text, error: "Request timed out after 120 seconds." };
        }
        console.error(`[voice] stream error: ${e.message}`);
        return { reply: text, error: `Stream error: ${e.message}` };
      }

      let finalMessage;
      try { finalMessage = await stream.result(); } catch (e) {
        return { reply: text, error: `Result error: ${e.message}` };
      }

      try {
        const usage = finalMessage.usage;
        trackCost("voice-session", "voice-agent", model.provider, model.id,
          usage?.inputTokens || 0, usage?.outputTokens || 0);
      } catch {}

      voiceMessages.push(finalMessage);
      if (currentText.trim()) {
        accumulatedText += (accumulatedText ? " " : "") + currentText.trim();
      }

      const toolCalls = finalMessage.content.filter(c => c.type === "toolCall" || c.type === "toolUse");
      if (toolCalls.length === 0) break;

      for (const tc of toolCalls) {
        const args = tc.arguments || tc.input || {};
        const id = tc.id || `tc_${Date.now()}_${toolCallIndex++}`;
        let resultText;
        try { resultText = await executeTool(tc.name, args, process.cwd()); }
        catch (e) { resultText = `Error: ${e.message}`; }
        voiceMessages.push({
          role: "toolResult", toolCallId: id, toolName: tc.name,
          content: [{ type: "text", text: resultText }],
          isError: resultText.startsWith("Error:"),
          timestamp: Date.now(),
        });
      }
    }

    try {
      const cleanTextForTTS = accumulatedText
        .replace(/\*/g, "")
        .replace(/_/g, "")
        .replace(/#/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Remove markdown links, keep text
        .replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "") // Remove emojis
        .replace(/\([^)]+\)/g, "") // Remove text in parenthesis (like tones)
        .replace(/\s+/g, " ")
        .trim();

      const ttsStart = Date.now();
      const ttsR = await fetch(`${TTS_SERVER}/v1/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanTextForTTS, voice: voiceId }),
        signal: AbortSignal.timeout(60000),
      });
      if (ttsR.ok) {
        const ttsData = await ttsR.json();
        console.log(`[voice] TTS generated in ${Date.now() - ttsStart}ms`);
        return { reply: accumulatedText, audio: ttsData.audio, sampleRate: ttsData.sampleRate };
      }
      const ttsErr = await ttsR.text().catch(() => `HTTP ${ttsR.status}`);
      console.error(`[voice] TTS server returned ${ttsR.status}: ${ttsErr}`);
      return { reply: accumulatedText, ttsError: `TTS server error (${ttsR.status})` };
    } catch (e2) {
      console.error(`[voice] TTS error: ${e2.message}`);
      if (e2.message?.includes("connect") || e2.message?.includes("ECONNREFUSED")) {
        return { reply: accumulatedText, ttsError: "TTS server not running on port 8000." };
      }
      return { reply: accumulatedText, ttsError: `TTS failed: ${e2.message}` };
    }
  });

  // WebSocket Voice Chat streaming endpoint
  app.get("/api/voice/chat-stream", { websocket: true }, (socket, req) => {
    console.log(`[voice-stream] WebSocket connected from ${req.ip}`);

    // Heartbeat — close stale connections
    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) {
        try { socket.close(); } catch {}
        return;
      }
      alive = false;
      try { socket.ping(); } catch {}
    }, 30000);

    socket.on("pong", () => { alive = true; });

    socket.on("close", () => {
      clearInterval(pingTimer);
      console.log("[voice-stream] WebSocket disconnected");
    });

    socket.on("error", (err) => {
      clearInterval(pingTimer);
      console.error("[voice-stream] WebSocket error:", err?.message);
    });

    socket.on("message", async (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        try { socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" })); } catch {}
        return;
      }

      if (msg.type === "ping") {
        try { socket.send(JSON.stringify({ type: "pong" })); } catch {}
        return;
      }

      if (msg.type === "text") {
        const { text, voice } = msg;
        if (!text) {
          try { socket.send(JSON.stringify({ type: "error", message: "text is required" })); } catch {}
          return;
        }

        const voiceId = voice || "af_bella";
        console.log(`[voice-stream] Agent request: "${text.substring(0, 80)}"`);

        // Send status: thinking
        try { socket.send(JSON.stringify({ type: "status", status: "thinking" })); } catch {}

        const model = resolveModel();
        const systemPrompt = loadVoiceSystemPrompt();
        const tools = getActiveTools();
        const auth = getModelAuth(model);

        voiceMessages.push({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
        while (voiceMessages.length > MAX_VOICE_HISTORY) voiceMessages.shift();

        let toolCallIndex = 0;
        let accumulatedText = "";
        const MAX_TURNS = 10;

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          let stream, currentText = "";

          try {
            stream = streamSimple(model, {
              systemPrompt,
              messages: voiceMessages,
              tools,
            }, {
              apiKey: auth.apiKey,
              headers: auth.headers,
              reasoning: "off",
              maxTokens: model.maxTokens || 8192,
              signal: AbortSignal.timeout(120000),
            });
          } catch (e) {
            voiceMessages.pop();
            console.error(`[voice-stream] streamSimple error: ${e.message}`);
            try { socket.send(JSON.stringify({ type: "error", message: `Model error: ${e.message}` })); } catch {}
            return;
          }

          try {
            // Keep the status as thinking while generating the whole response
            try { socket.send(JSON.stringify({ type: "status", status: "thinking" })); } catch {}

            for await (const event of stream) {
              if (event.type === "text_delta") {
                const delta = event.delta;
                currentText += delta;

                // Send text delta to frontend immediately so user sees typing in real-time
                try { socket.send(JSON.stringify({ type: "text_delta", delta })); } catch {}
              }
            }
          } catch (e) {
            console.error(`[voice-stream] stream error: ${e.message}`);
          }

          let finalMessage;
          try {
            finalMessage = await stream.result();
          } catch (e) {
            console.error(`[voice-stream] Result error: ${e.message}`);
            finalMessage = { role: "agent", content: [{ type: "text", text: accumulatedText + currentText }] };
          }

          try {
            const usage = finalMessage.usage;
            trackCost("voice-session", "voice-agent", model.provider, model.id,
              usage?.inputTokens || 0, usage?.outputTokens || 0);
          } catch {}

          voiceMessages.push(finalMessage);
          if (currentText.trim()) {
            accumulatedText += (accumulatedText ? " " : "") + currentText.trim();
          }

          // Once the LLM response is fully generated, split and synthesize the entire text
          const fullText = currentText.trim();
          if (fullText) {
            // Split by standard sentence punctuation (. ! ?)
            const sentences = fullText.split(/(?<=[.!?])\s+/).filter(Boolean);
            
            // If only one sentence and it's long, also split on clauses to reduce TTS latency
            let ttsSentences = sentences;
            if (sentences.length === 1 && sentences[0].length > 120) {
              ttsSentences = sentences[0].split(/(?<=[,;:])\s+/).filter(Boolean);
              if (ttsSentences.length < 2) ttsSentences = sentences;
            }

            // Generate all TTS in parallel and wait for all to complete
            const ttsPromises = ttsSentences.map(async (sentence) => {
              const cleanSentence = sentence.trim();
              if (!cleanSentence) return null;
              const ttsData = await generateTTS(cleanSentence, voiceId);
              return {
                text: cleanSentence,
                ttsData
              };
            });

            // Wait for all TTS promises to resolve (ensures continuous audio playback with 0 gaps)
            const results = (await Promise.all(ttsPromises)).filter(Boolean);

            // Change status to speaking as voice playback begins
            try { socket.send(JSON.stringify({ type: "status", status: "speaking" })); } catch {}

            // Send all results — always include text, whether TTS succeeded or not
            for (const item of results) {
              try {
                if (item.ttsData) {
                  socket.send(JSON.stringify({
                    type: "audio_chunk",
                    audio: item.ttsData.audio,
                    sampleRate: item.ttsData.sampleRate || 24000,
                    text: item.text
                  }));
                } else {
                  // TTS failed — still deliver text so the user sees the full response
                  socket.send(JSON.stringify({
                    type: "text_chunk",
                    text: item.text
                  }));
                }
              } catch (e) {
                console.error("[voice-stream] Failed to send chunk over socket:", e.message);
              }
            }
          }

          const toolCalls = finalMessage.content.filter(c => c.type === "toolCall" || c.type === "toolUse");
          if (toolCalls.length === 0) break;

          // If there are tool calls, we execute them and repeat the loop
          // Send status: thinking
          try { socket.send(JSON.stringify({ type: "status", status: "thinking" })); } catch {}

          for (const tc of toolCalls) {
            const args = tc.arguments || tc.input || {};
            const id = tc.id || `tc_${Date.now()}_${toolCallIndex++}`;
            let resultText;
            try { resultText = await executeTool(tc.name, args, process.cwd()); }
            catch (e) { resultText = `Error: ${e.message}`; }
            voiceMessages.push({
              role: "toolResult", toolCallId: id, toolName: tc.name,
              content: [{ type: "text", text: resultText }],
              isError: resultText.startsWith("Error:"),
              timestamp: Date.now(),
            });
          }
        }

        // Send done event
        try {
          socket.send(JSON.stringify({
            type: "done",
            reply: accumulatedText
          }));
        } catch {}
      }
    });
  });

  // Helper to generate TTS in parallel
  async function generateTTS(text, voiceId) {
    // Clean text of markdown/emojis/etc.
    const cleanText = text
      .replace(/\*/g, "")
      .replace(/_/g, "")
      .replace(/#/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "")
      .replace(/\([^)]+\)/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText) return null;

    try {
      const ttsStart = Date.now();
      const ttsR = await fetch(`${TTS_SERVER}/v1/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText, voice: voiceId }),
        signal: AbortSignal.timeout(60000),
      });

      if (ttsR.ok) {
        const ttsData = await ttsR.json();
        console.log(`[voice-stream] TTS sentence generated in ${Date.now() - ttsStart}ms: "${cleanText.substring(0, 40)}..."`);
        return ttsData;
      } else {
        const ttsErr = await ttsR.text().catch(() => `HTTP ${ttsR.status}`);
        console.error(`[voice-stream] TTS server returned ${ttsR.status}: ${ttsErr}`);
        return null;
      }
    } catch (e) {
      console.error(`[voice-stream] TTS fetch error: ${e.message}`);
      return null;
    }
  }

  // Node.js Voice Cloning endpoint
  app.post("/api/voice/clone", async (req, reply) => {
    const { name, transcript, audio } = req.body || {};
    if (!name || !transcript || !audio) {
      return reply.code(400).send({ error: "name, transcript, and audio (base64) are required" });
    }

    try {
      const cloneR = await fetch(`${TTS_SERVER}/v1/voices/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, transcript, audio_base64: audio }),
        signal: AbortSignal.timeout(120000),
      });

      if (cloneR.ok) {
        const cloneData = await cloneR.json();
        return cloneData;
      }
      const errText = await cloneR.text().catch(() => `HTTP ${cloneR.status}`);
      return reply.code(cloneR.status).send({ error: `TTS server clone failed: ${errText}` });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.delete("/api/voice/clone/:id", async (req, reply) => {
    const { id } = req.params;
    try {
      const delR = await fetch(`${TTS_SERVER}/v1/voices/clone/${id}`, {
        method: "DELETE",
      });
      if (delR.ok) {
        return await delR.json();
      }
      const errText = await delR.text().catch(() => `HTTP ${delR.status}`);
      return reply.code(delR.status).send({ error: `TTS server delete failed: ${errText}` });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.get("/api/voice/voices", async () => {
    try {
      const r = await fetch(`${TTS_SERVER}/v1/voices`);
      const data = await r.json();
      return data;
    } catch {
      return { voices: [], active: "af_bella" };
    }
  });

  app.post("/api/voice/select", async (req, reply) => {
    const { voice_id } = req.body || {};
    if (!voice_id) return reply.code(400).send({ error: "voice_id is required" });
    try {
      await fetch(`${TTS_SERVER}/v1/voices/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id }),
      });
      return { active: voice_id };
    } catch {
      return { active: voice_id };
    }
  });

  app.post("/api/voice/tts", async (req, reply) => {
    const { text, voice } = req.body || {};
    if (!text) return reply.code(400).send({ error: "text is required" });
    const voiceId = voice || "af_bella";
    
    const cleanText = text
      .replace(/\*/g, "")
      .replace(/_/g, "")
      .replace(/#/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "")
      .replace(/\([^)]+\)/g, "")
      .replace(/\s+/g, " ")
      .trim();

    try {
      const ttsR = await fetch(`${TTS_SERVER}/v1/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText, voice: voiceId }),
        signal: AbortSignal.timeout(60000),
      });
      if (ttsR.ok) {
        const ttsData = await ttsR.json();
        return { audio: ttsData.audio, sampleRate: ttsData.sampleRate };
      }
      return reply.code(ttsR.status).send({ error: `TTS failed: ${ttsR.status}` });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post("/api/voice/stt", async (req, reply) => {
    const body = req.body;
    if (!body || !Buffer.isBuffer(body) || body.length < 44) {
      return reply.code(400).send({ error: "valid WAV audio data required" });
    }
    console.log(`[voice] STT forwarding ${body.length} bytes to TTS server`);
    try {
      const ttsR = await fetch(`${TTS_SERVER}/v1/stt`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body,
        signal: AbortSignal.timeout(120000),
      });
      if (ttsR.ok) return await ttsR.json();
      const errBody = await ttsR.json().catch(() => ({ error: `HTTP ${ttsR.status}` }));
      console.error("[voice] STT upstream error:", ttsR.status, errBody);
      return reply.code(ttsR.status).send(errBody);
    } catch (err) {
      console.error("[voice] STT fetch failed:", err.message);
      if (err.message?.includes("connect") || err.message?.includes("ECONNREFUSED")) {
        return reply.code(502).send({ error: "TTS server not running on port 8000. Restart the web server to auto-start it." });
      }
      return reply.code(500).send({ error: `STT failed: ${err.message}` });
    }
  });

  // Sub-agent process health — checks bridge processes and active agents
  app.get("/api/health/subagents", async () => {
    const info = {
      bridges: { social: false, email: false },
      activeSwarms: currentSwarmState ? 1 : 0,
      websocketClients: swarmSockets.size,
      bridgePids: { social: socialBridgePid, email: emailBridgePid },
      timestamp: new Date().toISOString(),
    };
    try {
      const socialResp = await fetch(`${SOCIAL_BRIDGE}/status`, { signal: AbortSignal.timeout(3000) });
      if (socialResp.ok) info.bridges.social = true;
    } catch {}
    try {
      const emailResp = await fetch(`${EMAIL_BRIDGE}/status`, { signal: AbortSignal.timeout(3000) });
      if (emailResp.ok) info.bridges.email = true;
    } catch {}
    return info;
  });

  app.get("/api/session/checkpoints", async () => ({ checkpoints: listCheckpoints() }));
  app.post("/api/session/checkpoint", async (req) => {
    const ckpt = createCheckpoint(req.body?.label);
    return ckpt;
  });
  app.post("/api/session/restore", async (req) => {
    const result = restoreCheckpoint(req.body?.id);
    return result;
  });

  app.get("/api/settings", async () => loadSettings());
  app.post("/api/settings", {
    schema: { body: { type: "object" }, response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } } },
  }, async (req) => {
    const current = loadSettings();
    const safeBody = JSON.parse(JSON.stringify(req.body || {}));
    const updated = { ...current, ...safeBody };
    fs.writeFileSync(path.join(PI_DIR, "settings.json"), JSON.stringify(updated, null, 2));
    try { saveSessionState({ lastActive: Date.now(), toolCallCount: _toolCallCount, memoryCount: readMemory().length, checkpoints: listCheckpoints().length, model: resolveModel().id }); } catch {}
    return { ok: true };
  });
  app.get("/api/models", {
    schema: {
      response: { 200: { type: "object", properties: { models: { type: "array" }, providers: { type: "array" } } } },
    },
  }, async () => {
    const modelsPath = path.join(PI_DIR, "models.json");
    try {
      const res = await fetch("http://127.0.0.1:1234/v1/models", { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = await res.json();
        const live = (body.data || []).map(m => ({
          id: m.id, name: m.name || m.id,
          api: "openai-completions",
          contextWindow: 4096, maxTokens: 2048,
          input: ["text"], reasoning: false,
        }));
        if (live.length) {
          hasLive = true;
          let cfg = { providers: {} };
          try { cfg = JSON.parse(fs.readFileSync(modelsPath, "utf8")); } catch {}
          cfg.providers = cfg.providers || {};
          cfg.providers.lmstudio = {
            api: "openai-completions", apiKey: "not-needed",
            baseUrl: "http://127.0.0.1:1234/v1", models: live,
          };
          fs.writeFileSync(modelsPath, JSON.stringify(cfg, null, 2));
        }
      }
    } catch {}
    const models = loadModels();
    return { models: Array.isArray(models) ? models : [] };
  });
  app.get("/api/model-providers", async () => {
    const online = [];
    const checks = [
      { provider: "lmstudio", url: "http://127.0.0.1:1234/v1/models", baseUrl: "http://127.0.0.1:1234/v1" },
      { provider: "ollama", url: "http://127.0.0.1:11434/api/tags", baseUrl: "http://127.0.0.1:11434/v1" },
    ];
    for (const c of checks) {
      try {
        const res = await fetch(c.url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const body = await res.json();
          let models = [];
          if (c.provider === "lmstudio") models = (body.data || []).map(m => ({ id: m.id, provider: c.provider }));
          if (c.provider === "ollama") models = (body.models || []).map(m => ({ id: m.name, provider: c.provider }));
          online.push({ provider: c.provider, reachable: true, baseUrl: c.baseUrl, models });
        }
      } catch {}
    }
    return { providers: online };
  });

  app.post("/api/models/check", async () => {
    const online = [];
    // Check common local providers
    const checks = [
      { provider: "lmstudio", url: "http://127.0.0.1:1234/v1/models", baseUrl: "http://127.0.0.1:1234/v1" },
      { provider: "ollama", url: "http://127.0.0.1:11434/api/tags", baseUrl: "http://127.0.0.1:11434/v1" },
    ];
    for (const c of checks) {
      try {
        const res = await fetch(c.url);
        if (res.ok) {
          const body = await res.json();
          let models = [];
          if (c.provider === "lmstudio") models = (body.data || []).map((m) => ({ id: m.id, provider: c.provider }));
          if (c.provider === "ollama") models = (body.models || []).map((m) => ({ id: m.name, provider: c.provider }));
          online.push({ provider: c.provider, reachable: true, baseUrl: c.baseUrl, models });
        }
      } catch {}
    }
    return { providers: online };
  });

  // ── Model Download ────────────────────────────────────────────────────
  const MODELS_DOWNLOAD_DIR = path.join(PI_DIR, "downloaded-models");
  app.post("/api/models/download", async (req) => {
    const { modelId, source } = req.body || {};
    if (!modelId) return { error: "modelId required" };
    const src = source || "huggingface";
    try {
      fs.mkdirSync(MODELS_DOWNLOAD_DIR, { recursive: true });
      const targetDir = path.join(MODELS_DOWNLOAD_DIR, modelId.replace(/[^a-zA-Z0-9_-]/g, "_"));
      if (fs.existsSync(targetDir)) return { success: true, path: targetDir, message: "Already downloaded" };
      const cmds = [
        `huggingface-cli download ${modelId} --local-dir "${targetDir}" --quiet 2>/dev/null`,
        `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://huggingface.co/${modelId} "${targetDir}" 2>/dev/null`,
      ];
      for (const cmd of cmds) {
        try {
          execSync(cmd, { timeout: 300000, cwd: MODELS_DOWNLOAD_DIR });
          if (fs.existsSync(targetDir)) return { success: true, path: targetDir, message: `Downloaded ${modelId}` };
        } catch {}
      }
      const dlRecord = path.join(MODELS_DOWNLOAD_DIR, "downloads.json");
      const records = JSON.parse(fs.readFileSync(dlRecord, "utf8").catch(() => "[]"));
      records.push({ modelId, source: src, timestamp: Date.now(), status: "pending" });
      fs.writeFileSync(dlRecord, JSON.stringify(records, null, 2));
      return { success: true, message: `Download queued for ${modelId}. Run: huggingface-cli download ${modelId}` };
    } catch (e) { return { error: e.message, success: false }; }
  });
  app.get("/api/models/downloads", async () => {
    const records = []; const dlRecord = path.join(MODELS_DOWNLOAD_DIR, "downloads.json");
    try { records.push(...JSON.parse(fs.readFileSync(dlRecord, "utf8"))); } catch {}
    try {
      const dirs = fs.readdirSync(MODELS_DOWNLOAD_DIR).filter(d => d !== "downloads.json");
      for (const dir of dirs) records.push({ modelId: dir, path: path.join(MODELS_DOWNLOAD_DIR, dir), status: "downloaded" });
    } catch {}
    return { downloads: records };
  });

  // ── Model Comparison Voting ──────────────────────────────────────────
  const VOTES_FILE = path.join(PI_DIR, "model-votes.json");
  function loadVotes() {
    try { return JSON.parse(fs.readFileSync(VOTES_FILE, "utf8")); } catch { return []; }
  }
  app.post("/api/models/vote", async (req) => {
    const { promptId, winner, loser } = req.body || {};
    if (!promptId || !winner) return { error: "promptId and winner required" };
    const votes = loadVotes();
    votes.push({ promptId, winner, loser: loser || null, votedAt: Date.now() });
    fs.writeFileSync(VOTES_FILE, JSON.stringify(votes, null, 2));
    return { success: true };
  });
  app.get("/api/models/vote-stats", async () => {
    const votes = loadVotes();
    const stats = {};
    for (const v of votes) {
      if (!stats[v.winner]) stats[v.winner] = { wins: 0, losses: 0, total: 0 };
      stats[v.winner].wins++; stats[v.winner].total++;
      if (v.loser) {
        if (!stats[v.loser]) stats[v.loser] = { wins: 0, losses: 0, total: 0 };
        stats[v.loser].losses++; stats[v.loser].total++;
      }
    }
    const ranked = Object.entries(stats).map(([model, s]) => ({ model, ...s, winRate: s.total > 0 ? Math.round(s.wins / s.total * 100) : 0 })).sort((a, b) => b.winRate - a.winRate);
    return { votes: votes.length, rankings: ranked };
  });

  app.post("/api/chat/completions", {
    schema: {
      body: { type: "object", required: ["messages"], properties: { model: { type: "string" }, messages: { type: "array", items: { type: "object" } }, stream: { type: "boolean" }, max_tokens: { type: "number" } } },
      response: { 200: { type: "object", properties: { choices: { type: "array" }, usage: { type: "object" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const { model: reqModel, messages, stream, max_tokens } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { error: "messages array is required" };
    }
    const model = resolveModel();
    const baseUrl = model.baseUrl || "http://127.0.0.1:1234/v1";
    const { apiKey } = getModelAuth(model);
    const body = {
      model: reqModel || model.id,
      messages,
      stream: !!stream,
      max_tokens: max_tokens || 1024,
    };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 600000);
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        return { error: `Upstream error ${r.status}: ${errText.slice(0, 200)}` };
      }
      const data = await r.json();
      if (data.choices?.[0]?.message) {
        const msg = data.choices[0].message;
        if (!msg.content && msg.reasoning_content) {
          msg.content = msg.reasoning_content;
        }
      }
      return data;
    } catch (e) {
      const tried = `${baseUrl}/chat/completions`;
      if (e.name === "AbortError") {
        return { error: `LLM at ${tried} timed out after 600s (10 min). The local model is slow for long documents. Try a narrower topic or check LM Studio GPU settings.` };
      }
      if (e.code === "ECONNREFUSED" || e.message?.includes("refused")) {
        return { error: `Cannot connect to ${tried} — connection refused. Start your LLM server (LM Studio / Ollama).` };
      }
      return { error: `LLM request to ${tried} failed: ${e.message || e}` };
    }
  });

  // ── Vault with audit logging ─────────────────────────────────────────────
  const VAULT_AUDIT_FILE = path.join(PI_DIR, "vault-audit.jsonl");
  function vaultAudit(action, key, success) {
    try {
      const entry = { ts: new Date().toISOString(), action, key, ip: "local" };
      fs.appendFileSync(VAULT_AUDIT_FILE, JSON.stringify(entry) + "\n");
    } catch {}
  }

  app.post("/api/vault/set", {
    schema: { body: { type: "object", required: ["key", "value"], properties: { key: { type: "string" }, value: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
  }, async (req) => {
    const err = validateBody(req.body, ["key", "value"]);
    if (err) return { ok: false, error: err };
    try { vaultSet(req.body.key, req.body.value); vaultAudit("set", req.body.key, true); return { ok: true }; }
    catch (e) { vaultAudit("set", req.body.key, false); throw e; }
  });
  app.post("/api/vault/get", async (req) => {
    const err = validateBody(req.body, ["key"]);
    if (err) return { ok: false, error: err };
    vaultAudit("get", req.body.key, true);
    const value = vaultGet(req.body.key);
    if (value === null) return { ok: false, value: null };
    const redacted = value.length > 4 ? value.slice(0, 4) + "***" : "***";
    return { ok: true, value: redacted };
  });
  app.post("/api/vault/delete", async (req) => {
    const err = validateBody(req.body, ["key"]);
    if (err) return { ok: false, error: err };
    const result = vaultDelete(req.body.key);
    vaultAudit("delete", req.body.key, result);
    return { ok: result };
  });
  app.get("/api/vault/list", {
    schema: { response: { 200: { type: "object", properties: { keys: { type: "array", items: { type: "string" } } } } } },
  }, async () => ({ keys: vaultList() }));
  app.get("/api/vault/health", async () => vaultHealth());
  app.get("/api/vault/export", async () => {
    const vault = readVault();
    return { vault, exportedAt: new Date().toISOString() };
  });
  app.post("/api/vault/import", async (req) => {
    const { entries, merge } = req.body || {};
    if (!entries || typeof entries !== "object") return { error: "entries object required", imported: 0 };
    const current = readVault();
    let count = 0;
    for (const [key, val] of Object.entries(entries)) {
      if (merge && current[key] !== undefined) continue;
      vaultSet(key, String(val));
      count++;
    }
    return { success: true, imported: count };
  });

  // Contacts API
  app.get("/api/contacts", async () => {
    const db = getContactsDb();
    if (!db) return { contacts: [] };
    return { contacts: db.prepare("SELECT * FROM contacts ORDER BY name ASC LIMIT 200").all() };
  });
  app.post("/api/contacts", {
    schema: {
      body: { type: "object", required: ["name"], properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, organization: { type: "string" }, notes: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, id: { type: "string" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const db = getContactsDb(); if (!db) return { error: "Unavailable" };
    const { name, email, phone, organization, notes } = req.body || {};
    if (!name) return { error: "name required" };
    const id = `c_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const now = Date.now();
    db.prepare("INSERT INTO contacts (id,name,email,phone,organization,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, name, email||"", phone||"", organization||"", notes||"", now, now);
    return { success: true, id };
  });
  app.put("/api/contacts/:id", async (req) => {
    const db = getContactsDb(); if (!db) return { error: "Unavailable" };
    const fields = []; const vals = [];
    for (const k of ["name","email","phone","organization","notes","avatar"]) {
      if (req.body[k] !== undefined) { fields.push(`${k}=?`); vals.push(req.body[k]); }
    }
    if (!fields.length) return { error: "No fields" };
    fields.push("updated_at=?"); vals.push(Date.now()); vals.push(req.params.id);
    db.prepare(`UPDATE contacts SET ${fields.join(",")} WHERE id=?`).run(...vals);
    return { success: true };
  });
  app.delete("/api/contacts/:id", async (req) => {
    const db = getContactsDb(); if (!db) return { error: "Unavailable" };
    db.prepare("DELETE FROM contacts WHERE id=?").run(req.params.id);
    return { success: true };
  });

  // CardDAV sync endpoint
  app.post("/api/contacts/carddav/sync", async (req) => {
    const { serverUrl, username, password } = req.body || {};
    if (!serverUrl || !username || !password) return { error: "serverUrl, username, password required" };
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, "")}/addressbook/default/`, {
        headers: { "Authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64") },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { error: `CardDAV server returned ${res.status}` };
      const text = await res.text();
      // Parse vCard data
      const vcards = text.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) || [];
      const db = getContactsDb();
      let imported = 0;
      for (const vcard of vcards) {
        const name = vcard.match(/FN:(.+)/)?.[1]?.trim() || "";
        const email = vcard.match(/EMAIL:(.+)/)?.[1]?.trim() || "";
        const phone = vcard.match(/TEL:(.+)/)?.[1]?.trim() || "";
        if (!name) continue;
        const id = `carddav_${crypto.createHash("md5").update(name + email).digest("hex").slice(0, 12)}`;
        const now = Date.now();
        db.prepare("INSERT OR IGNORE INTO contacts (id, name, email, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, name, email, phone, now, now);
        imported++;
      }
      return { success: true, imported, total: vcards.length };
    } catch (e) { return { error: e.message }; }
  });

  // ── Email Integration (IMAP + SMTP) ─────────────────────────────────
  const EMAIL_STATE_FILE = path.join(PI_DIR, "email-state.json");
  function getEmailState() {
    try { return JSON.parse(fs.readFileSync(EMAIL_STATE_FILE, "utf8")); } catch { return { accounts: [], cachedEmails: [] }; }
  }
  function saveEmailState(state) { fs.writeFileSync(EMAIL_STATE_FILE, JSON.stringify(state, null, 2)); }
  app.post("/api/email/accounts", async (req) => {
    const { imapHost, imapPort, smtpHost, smtpPort, username, password, useTls } = req.body || {};
    if (!imapHost || !username) return { error: "imapHost and username required" };
    const state = getEmailState();
    const id = `email_${Date.now()}`;
    state.accounts.push({ id, imapHost, imapPort: imapPort || 993, smtpHost: smtpHost || imapHost, smtpPort: smtpPort || 465, username, password: encrypt(password || ""), useTls: useTls !== false });
    saveEmailState(state);
    return { success: true, id };
  });
  app.get("/api/email/accounts", async () => {
    const state = getEmailState();
    return { accounts: state.accounts.map(a => ({ ...a, password: "***" })) };
  });
  app.post("/api/email/fetch", async (req) => {
    const { accountId, folder, maxMessages } = req.body || {};
    const state = getEmailState();
    const account = state.accounts.find(a => a.id === accountId);
    if (!account) return { error: "Account not found" };
    try {
      const password = decrypt(account.password);
      const net = await import("node:net");
      const tls = await import("node:tls");
      const port = account.imapPort || 993;
      const useTls = account.useTls !== false;
      // Simplified IMAP fetch via raw socket
      const client = useTls ? tls : net;
      return new Promise((resolve) => {
        const socket = client.connect(port, account.imapHost, () => {
          let buf = "";
          let step = 0;
          const tag = `a${Date.now() % 1000}`;
          const onData = (data) => {
            buf += data.toString();
            if (step === 0 && buf.includes("* OK")) {
              socket.write(`${tag} LOGIN ${account.username} ${password}\r\n`);
              step = 1; buf = "";
            } else if (step === 1 && buf.includes(`${tag} OK`)) {
              socket.write(`${tag} SELECT "${folder || "INBOX"}"\r\n`);
              step = 2; buf = "";
            } else if (step === 2 && buf.includes(`${tag} OK`)) {
              socket.write(`${tag} FETCH 1:${maxMessages || 10} (BODY[HEADER.FIELDS (SUBJECT FROM DATE)])\r\n`);
              step = 3; buf = "";
            } else if (step === 3 && (buf.includes(`${tag} OK`) || buf.includes(`${tag} BAD`))) {
              socket.end();
              const emails = (buf.match(/\* \d+ FETCH[\s\S]*?\)\)/g) || []).map(raw => ({
                raw: raw.slice(0, 500),
                subject: raw.match(/SUBJECT:? "?([^"\r\n]+)/i)?.[1]?.trim() || "(no subject)",
                from: raw.match(/FROM:? "?([^"\r\n]+)/i)?.[1]?.trim() || "(unknown)",
                date: raw.match(/DATE:? "?([^"\r\n]+)/i)?.[1]?.trim() || "",
              }));
              resolve({ emails });
            }
          };
          socket.on("data", onData);
          setTimeout(() => { socket.end(); resolve({ emails: [] }); }, 10000);
        });
        socket.on("error", () => resolve({ error: "Connection failed", emails: [] }));
      });
    } catch (e) { return { error: e.message, emails: [] }; }
  });
  app.post("/api/email/send", async (req) => {
    const { accountId, to, subject, body } = req.body || {};
    if (!to || !subject) return { error: "to and subject required" };
    const state = getEmailState();
    const account = state.accounts.find(a => a.id === accountId);
    if (!account) return { error: "Account not found" };
    try {
      const password = decrypt(account.password);
      const net = await import("node:net");
      const tls = await import("node:tls");
      const client = tls;
      return new Promise((resolve) => {
        const socket = client.connect(account.smtpPort || 465, account.smtpHost, () => {
          let buf = "";
          let step = 0;
          const onData = (data) => {
            buf += data.toString();
            if (step === 0 && buf.includes("220")) {
              socket.write(`EHLO pi-custom-pack\r\n`); step = 1; buf = "";
            } else if (step === 1 && buf.includes("250")) {
              socket.write(`AUTH LOGIN\r\n`); step = 2; buf = "";
            } else if (step === 2 && buf.includes("334")) {
              socket.write(Buffer.from(account.username).toString("base64") + "\r\n"); step = 3; buf = "";
            } else if (step === 3 && buf.includes("334")) {
              socket.write(Buffer.from(password).toString("base64") + "\r\n"); step = 4; buf = "";
            } else if (step === 4 && buf.includes("235")) {
              socket.write(`MAIL FROM:<${account.username}>\r\n`); step = 5; buf = "";
            } else if (step === 5 && buf.includes("250")) {
              socket.write(`RCPT TO:<${to}>\r\n`); step = 6; buf = "";
            } else if (step === 6 && buf.includes("250")) {
              socket.write("DATA\r\n"); step = 7; buf = "";
            } else if (step === 7 && buf.includes("354")) {
              socket.write(`From: ${account.username}\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${body}\r\n.\r\n`);
              step = 8; buf = "";
            } else if (step === 8 && (buf.includes("250") || buf.includes("OK"))) {
              socket.write("QUIT\r\n"); socket.end();
              resolve({ success: true });
            }
          };
          socket.on("data", onData);
          setTimeout(() => { socket.end(); resolve({ success: false, error: "Timeout" }); }, 15000);
        });
        socket.on("error", (e) => resolve({ success: false, error: e.message }));
      });
    } catch (e) { return { error: e.message, success: false }; }
  });
  app.post("/api/email/ai-summarize", async (req) => {
    const { text } = req.body || {};
    if (!text) return { summary: "No text provided" };
    const lines = text.split("\n").filter(Boolean).slice(0, 50);
    const summary = `Summary of ${lines.length} email(s):\n` + lines.map(l => {
      if (l.includes("Subject:")) return `📧 ${l.replace("Subject:", "").trim()}`;
      if (l.includes("From:")) return `👤 ${l.replace("From:", "").trim()}`;
      return "";
    }).filter(Boolean).join("\n");
    return { summary: summary || "Could not summarize" };
  });

  app.post("/api/email/draft-reply", async (req) => {
    const { emailText, tone } = req.body || {};
    if (!emailText) return { draft: "No email text provided" };
    const toneGuide = tone === "formal" ? "Write a formal, professional reply." : tone === "brief" ? "Write a short, concise reply." : "Write a friendly, conversational reply.";
    try {
      const r = await fetch("http://127.0.0.1:1234/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "", messages: [{ role: "system", content: `You are an email assistant. ${toneGuide} Generate ONLY the reply body, no subject line, no explanation.` }, { role: "user", content: `Generate a reply to this email:\n\n${emailText.slice(0, 2000)}` }], stream: false, max_tokens: 500 }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await r.json();
      return { draft: data.choices?.[0]?.message?.content || "Dear colleague,\n\nThank you for your message.\n\nBest regards" };
    } catch { return { draft: "Dear colleague,\n\nThank you for your message.\n\nBest regards" }; }
  });

  app.post("/api/email/auto-tag", async (req) => {
    const { text } = req.body || {};
    if (!text) return { tags: [] };
    const lower = text.toLowerCase();
    const tags = [];
    if (/invoice|bill|payment|receipt|transaction/i.test(lower)) tags.push("billing");
    if (/meeting|schedule|appointment|calendar|invite/i.test(lower)) tags.push("calendar");
    if (/job|application|hiring|interview|resume|recruiter/i.test(lower)) tags.push("career");
    if (/newsletter|digest|update|announcement/i.test(lower)) tags.push("newsletter");
    if (/password|reset|login|account|security|verify|authentication/i.test(lower)) tags.push("security");
    if (/order|shipping|delivery|tracking|purchase/i.test(lower)) tags.push("shopping");
    if (/support|help|issue|bug|problem|error|fail/i.test(lower)) tags.push("support");
    if (/friend|family|dinner|lunch|party|weekend|thanks|love/i.test(lower)) tags.push("personal");
    if (/report|analysis|summary|review|project|deadline|submission/i.test(lower)) tags.push("work");
    if (tags.length === 0) tags.push("inbox");
    return { tags: [...new Set(tags)] };
  });

  app.post("/api/email/search", async (req) => {
    const { query } = req.body || {};
    if (!query) return { results: [] };
    const state = getEmailState();
    const q = query.toLowerCase();
    const results = state.cachedEmails.filter(e =>
      (e.subject || "").toLowerCase().includes(q) ||
      (e.from || "").toLowerCase().includes(q) ||
      (e.body || "").toLowerCase().includes(q)
    ).slice(0, 20);
    return { results, total: results.length };
  });
  app.post("/api/email/cache", async (req) => {
    const { emails } = req.body || {};
    if (!Array.isArray(emails)) return { cached: 0 };
    const state = getEmailState();
    state.cachedEmails = [...emails, ...state.cachedEmails].slice(0, 500);
    saveEmailState(state);
    return { cached: emails.length };
  });

  // ── Calendar / CalDAV ─────────────────────────────────────────────────
  const CALENDAR_FILE = path.join(PI_DIR, "calendar-events.json");
  function loadCalendarEvents() {
    try { return JSON.parse(fs.readFileSync(CALENDAR_FILE, "utf8")); } catch { return []; }
  }
  function saveCalendarEvents(events) { fs.writeFileSync(CALENDAR_FILE, JSON.stringify(events, null, 2)); }
  app.get("/api/calendar/events", async () => {
    const events = loadCalendarEvents();
    const now = Date.now();
    return { events: events.filter(e => !e.end || e.end > now).sort((a, b) => (a.start || 0) - (b.start || 0)).slice(0, 100) };
  });
  app.post("/api/calendar/events", {
    schema: {
      body: { type: "object", required: ["title", "start"], properties: { title: { type: "string" }, start: { type: "number" }, end: { type: "number" }, description: { type: "string" }, location: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, event: { type: "object" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const { title, start, end, description, location } = req.body || {};
    if (!title || !start) return { error: "title and start required" };
    const events = loadCalendarEvents();
    const event = { id: `cal_${Date.now()}`, title, start, end: end || start + 3600000, description: description || "", location: location || "", createdAt: Date.now() };
    events.push(event);
    saveCalendarEvents(events);
    return { success: true, event };
  });
  app.delete("/api/calendar/events/:id", async (req) => {
    saveCalendarEvents(loadCalendarEvents().filter(e => e.id !== req.params.id));
    return { success: true };
  });
  app.post("/api/calendar/caldav/sync", async (req) => {
    const { serverUrl, username, password } = req.body || {};
    if (!serverUrl || !username) return { error: "serverUrl and username required" };
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, "")}/`, {
        headers: { "Authorization": "Basic " + Buffer.from(`${username}:${password || ""}`).toString("base64") },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { error: `CalDAV returned ${res.status}` };
      const text = await res.text();
      const vevents = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
      const events = loadCalendarEvents();
      let imported = 0;
      for (const vevent of vevents) {
        const title = vevent.match(/SUMMARY:(.+)/i)?.[1]?.trim() || "Untitled";
        const dtStart = vevent.match(/DTSTART(?:;.*?)?:(.+)/i)?.[1]?.trim();
        const dtEnd = vevent.match(/DTEND(?:;.*?)?:(.+)/i)?.[1]?.trim();
        if (!dtStart) continue;
        const parseIcalDate = (s) => { const m = s.match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?/); return m ? new Date(m[1], m[2]-1, m[3]||1, m[4]||0, m[5]||0, m[6]||0).getTime() : Date.now(); };
        const id = `caldav_${crypto.createHash("md5").update(title + dtStart).digest("hex").slice(0, 12)}`;
        if (!events.find(e => e.id === id)) {
          events.push({ id, title, start: parseIcalDate(dtStart), end: dtEnd ? parseIcalDate(dtEnd) : parseIcalDate(dtStart) + 3600000, description: vevent.match(/DESCRIPTION:(.+)/i)?.[1]?.trim() || "", location: vevent.match(/LOCATION:(.+)/i)?.[1]?.trim() || "", createdAt: Date.now() });
          imported++;
        }
      }
      saveCalendarEvents(events);
      return { success: true, imported };
    } catch (e) { return { error: e.message, imported: 0 }; }
  });

  // ── Deep Research API ─────────────────────────────────────────────────────

  app.post("/api/research", async (req) => {
    const { query, depth } = req.body || {};
    if (!query) return { error: "query required" };
    const depths = { quick: 2, moderate: 4, deep: 8 };
    const maxResults = depths[depth] || 4;
    try {
      const results = await searchWebRaw(query, maxResults);
      let summary = "";
      if (results.length > 0) {
        try {
          const findingsText = results.map((r, i) => `[Source ${i + 1}]: Title: ${r.title}\nSnippet: ${r.snippet}`).join("\n\n");
          const systemPrompt = "You are a professional research summarizer. Synthesize the provided search snippets into a concise and informative executive summary. Cite sources in format [Source X] where appropriate.";
          const userPrompt = `Research query: "${query}"\n\nSearch snippets:\n${findingsText}`;
          summary = await getLLMCompletion(systemPrompt, userPrompt);
        } catch (e) {
          console.error("LLM summary generation failed:", e);
        }
      }
      
      if (!summary) {
        summary = results.slice(0, 3).map(r => r.snippet || r.title).join("\n\n") || `Research on "${query}" completed — 0 sources analyzed.`;
      }

      return {
        summary,
        findings: results.map((r, i) => ({
          title: r.title,
          content: r.snippet ? `${r.snippet}\n\nLink: ${r.url}` : `Link: ${r.url}`
        })),
        sources: results.map(r => r.url),
        depth,
      };
    } catch (e) { return { error: e.message }; }
  });

  // Budget
  app.get("/api/budget/config", async () => getBudgetConfig());
  app.post("/api/budget/config", async (req) => {
    if (!req.body || typeof req.body !== "object") return { ok: false, error: "Request body is required" };
    setBudgetConfig(req.body);
    return { ok: true };
  });
  app.get("/api/budget/stats", {
    schema: { response: { 200: { type: "object", properties: { totalSessions: { type: "number" }, totalTokens: { type: "number" }, totalCostUsd: { type: "number" }, dailyTokens: { type: "number" }, dailyCostUsd: { type: "number" }, today: { type: "string" } } } } },
  }, async () => getCostSummary());
  app.get("/api/budget/details", async () => getCostDetails());

  // Telemetry
  app.get("/api/telemetry", async () => {
    const p = path.join(PI_DIR, "telemetry.json");
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      }
    } catch {}
    return { status: "no_data", timestamp: Date.now() };
  });

  // Work products
  app.get("/api/work-products", {
    schema: {
      querystring: { type: "object", properties: { sessionId: { type: "string" }, summary: { type: "string" } } },
      response: { 200: { type: "object", properties: { products: { type: "array" }, summary: { type: "string" } } } },
    },
  }, async (req) => {
    const url = new URL(req.url, `http://${req.hostname}`);
    const sessionId = url.searchParams.get("sessionId") || undefined;
    if (url.searchParams.get("summary") === "true") return { summary: getWorkProductSummary(sessionId) };
    return { products: getWorkProducts(sessionId) };
  });


  app.get("/api/mcp/config", {
    schema: { response: { 200: { type: "object", properties: { servers: { type: "array" } } } } },
  }, async () => ({ servers: loadMcpConfig() }));
  app.post("/api/mcp/config", async (req) => {
    saveMcpConfig(req.body.servers || []);
    startMcpServers().catch(err => console.error("[MCP] Error restarting servers:", err));
    return { ok: true };
  });
  app.post("/api/mcp/test", async (req) => {
    const { name, command, args } = req.body;
    const ALLOWED_MCP_COMMANDS = new Set(["npx", "node", "uvx", "python3", "python", "deno", "bun"]);
    if (!command || typeof command !== "string") {
      return { ok: false, output: "Command is required and must be a string" };
    }
    const cmdName = command.trim().split(/\s+/)[0];
    if (!ALLOWED_MCP_COMMANDS.has(cmdName)) {
      return { ok: false, output: "Command not allowed. Must be one of: " + [...ALLOWED_MCP_COMMANDS].join(", ") };
    }
    try {
      const testArgs = [...(args || []), '--version'];
      const result = spawnSync(cmdName, testArgs, { timeout: 5000, encoding: "utf8", shell: false });
      const output = (result.stdout || "").trim() || (result.stderr || "").trim() || "no version";
      return { ok: result.status === 0, output };
    } catch (e) {
      return { ok: false, output: e.message };
    }
  });

  // Sub-agents
  app.get("/api/agents", async () => ({ agents: listAgents() }));

  // Enhanced agent discovery — checks PATH for CLI agents
  app.get("/api/agents/discover", async () => {
    const knownAgents = [
      { id: "claude-code", name: "Claude Code", backend: "claude", command: "claude", modes: ["default", "plan", "yolo"], supportsTeam: true },
      { id: "codex", name: "Codex", backend: "codex", command: "codex", modes: ["default", "read_only", "yolo"], supportsTeam: true },
      { id: "opencode", name: "OpenCode", backend: "opencode", command: "opencode", modes: ["default", "plan"], supportsTeam: false },
      { id: "hermes", name: "Hermes Agent", backend: "hermes", command: "hermes", modes: ["default", "yolo"], supportsTeam: false },
      { id: "qwen-code", name: "Qwen Code", backend: "qwen", command: "qwen", modes: ["default", "yolo"], supportsTeam: true },
      { id: "gemini-cli", name: "Gemini CLI", backend: "gemini", command: "gemini", modes: ["default", "yolo"], supportsTeam: true },
      { id: "cursor", name: "Cursor Agent", backend: "cursor", command: "cursor", args: ["--agent"], modes: ["default", "plan"], supportsTeam: true },
      { id: "snow-cli", name: "Snow CLI", backend: "snow", command: "snow", args: ["run"], modes: ["default", "yolo"], supportsTeam: true },
      { id: "goose", name: "Goose AI", backend: "goose", command: "goose", modes: ["default"], supportsTeam: false },
      { id: "openclaw", name: "OpenClaw", backend: "openclaw", command: "openclaw", modes: ["default"], supportsTeam: false },
      { id: "kimi-cli", name: "Kimi CLI", backend: "kimi", command: "kimi", modes: ["default"], supportsTeam: false },
      { id: "copilot", name: "GitHub Copilot", backend: "copilot", command: "gh", args: ["copilot"], modes: ["default"], supportsTeam: false },
      { id: "codebuddy", name: "CodeBuddy", backend: "codebuddy", command: "codebuddy", modes: ["default"], supportsTeam: false },
      { id: "qoder", name: "Qoder CLI", backend: "qoder", command: "qoder", modes: ["default"], supportsTeam: false },
      { id: "nanobot", name: "Nanobot", backend: "nanobot", command: "nanobot", modes: ["default"], supportsTeam: false },
      { id: "mistral-vibe", name: "Mistral Vibe", backend: "mistral", command: "mistral", args: ["vibe"], modes: ["default"], supportsTeam: false },
      { id: "augment", name: "Augment Code", backend: "augment", command: "augment", modes: ["default"], supportsTeam: false },
      { id: "factory-droid", name: "Factory Droid", backend: "droid", command: "droid", modes: ["default"], supportsTeam: false },
    ];
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const agents = knownAgents.map(a => {
      let available = false;
      let agentPath = null;
      let version = null;
      try {
        const r = spawnSync(whichCmd, [a.command], { stdio: "pipe", timeout: 3000 });
        available = r.status === 0;
        if (available) {
          agentPath = r.stdout.toString("utf8").trim().split("\n")[0];
          try {
            const v = spawnSync(a.command, ["--version"], { stdio: "pipe", timeout: 3000 });
            if (v.status === 0) version = v.stdout.toString("utf8").trim().split("\n")[0];
          } catch {}
        }
      } catch {}
      return { name: a.name, command: a.command, available, path: agentPath, version };
    });
    return { agents };
  });

  // Team CRUD — persistent teams storage
  app.get("/api/teams", async () => {
    const teams = [];
    try {
      const teamsFile = path.join(os.homedir(), ".pi", "agent", "teams.json");
      if (fs.existsSync(teamsFile)) teams.push(...JSON.parse(fs.readFileSync(teamsFile, "utf8")).teams || []);
    } catch {}
    return { teams };
  });

  app.post("/api/teams", async (req) => {
    const { name, workspace, leaderAgentId } = req.body;
    if (!name || !workspace || !leaderAgentId) throw new Error("name, workspace, leaderAgentId required");
    const team = {
      id: `team_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      name, workspace, workspaceMode: "shared", leaderAgentId,
      agents: [{ slotId: `slot_${Date.now()}`, agentId: leaderAgentId, agentName: leaderAgentId, role: "leader", status: "idle" }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const teamsFile = path.join(os.homedir(), ".pi", "agent", "teams.json");
    let store = { teams: [] };
    try { if (fs.existsSync(teamsFile)) store = JSON.parse(fs.readFileSync(teamsFile, "utf8")); } catch {}
    store.teams.push(team);
    fs.mkdirSync(path.dirname(teamsFile), { recursive: true });
    fs.writeFileSync(teamsFile, JSON.stringify(store, null, 2));
    return { ok: true, team };
  });

  app.post("/api/teams/add-agent", async (req) => {
    const { teamId, agentId } = req.body;
    if (!teamId || !agentId) throw new Error("teamId and agentId required");
    const teamsFile = path.join(os.homedir(), ".pi", "agent", "teams.json");
    let store = { teams: [] };
    try { if (fs.existsSync(teamsFile)) store = JSON.parse(fs.readFileSync(teamsFile, "utf8")); } catch {}
    const team = store.teams.find(t => t.id === teamId);
    if (!team) throw new Error("Team not found");
    const slot = { slotId: `slot_${Date.now()}`, agentId, agentName: agentId, role: "teammate", status: "pending" };
    team.agents.push(slot);
    team.updatedAt = new Date().toISOString();
    fs.writeFileSync(teamsFile, JSON.stringify(store, null, 2));
    return { ok: true, slot };
  });

  app.post("/api/teams/remove-agent", async (req) => {
    const { teamId, slotId } = req.body;
    if (!teamId || !slotId) throw new Error("teamId and slotId required");
    const teamsFile = path.join(os.homedir(), ".pi", "agent", "teams.json");
    let store = { teams: [] };
    try { if (fs.existsSync(teamsFile)) store = JSON.parse(fs.readFileSync(teamsFile, "utf8")); } catch {}
    const team = store.teams.find(t => t.id === teamId);
    if (!team) throw new Error("Team not found");
    const idx = team.agents.findIndex(a => a.slotId === slotId);
    if (idx < 0) throw new Error("Agent not found in team");
    if (team.agents[idx].role === "leader") throw new Error("Cannot remove leader agent");
    team.agents.splice(idx, 1);
    team.updatedAt = new Date().toISOString();
    fs.writeFileSync(teamsFile, JSON.stringify(store, null, 2));
    return { ok: true };
  });

  app.post("/api/teams/delete", async (req) => {
    const { teamId } = req.body;
    if (!teamId) throw new Error("teamId required");
    const teamsFile = path.join(os.homedir(), ".pi", "agent", "teams.json");
    let store = { teams: [] };
    try { if (fs.existsSync(teamsFile)) store = JSON.parse(fs.readFileSync(teamsFile, "utf8")); } catch {}
    store.teams = store.teams.filter(t => t.id !== teamId);
    fs.writeFileSync(teamsFile, JSON.stringify(store, null, 2));
    return { ok: true };
  });

  // Swarm Teams Storage
  app.get("/api/swarm/teams", {
    schema: { response: { 200: { type: "object", properties: { teams: { type: "array" } } } } },
  }, async () => ({ teams: loadSwarmTeams() }));
  app.post("/api/swarm/teams", async (req) => {
    const { name, goal, agents } = req.body;
    if (!name || !agents || !Array.isArray(agents)) {
      throw new Error("Invalid request body. Name and agents array are required.");
    }
    const teams = loadSwarmTeams();
    const existingIndex = teams.findIndex(t => t.name.toLowerCase() === name.toLowerCase());
    const newTeam = { name, goal, agents, createdAt: new Date().toISOString() };
    if (existingIndex >= 0) {
      teams[existingIndex] = newTeam;
    } else {
      teams.push(newTeam);
    }
    saveSwarmTeams(teams);
    return { ok: true, team: newTeam };
  });
  app.post("/api/swarm/teams/delete", async (req) => {
    const { name } = req.body;
    if (!name) {
      throw new Error("Name is required.");
    }
    const teams = loadSwarmTeams();
    const target = teams.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (target && target.default) {
      throw new Error(`"${target.name}" is a default team and cannot be deleted.`);
    }
    const updated = teams.filter(t => t.name.toLowerCase() !== name.toLowerCase());
    saveSwarmTeams(updated);
    return { ok: true };
  });

  // Generate a social media topic idea using the LLM
  app.post("/api/generate/topic", async () => {
    try {
      const model = resolveModel();
      const auth = getModelAuth(model);
      const stream = streamSimple(model, {
        systemPrompt: "You generate creative social media content topic ideas. Output a single concise topic (under 10 words). No explanation.",
        messages: [{ role: "user", content: [{ type: "text", text: "Suggest a trending, engaging social media post topic for a tech/programming audience. Be specific and topical." }] }],
      }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" });
      let text = "";
      for await (const event of stream) {
        if (event.type === "text_delta") text += event.delta;
      }
      return { ok: true, topic: text.replace(/^["'\s]+|["'\s]+$/g, "").trim() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Memory
  app.post("/api/memory/search", async (req) => ({ results: memorySearch(req.body.query, req.body.k ?? 5) }));
  app.post("/api/memory/store", {
    schema: { body: { type: "object", required: ["content"], properties: { content: { type: "string" }, type: { type: "string", enum: ["fact", "decision", "preference", "pattern", "skill"] }, importance: { type: "number" }, tags: { type: "array", items: { type: "string" } } } } },
  }, async (req) => {
    const project = path.basename(process.cwd()) || "global";
    const id = memoryStore(req.body.content, req.body.type, req.body.importance ?? 5, project, req.body.tags || []);
    return { id };
  });
  app.get("/api/memory/stats", {
    schema: { response: { 200: { type: "object", properties: { totalEntries: { type: "number" }, byType: { type: "object" }, byProject: { type: "object" }, averageImportance: { type: "string" } } } } },
  }, async () => memoryStats());

  // ── Auto-Memory Extraction ──────────────────────────────────────────
  app.post("/api/memory/auto-extract", async (req) => {
    const { text } = req.body || {};
    if (!text || text.length < 20) return { extracted: 0 };
    const sentences = text.match(/[^.!?\n]+[.!?\n]/g) || [text];
    let extracted = 0;
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 15 || trimmed.length > 500) continue;
      const keywords = ["i use", "i prefer", "i like", "i work", "my project", "remember that", "important:", "key fact:", "note that", "setup:", "config:", "installed", "configured", "version", "api key", "token", "password", "url:", "endpoint:"];
      const lower = trimmed.toLowerCase();
      if (keywords.some(k => lower.includes(k))) {
        memoryStore(trimmed, "fact", 6, "auto", []);
        extracted++;
      }
    }
    return { extracted, message: `Extracted ${extracted} facts from text` };
  });
  app.get("/api/memory/auto-settings", async () => {
    const settings = loadSettings();
    return { autoExtract: settings.autoMemoryExtract !== false, minLength: settings.autoMemoryMinLength || 20 };
  });
  app.post("/api/memory/auto-settings", async (req) => {
    const settings = loadSettings();
    settings.autoMemoryExtract = req.body?.autoExtract !== false;
    if (req.body?.minLength) settings.autoMemoryMinLength = req.body.minLength;
    fs.writeFileSync(path.join(PI_DIR, "settings.json"), JSON.stringify(settings, null, 2));
    return { success: true };
  });

  // ── Assets API ───────────────────────────────────────────────────────────
  const ALLOWED_EXTENSIONS = /^\.(png|jpg|jpeg|gif|webp|bmp)$/i;
  const MIME_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp" };

  function resolveAssetPath(filename) {
    if (!filename || typeof filename !== "string") return null;
    const resolved = path.resolve(ASSETS_DIR, path.basename(filename));
    if (!resolved.startsWith(ASSETS_DIR)) return null;
    if (!ALLOWED_EXTENSIONS.test(path.extname(resolved))) return null;
    return resolved;
  }

  app.get("/api/assets", async () => {
    try {
      if (!fs.existsSync(ASSETS_DIR)) return { assets: [] };
      const files = fs.readdirSync(ASSETS_DIR).filter(f => ALLOWED_EXTENSIONS.test(path.extname(f)));
      const assets = files.map(f => {
        const stat = fs.statSync(path.join(ASSETS_DIR, f));
        return { filename: f, size: stat.size, created: stat.birthtime || stat.mtime };
      }).sort((a, b) => new Date(b.created) - new Date(a.created));
      return { assets };
    } catch { return { assets: [] }; }
  });
  app.delete("/api/assets/:filename", async (req) => {
    const filePath = resolveAssetPath(req.params.filename);
    if (!filePath) throw new Error("Security Check Failed: Invalid filename");
    if (!fs.existsSync(filePath)) throw new Error("File not found");
    fs.unlinkSync(filePath);
    return { ok: true };
  });
  app.get("/api/assets/files/:filename", async (req, reply) => {
    const filePath = resolveAssetPath(req.params.filename);
    if (!filePath) { reply.status(400).send("Security Check Failed: Invalid filename"); return; }
    if (!fs.existsSync(filePath)) { reply.status(404).send("Not found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    reply.type(mime);
    reply.send(fs.createReadStream(filePath));
  });

  // ── Image Processing ─────────────────────────────────────────────────
  app.post("/api/image/background-removal", async (req) => {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) return { error: "imageBase64 required" };
    try {
      const buf = Buffer.from(imageBase64, "base64");
      const { createCanvas, loadImage } = await import("@napi-rs/canvas");
      const img = await loadImage(buf);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imageData.data;
      const edgePixels = [];
      for (let x = 0; x < img.width; x++) {
        for (let y = 0; y < Math.min(3, img.height); y++) {
          const i = (y * img.width + x) * 4; edgePixels.push([data[i], data[i+1], data[i+2]]);
        }
      }
      const avgBg = edgePixels.reduce((s, p) => [s[0]+p[0], s[1]+p[1], s[2]+p[2]], [0,0,0]);
      avgBg[0] = Math.round(avgBg[0]/edgePixels.length);
      avgBg[1] = Math.round(avgBg[1]/edgePixels.length);
      avgBg[2] = Math.round(avgBg[2]/edgePixels.length);
      const threshold = 60;
      for (let i = 0; i < data.length; i += 4) {
        const dist = Math.sqrt((data[i]-avgBg[0])**2 + (data[i+1]-avgBg[1])**2 + (data[i+2]-avgBg[2])**2);
        if (dist < threshold) data[i+3] = 0;
      }
      ctx.putImageData(imageData, 0, 0);
      const outBuf = canvas.toBuffer("image/png");
      return { imageBase64: outBuf.toString("base64"), width: img.width, height: img.height };
    } catch { return { error: "Background removal failed (canvas module may not be available)" }; }
  });

  app.post("/api/image/inpaint", async (req) => {
    const { imageBase64, maskBase64, prompt } = req.body || {};
    if (!imageBase64) return { error: "imageBase64 required" };
    try {
      const hasPython = execSync("which python3 2>/dev/null || which python 2>/dev/null", { timeout: 2000 }).toString().trim();
      if (hasPython) {
        const script = `
import sys, base64, io
from PIL import Image
img = Image.open(io.BytesIO(base64.b64decode(sys.argv[1])))
if len(sys.argv) > 2 and sys.argv[2]:
    mask = Image.open(io.BytesIO(base64.b64decode(sys.argv[2])))
    from PIL import ImageFilter
    blurred = img.filter(ImageFilter.GaussianBlur(radius=15))
    if mask.mode != 'L': mask = mask.convert('L')
    mask = mask.resize(img.size)
    result = Image.composite(blurred, img, mask)
else:
    result = img.filter(ImageFilter.GaussianBlur(radius=5))
buf = io.BytesIO()
result.save(buf, format='PNG')
print(base64.b64encode(buf.getvalue()).decode())
`;
        const result = execSync(`python3 -c "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}" "${imageBase64}" "${maskBase64 || ""}"`, { timeout: 30000 });
        const base64out = result.toString().trim();
        if (base64out) return { imageBase64: base64out };
      }
    } catch {}
    return { imageBase64, note: "Inpainting unavailable — returned original. Install Python+Pillow for AI inpainting." };
  });

  // ── Image Gallery API ────────────────────────────────────────────────────
  const GALLERY_DIR = path.join(PI_DIR, "gallery");
  const GALLERY_EXT = /^\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i;
  const GALLERY_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml" };

  app.get("/api/gallery", async () => {
    try {
      if (!fs.existsSync(GALLERY_DIR)) return { images: [] };
      const files = fs.readdirSync(GALLERY_DIR).filter(f => GALLERY_EXT.test(path.extname(f)));
      return { images: files.sort() };
    } catch { return { images: [] }; }
  });
  app.post("/api/gallery/upload", async (req, reply) => {
    const { name, data } = req.body || {};
    if (!data) { reply.status(400).send("No file data"); return; }
    const filename = name || `image_${Date.now()}.png`;
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!GALLERY_EXT.test(path.extname(safeName))) { reply.status(400).send("Invalid extension"); return; }
    fs.mkdirSync(GALLERY_DIR, { recursive: true });
    const buf = Buffer.from(data, "base64");
    fs.writeFileSync(path.join(GALLERY_DIR, safeName), buf);
    return { success: true, name: safeName };
  });
  app.get("/api/gallery/:filename", async (req, reply) => {
    const name = path.basename(req.params.filename);
    const filePath = path.join(GALLERY_DIR, name);
    if (!name || !fs.existsSync(filePath)) { reply.status(404).send("Not found"); return; }
    const ext = path.extname(name).toLowerCase();
    reply.type(GALLERY_MIME[ext] || "application/octet-stream");
    reply.send(fs.readFileSync(filePath));
  });
  app.delete("/api/gallery/:filename", async (req) => {
    const name = path.basename(req.params.filename);
    const filePath = path.join(GALLERY_DIR, name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  });

  // ── Knowledge Graph API ──────────────────────────────────────────────────
  const STATE_DB_PATH = path.join(PI_DIR, "session-state.db");

  app.get("/api/knowledge/triplets", async (req) => {
    try {
      const db = getOrCreateDb(STATE_DB_PATH);
      if (!db) return { error: "Database not available", triplets: [], count: 0 };
      const minConf = req.query?.minConfidence ?? 0.5;
      const limit = Math.min(parseInt(req.query?.limit ?? "50"), 200);
      const rows = db.prepare(`
        SELECT id, subject_id, subject_type, subject_label,
               predicate_type, predicate_label, object_id, object_type, object_label,
               confidence_score, last_updated
        FROM triplets
        WHERE confidence_score >= ?
        ORDER BY confidence_score DESC, last_updated DESC
        LIMIT ?
      `).all(minConf, limit);
      return { triplets: rows, count: rows.length };
    } catch (e) {
      return { error: e.message, triplets: [], count: 0 };
    }
  });

  app.get("/api/knowledge/entity", async (req) => {
    try {
      const id = req.query?.id;
      if (!id) return { error: "id parameter required" };
      const db = getOrCreateDb(STATE_DB_PATH);
      if (!db) return { error: "Database not available" };
      const entityRow = db.prepare(`
        SELECT subject_id AS id, subject_label AS label, subject_type AS type
        FROM triplets WHERE subject_id = ? LIMIT 1
      `).get(id);
      if (!entityRow) {
        const objRow = db.prepare(`
          SELECT object_id AS id, object_label AS label, object_type AS type
          FROM triplets WHERE object_id = ? LIMIT 1
        `).get(id);
        if (!objRow) return { error: "Entity not found" };
        const outgoing = db.prepare(`
          SELECT * FROM triplets WHERE subject_id = ? ORDER BY confidence_score DESC
        `).all(id);
        return { entity: objRow, outgoing, incoming: [] };
      }
      const outgoing = db.prepare(`
        SELECT * FROM triplets WHERE subject_id = ? ORDER BY confidence_score DESC
      `).all(id);
      const incoming = db.prepare(`
        SELECT * FROM triplets WHERE object_id = ? ORDER BY confidence_score DESC
      `).all(id);
      return { entity: entityRow, outgoing, incoming };
    } catch (e) {
      return { error: e.message };
    }
  });

  // ── Webhook Endpoints ──────────────────────────────────────────────────
  app.post("/api/webhooks/:source", async (req) => {
    try {
      const source = req.params.source;
      if (!source || typeof source !== "string" || source.length > 64) {
        return { error: "Invalid webhook source" };
      }
      const PAYLOAD_MAX_BYTES = 1024 * 1024;
      const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(raw, "utf8") > PAYLOAD_MAX_BYTES) {
        return { error: "Payload exceeds 1MB limit" };
      }
      const { normalizeEvent, validateSignature } = await import("./listener.js");
      const secret = process.env.WEBHOOK_SECRET;
      const sig = req.headers["x-webhook-signature"] || req.headers["x-hub-signature-256"] || "";
      if (secret && !validateSignature(req.body, sig, secret)) {
        return { error: "Invalid webhook signature" };
      }
      const event = normalizeEvent(source, req.body);
      const webhookDir = path.join(PI_DIR, "webhooks");
      fs.mkdirSync(webhookDir, { recursive: true });
      const filePath = path.join(webhookDir, `event_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`);
      fs.writeFileSync(filePath, JSON.stringify(event));
      return { ok: true, eventId: path.basename(filePath, ".json") };
    } catch (e) {
      return { error: "Failed to process webhook" };
    }
  });

  app.get("/api/webhooks/events", async () => {
    const webhookDir = path.join(PI_DIR, "webhooks");
    try {
      if (!fs.existsSync(webhookDir)) return { events: [] };
      const files = fs.readdirSync(webhookDir).sort().reverse().slice(0, 50);
      const events = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(webhookDir, f), "utf8")); }
        catch { return null; }
      }).filter(Boolean);
      return { events };
    } catch { return { events: [] }; }
  });

  // ── Service Health API ─────────────────────────────────────────────────
  app.get("/api/health/services", async () => {
    try {
      const db = getOrCreateDb(STATE_DB_PATH);
      if (!db) return { services: [] };
      const rows = db.prepare("SELECT service_name, endpoint, status, latency_ms, jitter_ms, consecutive_failures, updated_at FROM service_health ORDER BY status").all();
      return { services: rows };
    } catch { return { services: [] }; }
  });

  app.get("/api/health/endpoints", async () => {
    // Return configured endpoints that the health monitor checks
    const endpoints = [
      { name: "llm-anthropic", url: "https://api.anthropic.com/v1/health", method: "GET" },
      { name: "llm-openai", url: "https://api.openai.com/v1/health", method: "GET" },
      { name: "github-api", url: "https://api.github.com", method: "GET" },
    ];
    return { endpoints };
  });

  // ── Pipeline API ───────────────────────────────────────────────────────
  const PIPELINE_FILE = path.join(PI_DIR, "pipeline-state.json");
  function readPipeline() {
    try { return JSON.parse(fs.readFileSync(PIPELINE_FILE, "utf8")); }
    catch { return { deployments: [], current: null }; }
  }
  function writePipeline(data) {
    fs.mkdirSync(path.dirname(PIPELINE_FILE), { recursive: true });
    fs.writeFileSync(PIPELINE_FILE, JSON.stringify(data, null, 2));
  }

  app.post("/api/pipeline/deploy", async (req) => {
    try {
      const { branch, target, stableSha } = req.body || {};
      const data = readPipeline();
      const id = `deploy_${Date.now()}`;
      const deploy = {
        id, branch: branch || "main", target: target || "staging",
        stages: ["pr_created","build_started","unit_tests","staging_deploy","smoke_tests","prod_deploy"],
        currentStage: 0, stageStatus: "running",
        rollbackSha: stableSha || req.body?.rollbackSha,
        createdAt: Date.now(),
      };
      data.deployments = [deploy, ...(data.deployments || [])].slice(0, 20);
      data.current = deploy;
      writePipeline(data);
      return { deployment: deploy };
    } catch (e) { return { error: e.message }; }
  });

  app.post("/api/pipeline/advance", async (req) => {
    try {
      const { id, status } = req.body || {};
      const data = readPipeline();
      const dep = (data.deployments || []).find(d => d.id === id);
      if (!dep) return { error: "Deployment not found" };
      dep.stageStatus = status || "passed";
      dep.currentStage = (dep.currentStage || 0) + 1;
      if (dep.currentStage >= dep.stages.length) dep.stageStatus = "completed";
      writePipeline(data);
      return { deployment: dep };
    } catch (e) { return { error: e.message }; }
  });

  app.get("/api/pipeline/status", async () => readPipeline());

  app.post("/api/pipeline/rollback", async (req) => {
    try {
      const { id } = req.body || {};
      const data = readPipeline();
      const dep = (data.deployments || []).find(d => d.id === id);
      if (!dep) return { error: "Deployment not found" };
      dep.stageStatus = "rolled_back";
      dep.currentStage = 0;
      writePipeline(data);
      return { deployment: dep, message: `Rolled back to ${dep.rollbackSha || "previous stable"}` };
    } catch (e) { return { error: e.message }; }
  });

  // ── Resource / Host Metrics API ────────────────────────────────────────
  app.get("/api/system/hardware", async () => {
    try {
      const os2 = await import("node:os");
      const cpus = os2.cpus();
      const totalMem = os2.totalmem();
      let gpuInfo = [];
      try {
        const nvidiaSmi = execSync("nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits 2>/dev/null", { timeout: 3000 });
        gpuInfo = nvidiaSmi.toString().trim().split("\n").filter(Boolean).map(line => {
          const [name, total, free] = line.split(",").map(s => s.trim());
          return { name, vramTotalMb: parseInt(total) || 0, vramFreeMb: parseInt(free) || 0 };
        });
      } catch {}
      return {
        cpu: { model: cpus[0]?.model || "unknown", cores: cpus.length, speed: cpus[0]?.speed },
        memory: { totalGb: Math.round(totalMem / 1024 / 1024 / 1024 * 10) / 10 },
        gpu: gpuInfo,
      };
    } catch { return { cpu: {}, memory: {}, gpu: [] }; }
  });
  // Fit scoring
  app.get("/api/models/fit-score", async () => {
    const scores = [];
    const models = [
      { id: "gemma-4-e4b", minVram: 2, minRam: 4, tier: "light" },
      { id: "llama-3.2-3b", minVram: 3, minRam: 4, tier: "light" },
      { id: "mistral-7b", minVram: 6, minRam: 8, tier: "medium" },
      { id: "llama-3.1-8b", minVram: 8, minRam: 8, tier: "medium" },
      { id: "qwen-2.5-14b", minVram: 12, minRam: 16, tier: "heavy" },
      { id: "deepseek-r1-14b", minVram: 16, minRam: 16, tier: "heavy" },
      { id: "codestral-22b", minVram: 20, minRam: 24, tier: "xheavy" },
      { id: "llama-3.3-70b", minVram: 48, minRam: 64, tier: "server" },
    ];
    try {
      const totalMem = os.totalmem() / 1024 / 1024 / 1024;
      let gpuVram = 0;
      try {
        const out = execSync("nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null", { timeout: 2000 });
        gpuVram = out.toString().trim().split("\n").reduce((s, v) => s + (parseInt(v) || 0), 0) / 1024;
      } catch {}
      for (const m of models) {
        const ramFit = totalMem >= m.minRam ? 1 : totalMem / m.minRam;
        const vramFit = gpuVram >= m.minVram ? 1 : gpuVram > 0 ? gpuVram / m.minVram : 0.5;
        const score = Math.round((ramFit * 0.4 + vramFit * 0.6) * 100);
        scores.push({ ...m, ramAvailable: Math.round(totalMem), vramAvailable: Math.round(gpuVram), score });
      }
    } catch {}
    return { scores: scores.sort((a, b) => b.score - a.score) };
  });

  app.get("/api/system/resources", async () => {
    try {
      const fs2 = await import("node:fs");
      const os2 = await import("node:os");
      const cpus = os2.cpus().length;
      let cpuPercent = 0;
      let memInfo = { total: 0, used: 0, percent: 0 };
      try {
        if (fs2.existsSync("/proc/stat")) {
          const stat = fs2.readFileSync("/proc/stat", "utf8");
          const cpuLine = stat.split("\n").find(l => l.startsWith("cpu "));
          if (cpuLine) {
            const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
            const total = parts.reduce((a, b) => a + b, 0);
            const idle = parts[3] || 0;
            cpuPercent = total > 0 ? Math.round((1 - idle / total) * 100) : 0;
          }
        }
      } catch {}
      try {
        if (fs2.existsSync("/proc/meminfo")) {
          const text = fs2.readFileSync("/proc/meminfo", "utf8");
          const tMatch = text.match(/MemTotal:\s+(\d+)/);
          const aMatch = text.match(/MemAvailable:\s+(\d+)/);
          if (tMatch) {
            const totalKb = parseInt(tMatch[1], 10);
            const availKb = aMatch ? parseInt(aMatch[1], 10) : totalKb;
            memInfo = { total: Math.round(totalKb / 1024), used: Math.round((totalKb - availKb) / 1024), percent: Math.round((totalKb - availKb) / totalKb * 100) };
          }
        }
      } catch {}
      return { cpu: { percent: cpuPercent, cores: cpus }, memory: memInfo };
    } catch { return { cpu: { percent: 0, cores: 0 }, memory: { total: 0, used: 0, percent: 0 } }; }
  });

  app.get("/api/system/rate-limits", {
    schema: { response: { 200: { type: "object", properties: { limits: { type: "array" } } } } },
  }, async () => {
    try {
      const db = getOrCreateDb(STATE_DB_PATH);
      if (!db) return { limits: [] };
      const rows = db.prepare("SELECT * FROM rate_limits ORDER BY breached DESC, last_checked DESC").all();
      return { limits: rows };
    } catch { return { limits: [] }; }
  });

  // ── Auth / API Tokens ─────────────────────────────────────────────────
  const TOKENS_FILE = path.join(PI_DIR, "api-tokens.json");
  function loadTokens() {
    try { return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); }
    catch { return []; }
  }
  function saveTokens(tokens) {
    fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  }
  app.get("/api/auth/tokens", async () => ({ tokens: loadTokens().map(t => ({ ...t, token: t.token?.slice(0, 8) + "..." })) }));
  app.post("/api/auth/tokens", async (req) => {
    const { name, role } = req.body || {};
    if (!name) return { error: "name required" };
    const token = `pi_${crypto.randomBytes(24).toString("hex")}`;
    const entry = { id: `token_${Date.now()}`, name, token, role: role || "read", created: Date.now(), lastUsed: null };
    const tokens = loadTokens();
    tokens.push(entry);
    saveTokens(tokens);
    return { success: true, ...entry };
  });
  app.delete("/api/auth/tokens/:id", async (req) => {
    const tokens = loadTokens().filter(t => t.id !== req.params.id);
    saveTokens(tokens);
    return { success: true };
  });

  // ── Companion App API ──────────────────────────────────────────────────
  app.get("/api/companion/status", async () => ({
    version: "1.0.0", uptime: process.uptime(),
    activeSessions: 0, services: { server: "ok" },
  }));
  app.post("/api/companion/notify", async (req) => {
    const { title, message, priority } = req.body || {};
    const ntfyUrl = process.env.NTFY_URL || "https://ntfy.sh";
    const ntfyTopic = process.env.NTFY_TOPIC || "pi-custom-pack";
    try {
      await fetch(`${ntfyUrl}/${ntfyTopic}`, {
        method: "POST", body: message || title || "notification",
        headers: { "Title": title || "PI Pack", "Priority": String(priority || 3), "Tags": "bell" },
        signal: AbortSignal.timeout(3000),
      });
    } catch {}
    return { sent: true, channel: "ntfy" };
  });

  // ── Session Auth ─────────────────────────────────────────────────
  function validateSession(req) {
    try {
      const sid = req.cookies?.session_id || req.headers["x-session-id"];
      if (!sid) return null;
      const db = getOrCreateDb(path.join(PI_DIR, "session-state.db"));
      const row = db.prepare("SELECT * FROM sessions WHERE id = ? AND expires_at > ?").get(sid, Date.now());
      return row || null;
    } catch { return null; }
  }
  function requireAdmin(req) {
    const session = validateSession(req);
    return session?.role === "admin";
  }
  app.post("/api/auth/login", async (req, reply) => {
    const { password } = req.body || {};
    const masterPassword = process.env.SESSION_SECRET || "admin";
    if (password !== masterPassword) return { error: "Invalid password" };
    const sid = `sess_${crypto.randomBytes(24).toString("hex")}`;
    const now = Date.now();
    const db = getOrCreateDb(path.join(PI_DIR, "session-state.db"));
    if (db) {
      db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, role TEXT DEFAULT 'user', created_at INTEGER, expires_at INTEGER)");
      db.prepare("INSERT INTO sessions (id, role, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sid, "admin", now, now + 86400000 * 7);
    }
    reply.setCookie("session_id", sid, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 604800 });
    return { success: true, session_id: sid };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const sid = req.cookies?.session_id;
    if (sid) {
      reply.clearCookie("session_id", { path: "/" });
      try { const db = getOrCreateDb(path.join(PI_DIR, "session-state.db")); db?.prepare("DELETE FROM sessions WHERE id = ?").run(sid); } catch {}
    }
    return { success: true };
  });
  app.get("/api/auth/me", async (req) => {
    const session = validateSession(req);
    return { authenticated: !!session, role: session?.role || "none", expiresAt: session?.expires_at };
  });
  // 2FA TOTP
  app.post("/api/auth/2fa/setup", async (req) => {
    const secret = crypto.randomBytes(20).toString("base64url");
    vaultSet("TOTP_SECRET", secret);
    return { secret, uri: `otpauth://totp/PI-Custom-Pack?secret=${secret}&issuer=PI-Custom-Pack` };
  });
  app.post("/api/auth/2fa/verify", async (req) => {
    const { token } = req.body || {};
    const secret = vaultGet("TOTP_SECRET");
    if (!secret || !token) return { verified: false };
    // Simplified TOTP verification (30s window)
    const { createHmac } = await import("node:crypto");
    for (let offset = -1; offset <= 1; offset++) {
      const counter = Math.floor(Date.now() / 30000) + offset;
      const buf = Buffer.alloc(8);
      buf.writeBigInt64BE(BigInt(counter));
      const hmac = createHmac("sha1", Buffer.from(secret, "base64url")).update(buf).digest();
      const offset2 = hmac[hmac.length - 1] & 0xf;
      const code = ((hmac[offset2] & 0x7f) << 24 | (hmac[offset2 + 1] & 0xff) << 16 | (hmac[offset2 + 2] & 0xff) << 8 | (hmac[offset2 + 3] & 0xff)) % 1000000;
      if (String(code).padStart(6, "0") === token) return { verified: true };
    }
    return { verified: false };
  });

  // ── Social Media Proxy Routes ────────────────────────────────────────────

  const SOCIAL_BRIDGE = process.env.SOCIAL_BRIDGE_URL || "http://localhost:9877";
  const EMAIL_BRIDGE = process.env.EMAIL_BRIDGE_URL || "http://localhost:9878";

  async function proxyToBridge(bridgeUrl, endpoint, method, body) {
    const url = `${bridgeUrl}${endpoint}`;
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    return resp.json();
  }

  // ── Helper Functions for Social AI Agent ─────────────────────────────────

  async function getLLMCompletion(systemPrompt, userPrompt) {
    const model = resolveModel();
    const auth = getModelAuth(model);
    let text = "";
    try {
      const stream = streamSimple(model, {
        systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }]
      }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" });
      for await (const event of stream) {
        if (event.type === "text_delta") text += event.delta;
      }
    } catch (e) {
      console.error("LLM Error:", e);
    }
    return text.trim();
  }

  async function searchWebForTopic(query) {
    const tavilyKey = process.env.TAVILY_API_KEY || "";
    const serperKey = process.env.SERPER_API_KEY || "";
    if (!tavilyKey && !serperKey) return "No web search API keys configured. Using offline LLM knowledge.";
    
    try {
      if (tavilyKey) {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: tavilyKey, query, search_depth: "basic", max_results: 3 })
        });
        if (r.ok) {
          const data = await r.json();
          return data.results.map(res => `Title: ${res.title}\nURL: ${res.url}\nContent: ${res.content}\n`).join("\n---\n");
        }
      }
      if (serperKey) {
        const r = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, num: 3 })
        });
        if (r.ok) {
          const data = await r.json();
          return data.organic.map(res => `Title: ${res.title}\nURL: ${res.link}\nSnippet: ${res.snippet}\n`).join("\n---\n");
        }
      }
    } catch (e) {
      console.error("Search failed:", e);
    }
    return "Web search failed. Using offline LLM knowledge.";
  }

  async function generatePostImage(prompt) {
    const provider = vaultGet("OPENAI_API_KEY") ? "openai" : vaultGet("GEMINI_API_KEY") ? "gemini" : vaultGet("XAI_API_KEY") ? "grok" : null;
    if (!provider) return { error: "No image generation keys in vault." };
    
    try {
      if (provider === "openai") return await generateImageOpenAI(prompt, "1024x1024", "base64");
      if (provider === "gemini") return await generateImageGemini(prompt);
      if (provider === "grok") return await generateImageGrok(prompt, "base64");
    } catch (e) {
      return { error: e.message };
    }
    return { error: "Failed to generate image." };
  }

  // ── Social Bridge Status ──────────────────────────────────────────────────
  app.get("/api/social/status", {
    schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, platforms: { type: "object" }, error: { type: "string" } } } } },
  }, async () => {
    try {
      const social = await proxyToBridge(SOCIAL_BRIDGE, "/status", "GET").catch(() => ({ platforms: {} }));
      const email = await proxyToBridge(EMAIL_BRIDGE, "/status", "GET").catch(() => ({ configured: false }));
      const bskyConfigured = !!(vaultGet("BLUESKY_IDENTIFIER") && vaultGet("BLUESKY_APP_PASSWORD"));
      const discordConfigured = !!vaultGet("DISCORD_WEBHOOK_URL");
      const telegramConfigured = !!(vaultGet("TELEGRAM_BOT_TOKEN") && vaultGet("TELEGRAM_CHAT_ID"));

      return {
        ok: true,
        platforms: {
          ...social.platforms,
          email: { configured: email.configured },
          bluesky: { configured: bskyConfigured },
          discord: { configured: discordConfigured },
          telegram: { configured: telegramConfigured },
        }
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Twitter Proxy
  app.post("/api/social/twitter/login", async (req) => proxyToBridge(SOCIAL_BRIDGE, "/twitter/login", "POST", req.body));
  app.post("/api/social/twitter/post", async (req) => proxyToBridge(SOCIAL_BRIDGE, "/twitter/post", "POST", req.body));
  app.post("/api/social/twitter/reply", async (req) => proxyToBridge(SOCIAL_BRIDGE, "/twitter/reply", "POST", req.body));
  app.post("/api/social/twitter/disconnect", async () => proxyToBridge(SOCIAL_BRIDGE, "/twitter/disconnect", "POST"));

  // Reddit Proxy
  app.post("/api/social/reddit/login", async (req) => proxyToBridge(SOCIAL_BRIDGE, "/reddit/login", "POST", req.body));
  app.post("/api/social/reddit/post", async (req) => proxyToBridge(SOCIAL_BRIDGE, "/reddit/post", "POST", req.body));
  app.post("/api/social/reddit/comment", async (req) => proxyToBridge(SOCIAL_BRIDGE, "/reddit/comment", "POST", req.body));
  app.post("/api/social/reddit/disconnect", async () => proxyToBridge(SOCIAL_BRIDGE, "/reddit/disconnect", "POST"));

  // LinkedIn Proxy
  app.post("/api/social/linkedin/login", async (req) => proxyToBridge(SOCIAL_BRIDGE, "/linkedin/login", "POST", req.body));
  app.post("/api/social/linkedin/setup", async (req) => proxyToBridge(SOCIAL_BRIDGE, "/linkedin/setup", "POST", req.body));
  app.post("/api/social/linkedin/post", async (req) => proxyToBridge(SOCIAL_BRIDGE, "/linkedin/post", "POST", req.body));
  app.post("/api/social/linkedin/disconnect", async () => proxyToBridge(SOCIAL_BRIDGE, "/linkedin/disconnect", "POST"));

  // Email Proxy
  app.get("/api/social/email/status", async () => {
    try { return await proxyToBridge(EMAIL_BRIDGE, "/status", "GET"); }
    catch { return { ok: false, error: "Email bridge not running" }; }
  });
  app.post("/api/social/email/configure", async (req) => proxyToBridge(EMAIL_BRIDGE, "/configure", "POST", req.body));
  app.post("/api/social/email/send", async (req) => proxyToBridge(EMAIL_BRIDGE, "/send", "POST", req.body));
  app.get("/api/social/email/read", async (req) => {
    const folder = req.query.folder || "INBOX";
    const limit = req.query.limit || "20";
    return proxyToBridge(EMAIL_BRIDGE, `/read?folder=${folder}&limit=${limit}`, "GET");
  });
  app.post("/api/social/email/disconnect", async () => proxyToBridge(EMAIL_BRIDGE, "/disconnect", "POST"));

  // Bluesky
  app.post("/api/social/bluesky/configure", async (req) => {
    const { username, password } = req.body;
    if (!username || !password) return { ok: false, error: "username and password required" };
    vaultSet("BLUESKY_IDENTIFIER", username);
    vaultSet("BLUESKY_APP_PASSWORD", password);
    return { ok: true, message: "Bluesky configured successfully" };
  });
  app.post("/api/social/bluesky/disconnect", async () => {
    vaultDelete("BLUESKY_IDENTIFIER");
    vaultDelete("BLUESKY_APP_PASSWORD");
    return { ok: true, message: "Bluesky disconnected" };
  });
  app.post("/api/social/bluesky/post", async (req) => {
    const { text } = req.body;
    if (!text) return { ok: false, error: "text required" };
    const res = await postToBluesky(text);
    return { ok: !res.toLowerCase().includes("error"), message: res };
  });

  // Discord
  app.post("/api/social/discord/configure", async (req) => {
    const { webhookUrl } = req.body;
    if (!webhookUrl) return { ok: false, error: "webhookUrl required" };
    vaultSet("DISCORD_WEBHOOK_URL", webhookUrl);
    return { ok: true, message: "Discord configured successfully" };
  });
  app.post("/api/social/discord/disconnect", async () => {
    vaultDelete("DISCORD_WEBHOOK_URL");
    return { ok: true, message: "Discord disconnected" };
  });
  app.post("/api/social/discord/post", async (req) => {
    const { text } = req.body;
    if (!text) return { ok: false, error: "text required" };
    const res = await postToDiscord(text);
    return { ok: !res.toLowerCase().includes("error"), message: res };
  });

  // Telegram
  app.post("/api/social/telegram/configure", async (req) => {
    const { token, chatId } = req.body;
    if (!token || !chatId) return { ok: false, error: "token and chatId required" };
    vaultSet("TELEGRAM_BOT_TOKEN", token);
    vaultSet("TELEGRAM_CHAT_ID", chatId);
    return { ok: true, message: "Telegram configured successfully" };
  });
  app.post("/api/social/telegram/disconnect", async () => {
    vaultDelete("TELEGRAM_BOT_TOKEN");
    vaultDelete("TELEGRAM_CHAT_ID");
    return { ok: true, message: "Telegram disconnected" };
  });
  app.post("/api/social/telegram/post", async (req) => {
    const { text } = req.body;
    if (!text) return { ok: false, error: "text required" };
    const res = await postToTelegram(text);
    return { ok: !res.toLowerCase().includes("error"), message: res };
  });

  // Cross-platform Publish Draft
  app.post("/api/social/publish", async (req) => {
    const { text, mediaPath, platforms, drafts } = req.body;
    if (!text) return { ok: false, error: "text required" };
    
    const results = [];
    const targetPlatforms = platforms || ["twitter"];
    
    for (const platform of targetPlatforms) {
      let platformText = text;
      if (drafts && drafts[platform]) {
        platformText = drafts[platform];
        if (typeof platformText === "object") {
          platformText = platformText.body || platformText.text || JSON.stringify(platformText);
        }
      }
      
      try {
        if (platform === "twitter") {
          const res = await proxyToBridge(SOCIAL_BRIDGE, "/twitter/post", "POST", { text: platformText, mediaPath });
          results.push(`Twitter: ${res.ok ? "Success" : "Failed (" + res.error + ")"}`);
        } else if (platform === "linkedin") {
          const res = await proxyToBridge(SOCIAL_BRIDGE, "/linkedin/post", "POST", { text: platformText, mediaPath });
          results.push(`LinkedIn: ${res.ok ? "Success" : "Failed (" + res.error + ")"}`);
        } else if (platform === "reddit") {
          const title = (drafts?.reddit?.title) || "Shared via Custom-PI";
          const res = await proxyToBridge(SOCIAL_BRIDGE, "/reddit/post", "POST", { subreddit: "programming", title, body: platformText });
          results.push(`Reddit: ${res.ok ? "Success" : "Failed (" + res.error + ")"}`);
        } else if (platform === "bluesky") {
          const res = await postToBluesky(platformText);
          results.push(`Bluesky: ${res.includes("Posted") ? "Success" : "Failed (" + res + ")"}`);
        } else if (platform === "discord") {
          const res = await postToDiscord(platformText);
          results.push(`Discord: ${res.includes("Posted") ? "Success" : "Failed (" + res + ")"}`);
        } else if (platform === "telegram") {
          const res = await postToTelegram(platformText);
          results.push(`Telegram: ${res.includes("Posted") ? "Success" : "Failed (" + res + ")"}`);
        }
      } catch (err) {
        results.push(`${platform}: Failed (${err.message})`);
      }
    }
    
    return { ok: true, message: `Publish execution completed:\n${results.join("\n")}` };
  });

  // Start Social Bridge automatically if not running
  let socialBridgePid = null;
  let emailBridgePid = null;

  function killBridge(pid) {
    if (pid === null) return;
    try { process.kill(pid, "SIGTERM"); } catch {}
    socialBridgePid = socialBridgePid === pid ? null : socialBridgePid;
    emailBridgePid = emailBridgePid === pid ? null : emailBridgePid;
  }

  async function ensureSocialBridge() {
    if (socialBridgePid !== null) {
      try { process.kill(socialBridgePid, 0); return; } catch { socialBridgePid = null; }
    }
    try {
      await fetch(`${SOCIAL_BRIDGE}/status`);
      return;
    } catch {
      const bridgePath = path.join(__dirname, "social-bridge.mjs");
      if (fs.existsSync(bridgePath)) {
        const { spawn } = await import("node:child_process");
        const child = spawn(process.execPath, [bridgePath], {
          detached: true,
          stdio: "ignore",
        });
        socialBridgePid = child.pid;
        child.unref();
        console.log("  ✦ Social bridge started on port 9877");
      }
    }
  }

  async function ensureEmailBridge() {
    if (emailBridgePid !== null) {
      try { process.kill(emailBridgePid, 0); return; } catch { emailBridgePid = null; }
    }
    try {
      await fetch(`${EMAIL_BRIDGE}/status`);
      return;
    } catch {
      const bridgePath = path.join(__dirname, "email-bridge.mjs");
      if (fs.existsSync(bridgePath)) {
        const { spawn } = await import("node:child_process");
        const child = spawn(process.execPath, [bridgePath], {
          detached: true,
          stdio: "ignore",
        });
        emailBridgePid = child.pid;
        child.unref();
        console.log("  ✦ Email bridge started on port 9878");
      }
    }
  }

  ensureSocialBridge();
  ensureEmailBridge();

  // ── Social Queue (Scheduling) ─────────────────────────────────────────

  const QUEUE_DB_PATH = path.join(PI_DIR, "social-queue.db");
  let queueDb = null;
  try {
    const Database = _require("better-sqlite3");
    queueDb = new Database(QUEUE_DB_PATH);
    queueDb.pragma("journal_mode = WAL");
    queueDb.exec(`
      CREATE TABLE IF NOT EXISTS social_queue (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        media_path TEXT,
        platforms TEXT NOT NULL,
        title TEXT,
        subreddit TEXT,
        scheduled_at INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        error TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);
    console.log("  ✦ Social queue initialized");
  } catch (e) {
    console.log("  ⚠ Social queue not available (better-sqlite3?):", e.message);
  }

  function addToQueue(text, platforms, scheduledAt, opts = {}) {
    if (!queueDb) return { ok: false, error: "Queue database not available" };
    const id = crypto.randomUUID();
    const stmt = queueDb.prepare(`
      INSERT INTO social_queue (id, text, media_path, platforms, title, subreddit, scheduled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `);
    stmt.run(id, text, opts.mediaPath || null, JSON.stringify(platforms), opts.title || null, opts.subreddit || null, scheduledAt);
    return { ok: true, id };
  }

  app.post("/api/social/queue", async (req) => {
    const { text, platforms, scheduled_at, title, subreddit, media_path } = req.body || {};
    if (!text || !platforms || !scheduled_at) return { ok: false, error: "text, platforms, and scheduled_at required" };
    if (!Array.isArray(platforms) || platforms.length === 0) return { ok: false, error: "platforms must be a non-empty array" };
    return addToQueue(text, platforms, scheduled_at, { title, subreddit, mediaPath: media_path });
  });

  app.get("/api/social/queue", async () => {
    if (!queueDb) return { ok: false, error: "Queue database not available", items: [] };
    const rows = queueDb.prepare("SELECT * FROM social_queue ORDER BY scheduled_at ASC").all();
    return { ok: true, items: rows.map(r => ({ ...r, platforms: JSON.parse(r.platforms) })) };
  });

  app.delete("/api/social/queue/:id", async (req) => {
    if (!queueDb) return { ok: false, error: "Queue database not available" };
    const { id } = req.params;
    const stmt = queueDb.prepare("DELETE FROM social_queue WHERE id = ? AND status = 'pending'");
    const info = stmt.run(id);
    if (info.changes === 0) return { ok: false, error: "Post not found or already processed" };
    return { ok: true, message: "Post cancelled" };
  });

  // Background processor — check every 30s for due posts
  async function processQueue() {
    if (!queueDb) return;
    try {
      const now = Math.floor(Date.now() / 1000);
      const rows = queueDb.prepare("SELECT * FROM social_queue WHERE status = 'pending' AND scheduled_at <= ? LIMIT 5").all(now);
      for (const row of rows) {
        const id = row.id;
        queueDb.prepare("UPDATE social_queue SET status = 'processing' WHERE id = ?").run(id);
        const platforms = JSON.parse(row.platforms);
        const errors = [];
        for (const platform of platforms) {
          try {
            let result;
            if (platform === "twitter") result = await postToTwitter(row.text);
            else if (platform === "reddit") result = await postToReddit(row.subreddit || "programming", row.title || "Shared via Custom-PI", row.text);
            else if (platform === "bluesky") result = await postToBluesky(row.text);
            else if (platform === "discord") result = await postToDiscord(row.text);
            else if (platform === "telegram") result = await postToTelegram(row.text);
            else if (platform === "linkedin") {
              const bridgeUrl = process.env.SOCIAL_BRIDGE_URL || "http://localhost:9877";
              const bridgeRes = await fetch(`${bridgeUrl}/linkedin/post`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: row.text, mediaPath: row.media_path }),
              });
              const bridgeData = await bridgeRes.json();
              result = bridgeData.ok ? "Posted to LinkedIn!" : `LinkedIn error: ${bridgeData.error}`;
            } else {
              result = `Unknown platform: ${platform}`;
            }
            errors.push(`${platform}: ${result}`);
          } catch (e) {
            errors.push(`${platform}: ${e.message}`);
          }
        }
        const allOk = errors.every(e => !e.includes("error") && !e.includes("fail") && !e.includes("unreachable"));
        queueDb.prepare("UPDATE social_queue SET status = ?, error = ? WHERE id = ?")
          .run(allOk ? "published" : "failed", errors.join("; "), id);
      }
    } catch (e) {
      console.error("Queue processor error:", e.message);
    }
  }

  setInterval(processQueue, 30_000);
  setTimeout(processQueue, 5_000);

  // ── Autonomous Content Strategy ───────────────────────────────────────

  const AUTONOMOUS_INTERVAL = 6 * 60 * 60 * 1000; // every 6 hours

  const SECRET_PATTERNS = [
    /sk-[a-zA-Z0-9]{20,}/,                          // OpenAI keys
    /ghp_[a-zA-Z0-9]{36,}/,                          // GitHub PAT
    /gho_[a-zA-Z0-9]{36,}/,                          // GitHub OAuth
    /AKIA[0-9A-Z]{16}/,                              // AWS access key
    /-----BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/,
    /(password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i,
    /https?:\/\/[^\/\s]+@[^\/\s]+/,                  // URL-embedded credentials
    /\/home\/[a-z_][a-z0-9_-]*\//,                   // local paths
    /~\/\.(pi|ssh|aws|config)\//,                    // dotfile paths
  ];

  function securityScan(text) {
    const issues = [];
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        issues.push(`Matched: ${pattern}`);
      }
    }
    return issues;
  }

  async function getConnectedPlatforms() {
    const connected = [];
    try {
      const social = await proxyToBridge(SOCIAL_BRIDGE, "/status", "GET").catch(() => ({ platforms: {} }));
      if (social.platforms?.twitter?.sessionActive) connected.push("twitter");
      if (social.platforms?.reddit?.sessionActive) connected.push("reddit");
    } catch {}
    if (vaultGet("BLUESKY_IDENTIFIER") && vaultGet("BLUESKY_APP_PASSWORD")) connected.push("bluesky");
    if (vaultGet("DISCORD_WEBHOOK_URL")) connected.push("discord");
    if (vaultGet("TELEGRAM_BOT_TOKEN") && vaultGet("TELEGRAM_CHAT_ID")) connected.push("telegram");
    return connected;
  }

  const PLATFORM_WRITE_GUIDES = {
    twitter: "Twitter (max 260 chars, conversational, hashtags ok)",
    reddit: "Reddit (conversational + informative, 200-800 chars, suitable for a subreddit post)",
    bluesky: "Bluesky (concise, max 300 chars, hashtags ok)",
    discord: "Discord (casual announcement, 100-500 chars, informal)",
    telegram: "Telegram (direct update, 100-500 chars, direct tone)",
  };

  async function autonomousContentTick() {
    console.log("[autonomous] Starting content generation tick...");
    const drafts = [];

    // 0. Check which platforms are connected
    const connectedPlatforms = await getConnectedPlatforms();
    if (connectedPlatforms.length === 0) {
      console.log("[autonomous] No connected platforms, skipping content generation.");
      return;
    }
    const platformGuides = connectedPlatforms.map(p => PLATFORM_WRITE_GUIDES[p] || p).join(", ");

    // 1. Scan codebase changes
    let codeChanges = "";
    try {
      const { execSync } = await import("node:child_process");
      const since = new Date(Date.now() - 86400000).toISOString().split("T")[0];
      const log = execSync(`git log --since="${since}" --oneline --no-decorate -20`, {
        cwd: path.join(__dirname, "..", ".."),
        encoding: "utf8",
        timeout: 10000,
      }).trim();
      if (log) codeChanges = log;
    } catch {}

    // 2. Search trending topics
    let trends = "";
    try {
      const results = await webSearch("latest in AI agentic frameworks LLM tools 2026", 5);
      trends = typeof results === "string" ? results : results;
    } catch {}

    // 3. Generate post drafts via LLM
    const systemPrompt = `You are a senior developer writing social media content about AI and software engineering. 
Write engaging, expert-level posts that teach something valuable.

RULES:
- Each post must be self-contained and ready to publish
- Only write for these connected platforms: ${platformGuides}
- Do NOT write for any other platforms
- Use the cheat sheet format for maximum engagement
- Lead with a hook, teach a framework, end with insight
- No buzzwords, no fluff, no weasel words
- Never include API keys, paths, passwords, or secrets`;

    const platformNames = connectedPlatforms.join(", ");
    const userPrompt = `Generate 2 social media posts based on this context:

RECENT CODE CHANGES:
${codeChanges || "No significant changes in the last 24 hours."}

TRENDING TOPICS:
${trends || "General AI and software development trends."}

CONNECTED PLATFORMS (ONLY write for platforms from this list — do NOT use any others):
${platformNames}

Return a JSON array. Each item:
{
  "platforms": ["twitter"] or ["twitter", "reddit"] (only from the connected platforms list above),
  "text": "The post content",
  "title": "Title (only for reddit posts)",
  "subreddit": "Subreddit name (only for reddit posts)"
}`;

    let generated = [];
    try {
      const raw = await getLLMCompletion(systemPrompt, userPrompt);
      const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) generated = parsed;
    } catch (e) {
      console.error("[autonomous] LLM generation error:", e.message);
    }

    // 4. Security scan + queue as drafts
    for (const post of generated) {
      if (!post.text || !post.platforms) continue;
      const issues = securityScan(post.text);
      if (issues.length > 0) {
        console.log(`[autonomous] Draft blocked by security: ${issues.join(", ")}`);
        continue;
      }
      const id = crypto.randomUUID();
      try {
        const stmt = queueDb.prepare(`
          INSERT INTO social_queue (id, text, media_path, platforms, title, subreddit, scheduled_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
        `);
        stmt.run(id, post.text, null, JSON.stringify(post.platforms), post.title || null, post.subreddit || null, Math.floor(Date.now() / 1000));
        drafts.push(id);
      } catch {}
    }

    console.log(`[autonomous] Generated ${drafts.length} draft(s)`);
  }

  // Drafts API
  app.get("/api/social/drafts", async () => {
    if (!queueDb) return { ok: false, items: [] };
    const rows = queueDb.prepare("SELECT * FROM social_queue WHERE status = 'draft' ORDER BY created_at DESC").all();
    return { ok: true, items: rows.map(r => ({ ...r, platforms: JSON.parse(r.platforms) })) };
  });

  app.post("/api/social/drafts/:id/approve", async (req) => {
    if (!queueDb) return { ok: false, error: "Queue not available" };
    const { id } = req.params;
    const stmt = queueDb.prepare("UPDATE social_queue SET status = 'pending' WHERE id = ? AND status = 'draft'");
    const info = stmt.run(id);
    if (info.changes === 0) return { ok: false, error: "Draft not found or already approved" };
    return { ok: true, message: "Draft approved and queued for publishing" };
  });

  app.post("/api/social/drafts/:id/reject", async (req) => {
    if (!queueDb) return { ok: false, error: "Queue not available" };
    const { id } = req.params;
    queueDb.prepare("DELETE FROM social_queue WHERE id = ? AND status = 'draft'").run(id);
    return { ok: true, message: "Draft rejected" };
  });

  // Manual trigger for autonomous tick
  app.post("/api/social/autonomous/tick", async () => {
    autonomousContentTick();
    return { ok: true, message: "Autonomous content generation started. Check /api/social/drafts in a minute." };
  });

  // Autonomous tick is NOT auto-started. Use POST /api/social/autonomous/tick to trigger.
  // To enable periodic ticking, set AUTONOMOUS_ENABLED=true env var.
  if (process.env.AUTONOMOUS_ENABLED === "true") {
    setInterval(autonomousContentTick, AUTONOMOUS_INTERVAL);
  }

  // ── WebSocket ──────────────────────────────────────────────────────────

  app.get("/ws", { websocket: true }, (socket, req) => {
    // Authenticate WebSocket connections — require token from query param
    if (apiKey) {
      const wsToken = req.query?.token || "";
      if (!wsToken || wsToken.length !== apiKey.length || !crypto.timingSafeEqual(Buffer.from(wsToken), Buffer.from(apiKey))) {
        try { socket.send(JSON.stringify({ type: "error", message: "Unauthorized — provide token query parameter" })); } catch {}
        setTimeout(() => socket.close(), 500);
        return;
      }
    }
    console.log("WebSocket connected from", req.ip);

    let session;
    try { session = getOrCreateSession(); }
    catch (e) {
      try { socket.send(JSON.stringify({ type: "error", message: "Server init error" })); } catch {}
      setTimeout(() => socket.close(), 500);
      return;
    }

    // Send chat history if messages exist
    try {
      if (session.messages && session.messages.length > 0) {
        socket.send(JSON.stringify({ type: "chat_history", messages: session.messages }));
      }
    } catch {}

    // Heartbeat — close stale connections
    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) {
        try { socket.close(); } catch {}
        return;
      }
      alive = false;
      try { socket.ping(); } catch {}
    }, WS_PING_INTERVAL);

    socket.on("pong", () => { alive = true; });

    // Send swarm recovery state if there's an active or completed swarm
    if (currentSwarmState) {
      swarmSockets.add(socket);
      try {
        socket.send(JSON.stringify({
          type: "swarm_recovery",
          ...currentSwarmState,
          paused: _swarmPaused
        }));
      } catch {}
    }

    socket.on("close", () => {
      clearInterval(pingTimer);
      swarmSockets.delete(socket);
      console.log("WebSocket disconnected from", req.ip);
    });
    socket.on("error", (err) => {
      clearInterval(pingTimer);
      swarmSockets.delete(socket);
      console.error("WebSocket error:", err?.message);
    });

    socket.on("message", async (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); }
      catch { try { socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" })); } catch {} return; }

      if (data.type === "chat") {
        // Limit total attachment size
        if (data.attachments) {
          let totalSize = 0;
          for (const att of data.attachments) {
            if (att.data) totalSize += att.data.length;
            if (att.text) totalSize += att.text.length;
          }
          if (totalSize > MAX_FILE_SIZE) {
            try { socket.send(JSON.stringify({ type: "error", message: `Attachment total size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit. Please reduce file sizes.` })); } catch {}
            return;
          }
        }
        try { socket.send(JSON.stringify({ type: "session_start" })); } catch {}
        try {
          await session.handleMessage(data.message, data.cwd || process.cwd(), (event) => {
            try { socket.send(JSON.stringify(event)); } catch {}
          }, data.attachments);
        } catch (e) {
          try { socket.send(JSON.stringify({ type: "error", message: e.message })); } catch {}
        }
      }

      if (data.type === "interrupt") {
        if (session) session.interrupt();
      }

      if (data.type === "swarm_pause") {
        await withSwarmLock(async () => {
          _swarmPaused = true;
          try { socket.send(JSON.stringify({ type: "swarm_paused" })); } catch {}
        });
        return;
      }

      if (data.type === "swarm_resume") {
        await withSwarmLock(async () => {
          _swarmPaused = false;
          if (_swarmPauseResolve) { try { _swarmPauseResolve(); } catch {} _swarmPauseResolve = null; }
          try { socket.send(JSON.stringify({ type: "swarm_resumed" })); } catch {}
        });
        return;
      }

      if (data.type === "user_answer") {
        const q = pendingQuestions[data.questionId];
        if (q && q.resolve) {
          q.resolve(data.answer);
        }
      }

      if (data.type === "agent_chat") {
        const { agentId, message } = data;
        if (agentId && message) {
          getAgentChatBuffer(agentId).push({ role: "user", content: message, timestamp: Date.now() });
          bcast({ type: "agent_chat", agentId, message, fromAgent: false });

          // If no swarm is currently running for this agent, route to main chat session
          const isSwarmRunning = currentSwarmState && currentSwarmState.status === "running";
          if (!isSwarmRunning || !currentSwarmState?.agents?.find(a => a.id === agentId)) {
            try {
              socket.send(JSON.stringify({ type: "session_start" }));
              session.handleMessage(`[Message for agent '${agentId}']: ${message}`, data.cwd || process.cwd(), (event) => {
                try { socket.send(JSON.stringify(event)); } catch {}
              }, null);
            } catch (e) {
              try { socket.send(JSON.stringify({ type: "error", message: e.message })); } catch {}
            }
          }
        }
      }

      if (data.type === "memory_search") {
        try { socket.send(JSON.stringify({ type: "memory_results", results: memorySearch(data.query, data.k ?? 5) })); }
        catch (e) { try { socket.send(JSON.stringify({ type: "error", message: e.message })); } catch {} }
      }

      if (data.type === "subagent_delegate") {
        const { agentId, task } = data;
        try { await handleSubAgent(socket, agentId, task); }
        catch (e) { try { socket.send(JSON.stringify({ type: "error", message: e.message })); } catch {} }
      }

      if (data.type === "swarm_goal") {
        const { goal } = data;
        try { await handleSwarmGoal(socket, goal); }
        catch (e) { try { socket.send(JSON.stringify({ type: "swarm_error", message: "Swarm execution failed" })); } catch {} }
      }

      if (data.type === "run_dag") {
        try {
          const dagConfig = loadDagConfig();
          if (!dagConfig) {
            try { socket.send(JSON.stringify({ type: "swarm_error", message: "DAG config not found at ~/.pi/agent/dag-config.yaml" })); } catch {}
            return;
          }
          await handleDagGoal(socket, data.goal || "DAG Swarm Goal", dagConfig);
        } catch (e) { try { socket.send(JSON.stringify({ type: "swarm_error", message: "Swarm execution failed" })); } catch {} }
      }

      if (data.type === "swarm_saved_team") {
        const { goal, agents } = data;
        try {
          // Extract selected platforms from goal: "[Platforms: Twitter / X, Reddit]"
          const platformMatch = goal.match(/\[Platforms:\s*(.+?)\]/);
          const selectedPlatformNames = platformMatch ? platformMatch[1].split(/,\s*/).filter(Boolean) : [];
          const selectedPlatformKeys = selectedPlatformNames.map(n => {
            const lower = n.toLowerCase();
            if (lower.includes("twitter") || lower.includes("x")) return "twitter";
            if (lower.includes("reddit")) return "reddit";
            if (lower.includes("bluesky")) return "bluesky";
            if (lower.includes("discord")) return "discord";
            if (lower.includes("telegram")) return "telegram";
            if (lower.includes("linkedin")) return "linkedin";
            return null;
          }).filter(Boolean);

          const platformTaskSuffix = selectedPlatformNames.length > 0
            ? `Target platforms: ${selectedPlatformNames.join(", ")}. Only write drafts for these platforms — do NOT write for any others.`
            : "";

          const platformToolMap = {
            twitter: "post_to_twitter", reddit: "post_to_reddit",
            bluesky: "post_to_bluesky", discord: "post_to_discord",
            telegram: "post_to_telegram",
          };
          const allPostTools = new Set(Object.values(platformToolMap));
          const allowedPostTools = new Set(selectedPlatformKeys.map(k => platformToolMap[k]).filter(Boolean));

          const normalized = (agents || []).map(a => {
            if (typeof a === "string") {
              return { id: a, role: "sub-agent", task: `${platformTaskSuffix} Contribute to: ${goal}`, tools: ["bash", "glob", "grep", "view_file", "write", "edit", "list_dir", "web_search", "web_fetch"] };
            }
            const modified = { ...a };
            if (platformTaskSuffix) {
              if (modified.id === "writer" || modified.id === "publisher") {
                modified.task = `${platformTaskSuffix} ${modified.task}`;
              }
              if (modified.id === "publisher" && modified.tools) {
                modified.tools = modified.tools.filter(t => !allPostTools.has(t) || allowedPostTools.has(t));
                modified.tools.push("request_post_approval", "read");
              }
            }
            return modified;
          });

          // Initialize persistent state for saved team runs
          currentSwarmState = {
            goal,
            status: "running",
            agents: normalized.map(a => ({ ...a, status: "pending", logs: [] })),
            agentResults: {},
            ceoLogs: [],
            summary: null
          };
          bcast({ type: "swarm_start", goal });
          await executeSwarmCampaign(socket, goal, normalized);
        }
        catch (e) { try { socket.send(JSON.stringify({ type: "swarm_error", message: "Swarm execution failed" })); } catch {} }
      }
    });
  });

  return app;
}

// ── Server entry point ───────────────────────────────────────────────────

async function main() {
  // Import env vars into vault on startup
  try {
    await vaultImportFromEnv(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "TAVILY_API_KEY", "SERPER_API_KEY"]);
  } catch {}

  // Initialize and start MCP servers
  try {
    await startMcpServers();
  } catch (err) {
    console.error("[MCP] Failed to start MCP servers on startup:", err);
  }

  const app = await createApp();

  // Gracefully terminate child processes on exit
  const handleExit = async () => {
    console.log("\nStopping active servers...");
    if (ttsProcess) {
      try { ttsProcess.kill("SIGTERM"); } catch {}
      ttsProcess = null;
    }
    for (const sock of swarmSockets) {
      try { sock.close(); } catch {}
    }
    swarmSockets.clear();
    try { await app.close(); } catch {}
    await stopMcpServers();
    await stopLspServers();
    closeAllDbConnections();
  };
  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);

  async function syncLmStudioModels() {
    try {
      const res = await fetch("http://127.0.0.1:1234/v1/models", { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return;
      const body = await res.json();
      const live = (body.data || []).map(m => ({
        id: m.id, name: m.name || m.id,
        api: "openai-completions",
        contextWindow: 4096, maxTokens: 2048,
        input: ["text"], reasoning: false,
      }));
      if (!live.length) return;
      const modelsPath = path.join(PI_DIR, "models.json");
      let cfg = { providers: {} };
      try { cfg = JSON.parse(fs.readFileSync(modelsPath, "utf8")); } catch {}
      cfg.providers = cfg.providers || {};
      cfg.providers.lmstudio = {
        api: "openai-completions", apiKey: "not-needed",
        baseUrl: "http://127.0.0.1:1234/v1", models: live,
      };
      fs.writeFileSync(modelsPath, JSON.stringify(cfg, null, 2));
    } catch {}
  }

  // ── Session Management API ────────────────────────────────────────────────

  app.get("/api/memory/export", async (req) => {
    const format = req.query?.format || "json";
    const entries = readMemory();
    if (format === "csv") {
      const header = "id,content,type,importance,project,tags,created_at,updated_at";
      const rows = entries.map(e =>
        `"${e.id}","${(e.content || "").replace(/"/g, '""')}","${e.type || "note"}","${e.importance}","${(e.project || "").replace(/"/g, '""')}","${(e.tags || []).join(";")}","${e.createdAt}","${e.updatedAt}"`
      );
      return reply.type("text/csv").send(header + "\n" + rows.join("\n"));
    }
    return { entries };
  });

  app.post("/api/memory/import", async (req) => {
    const { entries } = req.body || {};
    if (!Array.isArray(entries) || entries.length === 0) return { error: "No entries provided", imported: 0 };
    try {
      const db = getMemoryDb();
      if (!db) return { error: "Database unavailable", imported: 0 };
      const upsert = db.prepare(`INSERT OR REPLACE INTO memory_entries (id, content, type, importance, project, tags, created_at, updated_at, access_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const vecInsert = db.prepare(`INSERT OR REPLACE INTO memory_vectors (entry_id, vector) VALUES (?, ?)`);
      const tx = db.transaction((rows) => {
        for (const e of rows) {
          const id = e.id || `mem_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
          upsert.run(id, e.content || "", e.type || "note", e.importance || 5, e.project || "", JSON.stringify(e.tags || []), e.createdAt || Date.now(), e.updatedAt || Date.now(), e.accessCount || 0);
          const vec = computeVector(e.content + " " + (e.tags || []).join(" "));
          vecInsert.run(id, JSON.stringify(vec));
        }
      });
      tx(entries);
      return { success: true, imported: entries.length };
    } catch (e) { return { error: e.message, imported: 0 }; }
  });

  const SESSIONS_DB_PATH = path.join(PI_DIR, "sessions.db");

  function getSessionsDb() {
    try {
      const db = getOrCreateDb(SESSIONS_DB_PATH);
      if (!db) return null;
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT 'New Chat',
          model_id TEXT DEFAULT '',
          preset TEXT DEFAULT '',
          token_count INTEGER DEFAULT 0,
          message_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          archived INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS session_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
      `);
      return db;
    } catch { return null; }
  }

  app.get("/api/sessions", async (req) => {
    const db = getSessionsDb();
    if (!db) return { sessions: [] };
    const includeArchived = req.query?.archived === "true";
    const rows = db.prepare(`
      SELECT id, title, model_id, preset, token_count, message_count,
             created_at AS createdAt, updated_at AS updatedAt, archived
      FROM sessions
      WHERE archived ${includeArchived ? "IN (0,1)" : "= 0"}
      ORDER BY updated_at DESC
      LIMIT 100
    `).all();
    return { sessions: rows };
  });

  app.post("/api/sessions", async (req) => {
    const db = getSessionsDb();
    if (!db) return { error: "Database unavailable" };
    const { title, modelId } = req.body || {};
    const id = `session_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, title, model_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, title || "New Chat", modelId || "", now, now);
    return { success: true, id };
  });

  app.put("/api/sessions/:id", async (req) => {
    const db = getSessionsDb();
    if (!db) return { error: "Database unavailable" };
    const { id } = req.params;
    const updates = req.body || {};
    const fields = [];
    const values = [];
    if (updates.title !== undefined) { fields.push("title = ?"); values.push(updates.title); }
    if (updates.archived !== undefined) { fields.push("archived = ?"); values.push(updates.archived ? 1 : 0); }
    if (fields.length === 0) return { error: "No fields to update" };
    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);
    db.prepare(`UPDATE sessions SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return { success: true };
  });

  app.delete("/api/sessions/:id", async (req) => {
    const db = getSessionsDb();
    if (!db) return { error: "Database unavailable" };
    const { id } = req.params;
    db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return { success: true };
  });

  app.get("/api/sessions/:id/messages", async (req) => {
    const db = getSessionsDb();
    if (!db) return { messages: [] };
    const { id } = req.params;
    const rows = db.prepare(`
      SELECT id, role, content, created_at AS createdAt
      FROM session_messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(id);
    return { messages: rows };
  });

  app.post("/api/sessions/:id/messages", async (req) => {
    const db = getSessionsDb();
    if (!db) return { error: "Database unavailable" };
    const { id } = req.params;
    const { role, content } = req.body || {};
    if (!role || !content) return { error: "role and content required" };
    const msgId = `msg_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const now = Date.now();
    db.prepare(`
      INSERT INTO session_messages (id, session_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(msgId, id, role, content, now);
    db.prepare(`
      UPDATE sessions SET message_count = message_count + 1, token_count = token_count + ?, updated_at = ?
      WHERE id = ?
    `).run(content.length, now, id);
    return { success: true, id: msgId };
  });

  // ── Multi-machine SSH ────────────────────────────────────────────────
  const SSH_CONFIG_FILE = path.join(PI_DIR, "ssh-machines.json");
  function loadSshMachines() {
    try { return JSON.parse(fs.readFileSync(SSH_CONFIG_FILE, "utf8")); } catch { return []; }
  }
  app.get("/api/ssh/machines", async () => ({ machines: loadSshMachines().map(m => ({ ...m, password: "***" })) }));
  app.post("/api/ssh/machines", async (req) => {
    const { host, port, username, password, label } = req.body || {};
    if (!host || !username) return { error: "host and username required" };
    const machines = loadSshMachines();
    machines.push({ id: `ssh_${Date.now()}`, host, port: port || 22, username, password: password || "", label: label || host, addedAt: Date.now() });
    fs.writeFileSync(SSH_CONFIG_FILE, JSON.stringify(machines, null, 2));
    return { success: true };
  });

  try {
    await syncLmStudioModels();

    // Auto-start TTS server as child process if not already running
    const ttsServerDir = path.join(__dirname, "..", "..", "tts_server");
    if (process.env.TTS_SERVER_AUTO !== "false" && fs.existsSync(ttsServerDir)) {
      try {
        const testConn = await fetch("http://127.0.0.1:8000/health");
        if (testConn.ok) {
          console.log("  ✦ TTS server already running on port 8000");
        }
      } catch {
        try {
          const pythonCmd = process.platform === "win32" ? "python" : "python3";
          ttsProcess = spawn(pythonCmd, [path.join(ttsServerDir, "main.py")], {
            cwd: ttsServerDir,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, PYTHONUNBUFFERED: "1" },
          });
          ttsProcess.stdout.on("data", (d) => process.stdout.write(`[tts] ${d}`));
          ttsProcess.stderr.on("data", (d) => process.stderr.write(`[tts] ${d}`));
          ttsProcess.on("error", (err) => console.error(`[tts] Failed to start: ${err.message}`));
          ttsProcess.on("exit", (code) => {
            if (code !== 0 && code !== null) console.error(`[tts] Exited with code ${code}`);
          });
          console.log("  ✦ Starting TTS server (Kokoro)...");
          await new Promise((r) => setTimeout(r, 8000));
        } catch (e) {
          console.error(`[tts] Could not start TTS server: ${e.message}`);
        }
      }
    }

    await app.listen({ port: PORT, host: HOST });
    const model = resolveModel();
    console.log(`\n  ✦ Custom-PI Web UI running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
    console.log(`  ✦ Active model: ${model.provider}/${model.id}`);
    console.log(`  ✦ API endpoint: ${model.baseUrl || "default"}\n`);
  } catch (e) {
    console.error(`Failed to start server: ${e.message}`);
    closeAllDbConnections();
    throw e;
  }
}

if (!process.env.VITEST) {
  main();
}
