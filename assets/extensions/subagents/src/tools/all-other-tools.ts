import { Type } from "typebox";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { logger } from "../logger";
import { store as storeMemory, search as searchMemory, remove as deleteMemory, stats as memoryStats, consolidate as consolidateMemory } from "../memory-store";
import { searchSession } from "../state-db";
import { vaultSet, vaultGet, vaultDelete, vaultList, vaultHealth } from "../secret-vault";
import { setBudgetConfig, getBudgetConfig, getSessionCosts, getCostSummary } from "../cost-tracker";
import { getWorkProducts, getWorkProductSummary } from "../work-products";
import { discoverAgents } from "../agent-manager";
import { loadMcpServers, toggleMcpServer } from "../mcp-catalog";
import { createTeam, getTeams, addAgentToTeam, removeAgentFromTeam, getTeamContext } from "../team-manager";
import { SubAgentRuntime } from "../runtime/subagent";

const SOCIAL_BRIDGE_URL = process.env.SOCIAL_BRIDGE_URL || "http://localhost:9877";
const EMAIL_BRIDGE_URL = process.env.EMAIL_BRIDGE_URL || "http://localhost:9878";

async function callSocialBridge(endpoint: string, method: string, body?: any): Promise<any> {
  const url = `${SOCIAL_BRIDGE_URL}${endpoint}`;
  const opts: any = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return resp.json();
}

async function callEmailBridge(endpoint: string, method: string, body?: any): Promise<any> {
  const url = `${EMAIL_BRIDGE_URL}${endpoint}`;
  const opts: any = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return resp.json();
}

const clonedRepos = new Set<string>();

interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: any;
  execute: (...args: any[]) => any;
}

