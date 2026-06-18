// ── Dynamic Model Router ──────────────────────────────────────────
// Selects best model based on historical performance + cost + latency.

import fs from "node:fs";
import path from "node:path";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;
const PERFORMANCE_FILE = path.join(PI_DIR, "model-performance.json");

function loadPerformance() {
  try { return JSON.parse(fs.readFileSync(PERFORMANCE_FILE, "utf8")); }
  catch { return {}; }
}

function savePerformance(data) {
  fs.mkdirSync(path.dirname(PERFORMANCE_FILE), { recursive: true });
  fs.writeFileSync(PERFORMANCE_FILE, JSON.stringify(data, null, 2));
}

export function recordModelPerformance(modelId, taskType, latency, cost, success) {
  const data = loadPerformance();
  if (!data[modelId]) data[modelId] = {};
  if (!data[modelId][taskType]) data[modelId][taskType] = { attempts: 0, successes: 0, totalLatency: 0, totalCost: 0 };
  const entry = data[modelId][taskType];
  entry.attempts++;
  if (success) entry.successes++;
  entry.totalLatency += latency;
  entry.totalCost += cost;
  entry.lastUsed = Date.now();
  savePerformance(data);
}

export function getBestModel(taskType, availableModels) {
  const data = loadPerformance();
  if (!availableModels || availableModels.length === 0) return null;
  if (Object.keys(data).length === 0) return availableModels[0];

  let best = null;
  let bestScore = -Infinity;

  for (const model of availableModels) {
    const stats = data[model.id]?.[taskType];
    if (!stats || stats.attempts < 2) {
      if (!best) best = model; // fallback to first untested model
      continue;
    }

    const successRate = stats.successes / stats.attempts;
    const avgLatency = stats.totalLatency / stats.attempts;
    const avgCost = stats.totalCost / stats.attempts;

    // Score: prefer high success rate, low latency, low cost
    const score = (successRate * 100) - (avgLatency / 1000) - (avgCost * 10);
    if (score > bestScore) {
      bestScore = score;
      best = model;
    }
  }

  return best;
}

export function getModelPerformanceReport() {
  const data = loadPerformance();
  const report = [];
  for (const [modelId, taskTypes] of Object.entries(data)) {
    for (const [taskType, stats] of Object.entries(taskTypes)) {
      report.push({
        modelId,
        taskType,
        attempts: stats.attempts,
        successes: stats.successes,
        successRate: stats.attempts > 0 ? Math.round(stats.successes / stats.attempts * 100) : 0,
        avgLatency: stats.attempts > 0 ? Math.round(stats.totalLatency / stats.attempts) : 0,
        avgCost: stats.attempts > 0 ? Math.round(stats.totalCost / stats.attempts * 1000) / 1000 : 0,
        lastUsed: stats.lastUsed,
      });
    }
  }
  return report.sort((a, b) => b.attempts - a.attempts);
}
