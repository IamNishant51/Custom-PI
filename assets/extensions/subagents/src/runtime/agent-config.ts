import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "yaml";

export const AGENTS_DIR_GLOBAL = path.join(os.homedir(), ".pi/agent/agents");
export const AGENTS_DIR_LOCAL = path.join(process.cwd(), ".pi/agents");

const REQUIRED_AGENT_FIELDS = ["name", "role"] as const;

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
    role: String(raw.role),
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
const AGENTS_CACHE_TTL = 30_000;

export function loadAgents(): Map<string, AgentConfig> {
  const now = Date.now();
  if (agentsCache && (now - agentsCache.timestamp) < AGENTS_CACHE_TTL) {
    return agentsCache.data;
  }
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
  agentsCache = { data: agents, timestamp: Date.now() };
  return agents;
}

export function invalidateAgentCache(): void {
  agentsCache = null;
}
