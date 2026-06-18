import path from "node:path";
import fs from "node:fs";
import { SHARED_PATHS } from "../shared-constants.mjs";
import { readMemory, writeMemory } from "./memory.mjs";
import { readVault } from "./vault.mjs";
import { getCostSummary } from "./cost-tracker.mjs";
import { loadSettings, loadModels, loadSwarmTeams, saveSwarmTeams } from "./settings.mjs";

const { PI_DIR, SESSION_FILE, CHECKPOINTS_DIR } = SHARED_PATHS;

export function ensureCheckpointsDir() { fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true }); }

export function saveSessionState(state) {
  fs.mkdirSync(PI_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
}

export function loadSessionState() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    }
  } catch {}
  return null;
}

export function listCheckpoints() {
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

export function createCheckpoint(label) {
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

export function restoreCheckpoint(id) {
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

export function compactSession(maxAgeDays = 30) {
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
