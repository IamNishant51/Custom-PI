import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

import { PATHS } from "../config";
import { getCache } from "../lru-cache";

export const AGENTS_DIR_GLOBAL = PATHS.AGENTS;
export const AGENTS_DIR_LOCAL = path.join(process.cwd(), ".pi/agents");

const AGENT_CACHE = getCache("agent-configs", { capacity: 5, ttlMs: 300_000 });

const REQUIRED_AGENT_FIELDS = ["name"] as const;

export function validateAgentConfig(raw: Record<string, unknown>): AgentConfig | null {
  for (const field of REQUIRED_AGENT_FIELDS) {
    if (!raw[field] || typeof raw[field] !== "string") {
      console.error(`[AgentConfig] Missing or invalid required field: "${field}"`);
      return null;
    }
  }
  const allowedKeys = new Set<string>(["name", "role", "systemPrompt", "tools", "model", "maxTurns", "temperature", "description", "thinking"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      console.warn(`[AgentConfig] Unknown config key "${key}" will be ignored`);
    }
  }
  return {
    name: String(raw.name),
    role: typeof raw.role === "string" ? raw.role : "teammate",
    systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt : "",
    tools: Array.isArray(raw.tools) ? raw.tools.map(String) : undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    maxTurns: typeof raw.maxTurns === "number" ? raw.maxTurns : undefined,
    temperature: typeof raw.temperature === "number" ? raw.temperature : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
    thinking: typeof raw.thinking === "boolean" ? raw.thinking : undefined,
  };
}

export function parseMarkdownAgent(content: string): { config: AgentConfig; body: string } | null {
  const match = content.match(/^\s*---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/);
  if (!match) return null;
  try {
    const raw = yaml.parse(match[1]) as Record<string, unknown>;
    const config = validateAgentConfig(raw);
    if (!config) return null;
    const body = match[2] || "";
    return { config, body };
  } catch (e) {
    console.error("[AgentConfig] YAML parsing error:", e);
    return null;
  }
}

let agentsCache: { data: Map<string, AgentConfig>; timestamp: number } | null = null;
const AGENTS_CACHE_TTL = 24 * 3600 * 1000; // 24 hours cache

export function loadAgents(): Map<string, AgentConfig> {
  const cached = AGENT_CACHE.get("all-agents");
  if (cached) return cached as Map<string, AgentConfig>;

  const agents = new Map<string, AgentConfig>();
  const dirs = [AGENTS_DIR_GLOBAL, AGENTS_DIR_LOCAL];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), "utf8");
        const parsed = parseMarkdownAgent(content);
        if (parsed) {
          const { config, body } = parsed;
          const fullSystemPrompt = (config.systemPrompt || "") + "\n\n" + body;
          const agentName = config.name || path.basename(file, ".md");
          agents.set(agentName, {
            ...config,
            name: agentName,
            systemPrompt: fullSystemPrompt.trim()
          });
        }
      } catch (e) {
        console.error(`Error loading agent in ${file}:`, e);
      }
    }
  }
  AGENT_CACHE.set("all-agents", agents);
  return agents;
}

export function invalidateAgentCache(): void {
  AGENT_CACHE.delete("all-agents");
}