export const tools: ToolDefinition[] = [
  {
    name: "memory_store",
    label: "Store Memory",
    description: "Store a fact, decision, preference, pattern, or skill into persistent memory for future recall. Use this when you learn something important about the project, the user's preferences, architecture decisions, recurring patterns, or when you've learned a new approach/skill.",
    parameters: Type.Object({
      content: Type.String({ description: "The fact, decision, or pattern to remember" }),
      type: Type.String({ description: "Type of memory: 'fact' (general knowledge), 'decision' (architectural choice), 'preference' (user preference), 'pattern' (recurring pattern), 'skill' (learned approach/technique)" }),
      importance: Type.Optional(Type.Number({ description: "Importance 1-10 (default: 5). Higher = more likely to be recalled." })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags for categorization" })),
      project: Type.Optional(Type.String({ description: "Project scope. Auto-detected from working directory if omitted." })),
      ttlDays: Type.Optional(Type.Number({ description: "Days until auto-expiry. Defaults to 90." })),
    }),
    async execute(id, params, _signal, _update, context) {
      try {
        for (const pattern of SubAgentRuntime.SECRET_PATTERNS) {
          if (pattern.test(params.content)) {
            return { content: [{ type: "text", text: `Warning: The content appears to contain API keys, tokens, or secrets. Memory storage blocked to prevent credential leakage. Use the \`vault_set\` tool to store secrets securely.` }], isError: true };
          }
        }
        const importance = Math.min(10, Math.max(1, Math.floor(params.importance ?? 5)));
        const project = params.project || path.basename(context.cwd || process.cwd()) || "global";
        const tags = params.tags || [];
        const type = params.type || "fact";
        const validTypes = ["fact", "decision", "preference", "pattern", "skill"];
        if (!validTypes.includes(type)) {
          return { content: [{ type: "text", text: `Invalid type '${type}'. Must be one of: ${validTypes.join(", ")}` }], isError: true };
        }
        const id_ = await storeMemory(params.content, type as any, importance, project, tags, params.ttlDays);
        return { content: [{ type: "text", text: `Stored memory [${id_}] (${type}, importance: ${importance}, project: ${project})` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to store memory: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "memory_search",
    label: "Search Memory",
    description: "Semantically search persistent memory for facts, decisions, preferences, patterns, or skills related to a query.",
    parameters: Type.Object({
      query: Type.String({ description: "Natural language query to search for in memory" }),
      k: Type.Optional(Type.Number({ description: "Number of results to return (default: 5)" })),
      project: Type.Optional(Type.String({ description: "Optional project filter. Defaults to the current project." })),
    }),
    async execute(id, params, _signal, _update, context) {
      try {
        const project = params.project || path.basename(context.cwd || process.cwd()) || undefined;
        const results = await searchMemory(params.query, params.k ?? 5, project);
        if (!results.length) {
          return { content: [{ type: "text", text: "No relevant memories found." }] };
        }
        const lines = results.map((r: any, i: any) => {
          const icon =
            r.entry.type === "fact" ? "" :
            r.entry.type === "decision" ? "\u25b6" :
            r.entry.type === "preference" ? "\u2726" : "";
          return `${i + 1}. ${icon}[${r.entry.type}] ${r.entry.content} (relevance: ${(r.score * 100).toFixed(0)}%, importance: ${r.entry.importance}, project: ${r.entry.project})`;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Memory search failed: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "memory_delete",
    label: "Delete Memory",
    description: "Delete a persistent memory entry by its ID.",
    parameters: Type.Object({
      id: Type.String({ description: "The unique ID of the memory entry to delete. Use memory_search to find IDs." }),
    }),
    async execute(id, params, _signal, _update, _context) {
      try {
        const ok = await deleteMemory(params.id);
        if (ok) {
          return { content: [{ type: "text", text: `Deleted memory entry: ${params.id}` }] };
        }
        return { content: [{ type: "text", text: `Memory entry '${params.id}' not found.` }], isError: true };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to delete memory: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "memory_stats",
    label: "Memory Statistics",
    description: "Get statistics about the persistent memory system: total entries, breakdown by type and project, and episode count.",
    parameters: Type.Object({}),
    async execute(id, params, _signal, _update, _context) {
      try {
        const s = memoryStats();
        const lines = [
          `Total entries: ${s.totalEntries}`,
          `By type: ${Object.entries(s.byType).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"}`,
          `By project: ${Object.entries(s.byProject).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"}`,
          `Avg importance: ${s.averageImportance}`,
          `Episodes logged: ${s.totalEpisodes}`,
          `Deprecated: ${s.deprecatedCount}`,
          `Retrieval success: ${(s.avgRetrievalSuccess * 100).toFixed(0)}%`,
          `Oldest entry: ${new Date(s.oldestEntry).toLocaleDateString()}`,
          `Newest entry: ${new Date(s.newestEntry).toLocaleDateString()}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to get memory stats: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "memory_consolidate",
    label: "Consolidate Memory",
    description: "Run memory consolidation: merge similar entries, prune expired ones, and recalculate importance scores. Run periodically to keep the memory system healthy.",
    parameters: Type.Object({}),
    async execute(id, params, _signal, _update, _context) {
      try {
        const result = await consolidateMemory();
        return { content: [{ type: "text", text: `Consolidation complete: ${result.merged} merged, ${result.pruned} pruned, ${result.refreshed} refreshed` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Consolidation failed: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "fetch_github_repo",
    label: "Fetch GitHub Repository",
    description: "Clone a GitHub repository locally to explore its full codebase. Use this when the user shares a GitHub repo link or asks you to analyze code from GitHub. After cloning, you can use read, grep, ls, and bash tools to explore the code in the returned path.",
    parameters: Type.Object({
      url: Type.String({ description: "Full GitHub repository URL (e.g. https://github.com/owner/repo or https://github.com/owner/repo/tree/branch)" }),
      maxDepth: Type.Optional(Type.Number({ description: "Max directory depth for the file tree (default: 3, max: 6)" })),
    }),
    async execute(id, params, _signal, _update, _context) {
      try {
        let url = params.url.replace(/\.git$/, "").trim();
        let branch = "";

        const treeMatch = url.match(/^(https?:\/\/github\.com\/[^\/]+\/[^\/]+)\/tree\/(.+)$/);
        if (treeMatch) {
          url = treeMatch[1];
          branch = treeMatch[2];
        }

        const match = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\/|$)/);
        if (!match) {
          return { content: [{ type: "text", text: "Invalid GitHub URL. Expected format: https://github.com/owner/repo" }], isError: true };
        }

        const owner = match[1];
        const repo = match[2];
        const cloneDir = path.join("/tmp/opencode/github", `${owner}-${repo}-${Date.now()}`);
        const cloneUrl = branch ? `https://github.com/${owner}/${repo}.git` : url + ".git";

        _context.ui.notify(`Cloning ${owner}/${repo}...`, "info");

        fs.mkdirSync(cloneDir, { recursive: true });

        const cloneArgs = ["clone", "--depth", "1", "--single-branch"];
        if (branch) cloneArgs.push("--branch", branch);
        cloneArgs.push(cloneUrl, cloneDir);

        execFileSync("git", cloneArgs, {
          stdio: "pipe",
          timeout: 120_000,
        });

        clonedRepos.add(cloneDir);

        const maxDepth = Math.min(6, Math.max(1, params.maxDepth ?? 3));

        const treeLines: string[] = [];
        function walkTree(dir: string, depth: number) {
          if (depth > maxDepth) return;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
              if (entry.name.startsWith(".")) continue;
              if (entry.name === "node_modules") continue;
              const indent = "  ".repeat(depth);
              const fullPath = path.join(dir, entry.name);
              const relPath = path.relative(cloneDir, fullPath);
              if (entry.isDirectory()) {
                treeLines.push(`${indent}\ud83d\udcc1 ${entry.name}/`);
                walkTree(fullPath, depth + 1);
              } else {
                const stats = fs.statSync(fullPath);
                const size = stats.size > 1024 ? `${(stats.size / 1024).toFixed(1)}KB` : `${stats.size}B`;
                treeLines.push(`${indent}\ud83d\udcc4 ${entry.name} (${size})`);
              }
            }
          } catch (err: any) { logger.warn(`MCP config write failed: ${err.message}`); }
        }

        const entries = fs.readdirSync(cloneDir, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.name.startsWith(".")) continue;
          if (entry.name === "node_modules") continue;
          const fullPath = path.join(cloneDir, entry.name);
          const stats = fs.statSync(fullPath);
          if (entry.isDirectory()) {
            treeLines.push(`\ud83d\udcc1 ${entry.name}/`);
            walkTree(fullPath, 1);
          } else {
            const size = stats.size > 1024 ? `${(stats.size / 1024).toFixed(1)}KB` : `${stats.size}B`;
            treeLines.push(`\ud83d\udcc4 ${entry.name} (${size})`);
          }
        }

        const totalFiles = treeLines.filter((l: string) => l.includes("\ud83d\udcc4")).length;
        const totalDirs = treeLines.filter((l: string) => l.includes("\ud83d\udcc1")).length;
        const treeStr = treeLines.join("\n").slice(0, 8000);

        return {
          content: [{
            type: "text",
            text: `\u2705 Cloned ${owner}/${repo}${branch ? ` (branch: ${branch})` : ""}\nPath: ${cloneDir}\nFiles: ${totalFiles}, Dirs: ${totalDirs}\n\n\ud83d\udcc2 Repository Structure:\n${treeStr}\n\nUse read, grep, ls, or bash tools on files inside ${cloneDir} to explore the codebase.`
          }]
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to fetch repository: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "vault_set",
    label: "Vault Set Secret",
    description: "Store a secret value (API key, token, password) into the encrypted vault. The vault is encrypted with AES-256-GCM and stored at ~/.pi/agent/.vault/.",
    parameters: Type.Object({
      key: Type.String({ description: "Name of the secret (e.g., 'MY_API_KEY')" }),
      value: Type.String({ description: "The secret value to encrypt and store" }),
    }),
    async execute(_id, params, _signal, _update, _context) {
      try {
        await vaultSet(params.key, params.value);
        return { content: [{ type: "text", text: `Secret '${params.key}' stored securely in vault.` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to store secret: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "vault_get",
    label: "Vault Get Secret",
    description: "Retrieve a secret value from the encrypted vault by its key name.",
    parameters: Type.Object({
      key: Type.String({ description: "Name of the secret to retrieve" }),
    }),
    async execute(_id, params, _signal, _update, _context) {
      try {
        const value = await vaultGet(params.key);
        if (value === null) {
          return { content: [{ type: "text", text: `Secret '${params.key}' not found in vault.` }], isError: true };
        }
        return { content: [{ type: "text", text: value }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to retrieve secret: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "vault_delete",
    label: "Vault Delete Secret",
    description: "Delete a secret from the encrypted vault by its key name.",
    parameters: Type.Object({
      key: Type.String({ description: "Name of the secret to delete" }),
    }),
    async execute(_id, params, _signal, _update, _context) {
      try {
        const ok = await vaultDelete(params.key);
        if (ok) {
          return { content: [{ type: "text", text: `Secret '${params.key}' deleted from vault.` }] };
        }
        return { content: [{ type: "text", text: `Secret '${params.key}' not found.` }], isError: true };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to delete secret: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "vault_list",
    label: "Vault List Secrets",
    description: "List all stored secret key names in the encrypted vault (values are not shown).",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, _context) {
      try {
        const keys = await vaultList();
        if (keys.length === 0) {
          return { content: [{ type: "text", text: "Vault is empty. Use vault_set to store secrets." }] };
        }
        return { content: [{ type: "text", text: `Stored secrets:\n${keys.map((k: any) => `  - ${k}`).join("\n")}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to list vault: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "vault_health",
    label: "Vault Health",
    description: "Check the encrypted vault's health and status.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, _context) {
      try {
        const health = await vaultHealth();
        return { content: [{ type: "text", text: `Vault status: ${health.ok ? "healthy" : "unhealthy"}\n${health.message}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Vault check failed: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "budget_config",
    label: "Budget Configuration",
    description: "Get or update the token/cost budget configuration. Set limits to prevent runaway spending. Call without arguments to see current config.",
    parameters: Type.Object({
      maxSessionTokens: Type.Optional(Type.Number({ description: "Max tokens per session" })),
      maxDailyTokens: Type.Optional(Type.Number({ description: "Max tokens per day" })),
      maxSessionCostUsd: Type.Optional(Type.Number({ description: "Max USD cost per session" })),
      maxDailyCostUsd: Type.Optional(Type.Number({ description: "Max USD cost per day" })),
      warningThreshold: Type.Optional(Type.Number({ description: "Warning threshold 0-1 (e.g., 0.8 = warn at 80%)" })),
    }),
    async execute(_id, params, _signal, _update, _context) {
      try {
        if (params.maxSessionTokens !== undefined || params.maxDailyTokens !== undefined ||
            params.maxSessionCostUsd !== undefined || params.maxDailyCostUsd !== undefined ||
            params.warningThreshold !== undefined) {
          setBudgetConfig({
            ...(params.maxSessionTokens !== undefined && { maxSessionTokens: params.maxSessionTokens }),
            ...(params.maxDailyTokens !== undefined && { maxDailyTokens: params.maxDailyTokens }),
            ...(params.maxSessionCostUsd !== undefined && { maxSessionCostUsd: params.maxSessionCostUsd }),
            ...(params.maxDailyCostUsd !== undefined && { maxDailyCostUsd: params.maxDailyCostUsd }),
            ...(params.warningThreshold !== undefined && { warningThreshold: params.warningThreshold }),
          });
        }
        const budget = getBudgetConfig();
        const lines = [
          `Budget Configuration:`,
          `  Max session tokens: ${budget.maxSessionTokens.toLocaleString()}`,
          `  Max daily tokens: ${budget.maxDailyTokens.toLocaleString()}`,
          `  Max session cost: $${budget.maxSessionCostUsd?.toFixed(2) || "unlimited"}`,
          `  Max daily cost: $${budget.maxDailyCostUsd?.toFixed(2) || "unlimited"}`,
          `  Warning threshold: ${((budget.warningThreshold || 0.8) * 100).toFixed(0)}%`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Budget config failed: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "budget_stats",
    label: "Budget Statistics",
    description: "Get token and cost statistics across all sessions. Shows total tokens used, total cost in USD, per-session breakdown, and budget status.",
    parameters: Type.Object({
      sessionId: Type.Optional(Type.String({ description: "Optional session ID to filter by" })),
    }),
    async execute(_id, params, _signal, _update, _context) {
      try {
        if (params.sessionId) {
          const costs = getSessionCosts(params.sessionId);
          if (costs.length === 0) {
            return { content: [{ type: "text", text: `No costs recorded for session '${params.sessionId}'.` }] };
          }
          const totalTokens = costs.reduce((s: any, c: any) => s + c.totalTokens, 0);
          const totalCost = costs.reduce((s: any, c: any) => s + c.costUsd, 0);
          return { content: [{ type: "text", text: `Session '${params.sessionId}': ${costs.length} API calls, ${totalTokens.toLocaleString()} tokens, $${totalCost.toFixed(6)}` }] };
        }
        const summary = getCostSummary();
        const lines = [
          `Cost Summary:`,
          `  Total sessions: ${summary.totalSessions}`,
          `  Total tokens: ${summary.totalTokens.toLocaleString()}`,
          `  Total cost: $${summary.totalCostUsd.toFixed(6)}`,
          `  Today tokens: ${summary.dailyTokens.toLocaleString()}`,
          `  Today cost: $${summary.dailyCostUsd.toFixed(6)}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Budget stats failed: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "work_products",
    label: "Work Products",
    description: "List work products (files created, modified, read, or deleted) from the current or a specific session. Shows file paths, actions, agents, and timestamps.",
    parameters: Type.Object({
      sessionId: Type.Optional(Type.String({ description: "Optional session ID to filter by" })),
      summary: Type.Optional(Type.Boolean({ description: "Set to true for a concise summary instead of full list" })),
    }),
    async execute(_id, params, _signal, _update, _context) {
      try {
        if (params.summary) {
          const summary = getWorkProductSummary(params.sessionId);
          return { content: [{ type: "text", text: summary }] };
        }
        const products = getWorkProducts(params.sessionId);
        if (products.length === 0) {
          return { content: [{ type: "text", text: "No work products recorded." }] };
        }
        const lines = products.map((p: any, i: any) =>
          `${i + 1}. [${p.action}] ${p.filePath} — by ${p.agent} (${new Date(p.timestamp).toLocaleString()})`
        );
        return { content: [{ type: "text", text: `Work Products (${products.length}):\n${lines.join("\n")}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to get work products: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "search_current_session",
    label: "Search Current Session",
    description: "Search the current conversation session for past messages matching a query. Use this when you need to recall what was discussed earlier in the conversation, what decisions were made, what code was shown, or what the user requested previously. This prevents forgetting in long sessions.",
    parameters: Type.Object({
      query: Type.String({ description: "Search terms to find in the current session messages" }),
      k: Type.Optional(Type.Number({ description: "Number of results to return (default: 10)" })),
    }),
    async execute(id, params, _signal, _update, context) {
      try {
        const query = params.query.trim();
        if (!query || query.split(/\s+/).filter((t: string) => t.length > 2).length === 0) {
          return { content: [{ type: "text", text: "Please provide a more specific query (words > 2 chars)." }], isError: true };
        }

        const sessionFile = context.sessionManager?.getSessionFile();
        const sessionId = sessionFile ? path.basename(sessionFile, ".jsonl") : null;
        const k = Math.min(50, Math.max(1, params.k ?? 10));
        const results = searchSession(query, sessionId || undefined, Math.max(k, 100));

        if (!results.length) {
          return { content: [{ type: "text", text: `No messages in the current session matched "${params.query}". Try different keywords or check the memory_search tool for persistent memories.` }] };
        }

        const iconForRole: Record<string, string> = { user: "\u25c6", assistant: "\u25a3", tool: "\u25d8" };
        const lines = results.slice(0, k).map((m: any, i: any) => {
          const timeStr = m.createdAt ? new Date(m.createdAt).toLocaleTimeString() : "";
          const roleLabel = (iconForRole[m.role] || "") + ` ${m.role.toUpperCase()}`;
          const snippet = m.snippet || m.content.slice(0, 300);
          const preview = snippet.length > 300 ? snippet.slice(0, 300) + "..." : snippet;
          return `${i + 1}. ${roleLabel} (${timeStr}): ${preview}`;
        });

        const summary = `Found ${results.length} relevant message(s) in the current session:\n\n${lines.join("\n\n")}`;
        return { content: [{ type: "text", text: summary }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Session search failed: ${e.message}` }], isError: true };
      }
    },
  },
  {
    name: "list_agents",
    label: "List Available Agents",
    description: "Discover and list all available AI agents installed on this system (Claude Code, Codex, OpenCode, Hermes, etc.). Shows which are available and their capabilities.",
    parameters: Type.Object({}),
    async execute() {
      const agents = discoverAgents();
      const available = agents.filter((a: any) => a.available);
      const unavailable = agents.filter((a: any) => !a.available);
      let text = `## Available Agents (${available.length}/${agents.length})\n\n`;
      if (available.length) {
        for (const a of available) {
          text += `- **${a.name}** (${a.backend || "unknown"}) — ${a.modes.join(", ")}\n`;
        }
      } else {
        text += "No agents detected. Install one: claude, codex, opencode, hermes, etc.\n";
      }
      if (unavailable.length) {
        text += `\n### Not Installed (${unavailable.length})\n`;
        for (const a of unavailable) {
          text += `- ${a.name} — install with \`npm install -g ${a.id}\` or platform package manager\n`;
        }
      }
      return { content: [{ type: "text", text }] };
    },
  },
  {
    name: "agent_info",
    label: "Agent Info",
    description: "Get detailed information about a specific AI agent installed on this system.",
    parameters: Type.Object({
      agentId: Type.String({ description: "The agent ID to look up (e.g. 'claude-code', 'codex', 'opencode')" }),
    }),
    async execute(id, params) {
      const agents = discoverAgents();
      const agent = agents.find((a: any) => a.id === params.agentId);
      if (!agent) {
        const found = agents.find((a: any) => a.name.toLowerCase() === params.agentId.toLowerCase());
        if (!found) return { content: [{ type: "text", text: `Agent '${params.agentId}' not found. Use list_agents to see available agents.` }], isError: true };
        return { content: [{ type: "text", text: `**${found.name}**\n- ID: \`${found.id}\`\n- Backend: ${found.backend}\n- Available: ${found.available}\n- Team Support: ${found.supportsTeam}\n- Modes: ${found.modes.join(", ")}\n- Agent Type: ${found.agentType}\n- Source: ${found.agentSource}` }] };
      }
      return { content: [{ type: "text", text: `**${agent.name}**\n- ID: \`${agent.id}\`\n- Backend: ${agent.backend}\n- Available: ${agent.available}\n- Team Support: ${agent.supportsTeam}\n- Modes: ${agent.modes.join(", ")}\n- Agent Type: ${agent.agentType}\n- Source: ${agent.agentSource}` }] };
    },
  },
  {
    name: "mcp_list",
    label: "List MCP Servers",
    description: "List all configured MCP (Model Context Protocol) servers and their status.",
    parameters: Type.Object({}),
    async execute() {
      const servers = loadMcpServers();
      const enabled = servers.filter((s: any) => s.enabled);
      const disabled = servers.filter((s: any) => !s.enabled);
      let text = `## MCP Servers (${enabled.length}/${servers.length} enabled)\n\n`;
      if (enabled.length) {
        text += "### Enabled\n";
        for (const s of enabled) {
          text += `- **${s.name}** (\`${s.id}\`) — ${s.transport}${s.command ? `: \`${s.command}\`` : ""}\n`;
        }
        text += "\n";
      }
      if (disabled.length) {
        text += "### Disabled\n";
        for (const s of disabled) {
          text += `- ${s.name} (\`${s.id}\`) — ${s.transport}\n`;
        }
      }
      return { content: [{ type: "text", text }] };
    },
  },
  {
    name: "mcp_toggle",
    label: "Toggle MCP Server",
    description: "Enable or disable a configured MCP server.",
    parameters: Type.Object({
      serverId: Type.String({ description: "The server ID to toggle (e.g. 'builtin-fs', 'builtin-sequential-thinking')" }),
      enabled: Type.Boolean({ description: "true to enable, false to disable" }),
    }),
    async execute(id, params) {
      const servers = loadMcpServers();
      const server = servers.find((s: any) => s.id === params.serverId);
      if (!server) {
        return { content: [{ type: "text", text: `MCP server '${params.serverId}' not found.` }], isError: true };
      }
      toggleMcpServer(params.serverId, params.enabled);
      return { content: [{ type: "text", text: `MCP server **${server.name}** ${params.enabled ? "enabled" : "disabled"}.` }] };
    },
  },
  {
    name: "team_create",
    label: "Create Team",
    description: "Create a new team of AI agents working together on a shared workspace.",
    parameters: Type.Object({
      name: Type.String({ description: "A name for the team (e.g. 'Frontend Sprint')" }),
      workspace: Type.String({ description: "Absolute path to the shared workspace directory" }),
      leaderAgentId: Type.String({ description: "The agent ID to use as team leader (e.g. 'claude-code', 'codex')" }),
    }),
    async execute(id, params) {
      const team = createTeam(params.name, params.workspace, params.leaderAgentId);
      return { content: [{ type: "text", text: `Team **${team.name}** created.\n- ID: \`${team.id}\`\n- Leader: ${team.agents.find((a: any) => a.role === "leader")?.agentName}\n- Workspace: ${team.workspace}\n\nUse \`team_add_agent\` to add more agents.` }] };
    },
  },
  {
    name: "team_list",
    label: "List Teams",
    description: "List all created teams and their current status.",
    parameters: Type.Object({}),
    async execute() {
      const teams = getTeams();
      if (!teams.length) return { content: [{ type: "text", text: "No teams created yet. Use `team_create` to create one." }] };
      let text = "## Teams\n\n";
      for (const t of teams) {
        const leader = t.agents.find((a: any) => a.role === "leader");
        const teammates = t.agents.filter((a: any) => a.role === "teammate");
        text += `### ${t.name}\n`;
        text += `- ID: \`${t.id}\`\n`;
        text += `- Leader: ${leader?.agentName || "none"}\n`;
        text += `- Teammates: ${teammates.length}\n`;
        text += `- Workspace: ${t.workspace}\n`;
        text += `- Agents: ${t.agents.map((a: any) => `${a.agentName} (${a.status})`).join(", ")}\n\n`;
      }
      return { content: [{ type: "text", text }] };
    },
  },
  {
    name: "team_add_agent",
    label: "Add Agent to Team",
    description: "Add an AI agent to an existing team.",
    parameters: Type.Object({
      teamId: Type.String({ description: "The team ID to add the agent to" }),
      agentId: Type.String({ description: "The agent ID to add (e.g. 'codex', 'opencode')" }),
    }),
    async execute(id, params) {
      const result = addAgentToTeam(params.teamId, params.agentId);
      if (!result) return { content: [{ type: "text", text: `Failed to add agent to team. Check team ID and agent availability.` }], isError: true };
      return { content: [{ type: "text", text: `Agent **${result.agentName}** added to team as ${result.role} (slot: \`${result.slotId}\`).` }] };
    },
  },
  {
    name: "team_remove_agent",
    label: "Remove Agent from Team",
    description: "Remove an agent from a team.",
    parameters: Type.Object({
      teamId: Type.String({ description: "The team ID" }),
      slotId: Type.String({ description: "The slot ID of the agent to remove (use team_list to find slot IDs)" }),
    }),
    async execute(id, params) {
      const ok = removeAgentFromTeam(params.teamId, params.slotId);
      if (!ok) return { content: [{ type: "text", text: `Failed to remove agent. Cannot remove the leader or agent not found.` }], isError: true };
      return { content: [{ type: "text", text: `Agent removed from team.` }] };
    },
  },
  {
    name: "team_context",
    label: "Team Context",
    description: "Get the current context summary for a team, including workspace, members, and MCP tools.",
    parameters: Type.Object({
      teamId: Type.String({ description: "The team ID" }),
    }),
    async execute(id, params) {
      const context = getTeamContext(params.teamId);
      if (!context) return { content: [{ type: "text", text: `Team '${params.teamId}' not found.` }], isError: true };
      return { content: [{ type: "text", text: context }] };
    },
  },
  {
    name: "post_to_twitter",
    label: "Post to Twitter",
    description: "Post a tweet to Twitter/X. IMPORTANT: Generate a proper tweet FIRST (engaging, informative, with hashtags), then pass the generated text. Do NOT pass raw topic/prompt — craft the tweet yourself. Max 280 chars.",
    parameters: Type.Object({
      text: Type.String({ description: "The FINAL tweet text to post (must be a ready-to-post tweet, not a topic/prompt). Max 280 chars. Include hashtags." }),
    }),
    async execute(id, params) {
      try {
        const result = await callSocialBridge("/twitter/post", "POST", { text: params.text });
        return { content: [{ type: "text", text: result.ok ? `\u2705 ${result.message}` : `\u274c ${result.error}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `\u274c Social bridge not running. Start it with: node assets/web/social-bridge.mjs` }] };
      }
    },
  },
  {
    name: "reply_to_tweet",
    label: "Reply to Tweet",
    description: "Reply to a specific tweet on Twitter/X.",
    parameters: Type.Object({
      tweetUrl: Type.String({ description: "The URL of the tweet to reply to" }),
      text: Type.String({ description: "The reply text" }),
    }),
    async execute(id, params) {
      try {
        const result = await callSocialBridge("/twitter/reply", "POST", { url: params.tweetUrl, text: params.text });
        return { content: [{ type: "text", text: result.ok ? `\u2705 ${result.message}` : `\u274c ${result.error}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `\u274c Social bridge not running.` }] };
      }
    },
  },
  {
    name: "login_twitter",
    label: "Login to Twitter",
    description: "Connect a Twitter/X account using username and password. One-time setup — session persists.",
    parameters: Type.Object({
      username: Type.String({ description: "Twitter username or email" }),
      password: Type.String({ description: "Twitter password" }),
    }),
    async execute(id, params) {
      try {
        const result = await callSocialBridge("/twitter/login", "POST", { username: params.username, password: params.password });
        return { content: [{ type: "text", text: result.ok ? `\u2705 ${result.message}` : `\u274c ${result.error}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `\u274c Social bridge not running.` }] };
      }
    },
  },
  {
    name: "post_to_reddit",
    label: "Post to Reddit",
    description: "Submit a post to a subreddit. IMPORTANT: Generate proper title and body FIRST (informative, well-structured). Do NOT pass raw topics — craft the content yourself.",
    parameters: Type.Object({
      subreddit: Type.String({ description: "Subreddit name (without r/)" }),
      title: Type.String({ description: "Post title (ready to post, not a topic/prompt)" }),
      body: Type.Optional(Type.String({ description: "Post body text (for text posts). Generate a well-structured body." })),
      url: Type.Optional(Type.String({ description: "URL to share (for link posts)" })),
    }),
    async execute(id, params) {
      try {
        const result = await callSocialBridge("/reddit/post", "POST", {
          subreddit: params.subreddit,
          title: params.title,
          body: params.body || "",
          url: params.url || "",
        });
        return { content: [{ type: "text", text: result.ok ? `\u2705 ${result.message}` : `\u274c ${result.error}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `\u274c Social bridge not running.` }] };
      }
    },
  },
  {
    name: "comment_on_reddit",
    label: "Comment on Reddit",
    description: "Post a comment on a Reddit post or thread.",
    parameters: Type.Object({
      postUrl: Type.String({ description: "Full URL of the Reddit post to comment on" }),
      text: Type.String({ description: "Comment text" }),
    }),
    async execute(id, params) {
      try {
        const result = await callSocialBridge("/reddit/comment", "POST", { url: params.postUrl, text: params.text });
        return { content: [{ type: "text", text: result.ok ? `\u2705 ${result.message}` : `\u274c ${result.error}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `\u274c Social bridge not running.` }] };
      }
    },
  },
  {
    name: "login_reddit",
    label: "Login to Reddit",
    description: "Connect a Reddit account using username and password. One-time setup — session persists.",
    parameters: Type.Object({
      username: Type.String({ description: "Reddit username" }),
      password: Type.String({ description: "Reddit password" }),
    }),
    async execute(id, params) {
      try {
        const result = await callSocialBridge("/reddit/login", "POST", { username: params.username, password: params.password });
        return { content: [{ type: "text", text: result.ok ? `\u2705 ${result.message}` : `\u274c ${result.error}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `\u274c Social bridge not running.` }] };
      }
    },
  },
  {
    name: "send_email",
    label: "Send Email",
    description: "Send an email via Gmail. Requires Gmail App Password setup.",
    parameters: Type.Object({
      to: Type.String({ description: "Recipient email address" }),
      subject: Type.String({ description: "Email subject" }),
      body: Type.String({ description: "Email body text or HTML" }),
      isHtml: Type.Optional(Type.Boolean({ description: "Set true if body is HTML" })),
    }),
    async execute(id, params) {
      try {
        const result = await callEmailBridge("/send", "POST", {
          to: params.to,
          subject: params.subject,
          body: params.body,
          isHtml: params.isHtml || false,
        });
        return { content: [{ type: "text", text: result.ok ? `\u2705 ${result.message}` : `\u274c ${result.error}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `\u274c Email bridge not running. Start it with: node assets/web/email-bridge.mjs` }] };
      }
    },
  },
  {
    name: "read_email",
    label: "Read Email",
    description: "Read recent emails from your inbox.",
    parameters: Type.Object({
      folder: Type.Optional(Type.String({ description: "IMAP folder (default: INBOX)" })),
      limit: Type.Optional(Type.Number({ description: "Number of emails to read (default: 20)" })),
    }),
    async execute(id, params) {
      try {
        const folder = params.folder || "INBOX";
        const limit = params.limit || 20;
        const result = await callEmailBridge(`/read?folder=${folder}&limit=${limit}`, "GET");
        if (!result.ok) return { content: [{ type: "text", text: `\u274c ${result.error}` }] };
        const lines = (result.emails || []).map((e: any) => `\u2022 **${e.from}** — ${e.subject} (${e.date})`);
        return { content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No emails found." }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `\u274c Email bridge not running.` }] };
      }
    },
  },
  {
    name: "configure_email",
    label: "Configure Email",
    description: "Set up Gmail email credentials (email + App Password). One-time setup.",
    parameters: Type.Object({
      email: Type.String({ description: "Gmail address" }),
      appPassword: Type.String({ description: "16-character Gmail App Password" }),
      displayName: Type.Optional(Type.String({ description: "Display name for outgoing emails" })),
    }),
    async execute(id, params) {
      try {
        const result = await callEmailBridge("/configure", "POST", {
          email: params.email,
          appPassword: params.appPassword,
          displayName: params.displayName || "",
        });
        return { content: [{ type: "text", text: result.ok ? `\u2705 ${result.message}` : `\u274c ${result.error}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `\u274c Email bridge not running.` }] };
      }
    },
  },
  {
    name: "social_status",
    label: "Social Media Status",
    description: "Check connection status of all social media accounts and email. Call this first to see what platforms the user is connected to before posting.",
    parameters: Type.Object({}),
    async execute(id, params) {
      const lines: string[] = [];
      try {
        const social = await callSocialBridge("/status", "GET");
        lines.push(`**Twitter/X**: ${social.platforms?.twitter?.configured ? "\u2705 Connected" : "\u274c Not connected"}`);
        lines.push(`**Reddit**: ${social.platforms?.reddit?.configured ? "\u2705 Connected" : "\u274c Not connected"}`);
        lines.push(`**LinkedIn**: ${social.platforms?.linkedin?.configured ? "\u2705 Connected" : "\u274c Not connected"}`);
        lines.push(`**Bluesky**: ${social.platforms?.bluesky?.configured ? "\u2705 Connected" : "\u274c Not connected"}`);
        lines.push(`**Discord**: ${social.platforms?.discord?.configured ? "\u2705 Connected" : "\u274c Not connected"}`);
        lines.push(`**Telegram**: ${social.platforms?.telegram?.configured ? "\u2705 Connected" : "\u274c Not connected"}`);
      } catch {
        lines.push("**Social Bridge**: \u274c Not running");
      }
      try {
        const email = await callEmailBridge("/status", "GET");
        lines.push(`**Email**: ${email.configured ? `\u2705 ${email.email}` : "\u274c Not configured"}`);
      } catch {
        lines.push("**Email Bridge**: \u274c Not running");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  },
];
