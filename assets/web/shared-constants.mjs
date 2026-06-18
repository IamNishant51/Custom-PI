// ── Shared Path Constants ──────────────────────────────────────────────────
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PI_DIR = path.join(os.homedir(), ".pi", "agent");

export const SHARED_PATHS = {
  __dirname,
  PI_DIR,
  CLIENT_DIR: path.join(__dirname, "client", "dist"),
  MCP_CONFIG_FILE: path.join(PI_DIR, "mcp-servers.json"),
  SESSION_FILE: path.join(PI_DIR, "session-state.json"),
  CHECKPOINTS_DIR: path.join(PI_DIR, "checkpoints"),
  TEAMS_FILE: path.join(PI_DIR, "swarm-teams.json"),
  DAG_CONFIG_FILE: path.join(PI_DIR, "dag-config.yaml"),
  SWARM_STATE_FILE: path.join(PI_DIR, "swarm-state.json"),
  ASSETS_DIR: path.join(PI_DIR, "assets"),
  POSTED_CONTENT_FILE: path.join(PI_DIR, "posted-content.json"),
  VAULT_DIR: path.join(PI_DIR, ".vault"),
  KEY_FILE: path.join(PI_DIR, ".vault", "master.key"),
  VAULT_FILE: path.join(PI_DIR, ".vault", "vault.json"),
  CONTACTS_DB_PATH: path.join(PI_DIR, "contacts.db"),
  COST_DIR: path.join(PI_DIR, "costs"),
  COST_FILE: path.join(PI_DIR, "costs", "session-costs.jsonl"),
  BUDGET_FILE: path.join(PI_DIR, "costs", "budget-config.json"),
  PRODUCTS_DIR: path.join(PI_DIR, "work-products"),
  PRODUCTS_FILE: path.join(PI_DIR, "work-products", "products.jsonl"),
  MEMORY_DB_PATH: path.join(PI_DIR, "memory.db"),
  LSP_CONFIG_FILE: path.join(PI_DIR, "lsp-servers.json"),
  PLUGINS_DIR: path.join(PI_DIR, "plugins"),
  PLANS_DIR: path.join(PI_DIR, "plans"),
};

export const SERVER_CONFIG = {
  PORT: parseInt(process.env.WEB_PORT || "4321", 10),
  HOST: process.env.WEB_HOST || "127.0.0.1",
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB max upload
  WS_PING_INTERVAL: 30_000, // 30s heartbeat
};

export const ALLOWED_BASH_COMMANDS = [
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
];

export const DEFAULT_SWARM_TEAMS = [
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

export const MODEL_RATES = {
  "anthropic/claude-sonnet-4": { input: 3, output: 15 },
  "anthropic/claude-haiku-3.5": { input: 0.8, output: 4 },
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "google/gemini-2.5-flash": { input: 0.1, output: 0.4 },
  "google/gemini-2.5-pro": { input: 1.25, output: 5 },
};
