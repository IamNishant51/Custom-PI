import path from "node:path";
import fs from "node:fs";
import { getEnvApiKey } from "@earendil-works/pi-ai";
import { SHARED_PATHS, DEFAULT_SWARM_TEAMS } from "../shared-constants.mjs";

const { PI_DIR, TEAMS_FILE, SWARM_STATE_FILE } = SHARED_PATHS;

export function loadSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(PI_DIR, "settings.json"), "utf8")); }
  catch { return {}; }
}

export function loadModels() {
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

export function makeFallbackModel() {
  return {
    id: "google/gemma-4-e4b", name: "Gemma 4 E4B", provider: "lmstudio",
    api: "openai-completions", baseUrl: "http://127.0.0.1:1234/v1",
    reasoning: false, input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096, maxTokens: 2048,
  };
}

export function normalizeModel(m) {
  return {
    id: m.id, name: m.name || m.id,
    api: m.api || "openai-completions", provider: m.provider || "lmstudio",
    baseUrl: m.baseUrl || "http://127.0.0.1:1234/v1",
    reasoning: !!m.reasoning, input: m.input || ["text", "image"],
    cost: m.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow || 4096, maxTokens: m.maxTokens || 2048,
  };
}

export function loadSoul() {
  try { return fs.readFileSync(path.join(PI_DIR, "SOUL.md"), "utf8"); }
  catch { return ""; }
}

export function resolveModel() {
  const settings = loadSettings();
  const models = loadModels();
  const defaultId = settings.defaultModel || "gemma-4-e4b";
  const found = models.find(m => m.id === defaultId || `${m.provider}/${m.id}` === defaultId);
  const resolved = found || models[0] || { id: defaultId, provider: settings.defaultProvider || "lmstudio", api: "openai-completions" };
  return normalizeModel(resolved);
}

export function getModelAuth(model) {
  let apiKey = getEnvApiKey(model.provider) || "";
  if (!apiKey && (model.provider === "lmstudio" || model.provider === "ollama")) {
    apiKey = "local-dev-key";
  }
  return { apiKey, headers: {} };
}

export function loadSwarmTeams() {
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

export function saveSwarmTeams(teams) {
  try {
    fs.writeFileSync(TEAMS_FILE, JSON.stringify(teams, null, 2));
  } catch (err) {
    console.error("[Web Server] Failed to save swarm teams:", err);
  }
}

export function loadSwarmState() {
  try {
    if (fs.existsSync(SWARM_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(SWARM_STATE_FILE, "utf8"));
    }
  } catch {}
  return null;
}

export function saveSwarmState(state) {
  try {
    fs.mkdirSync(path.dirname(SWARM_STATE_FILE), { recursive: true });
    fs.writeFileSync(SWARM_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[Web Server] Failed to save swarm state:", err);
  }
}
