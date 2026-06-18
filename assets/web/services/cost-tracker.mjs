// ── Cost Tracking ───────────────────────────────────────────────────────────
import path from "node:path";
import fs from "node:fs";
import { SHARED_PATHS, MODEL_RATES } from "../shared-constants.mjs";

const { COST_DIR, COST_FILE, BUDGET_FILE } = SHARED_PATHS;

// Broadcast reference — injected by createApp to avoid circular deps
let _broadcast = null;
export function setBroadcast(fn) {
  _broadcast = fn;
}

function ensureCostDir() {
  fs.mkdirSync(COST_DIR, { recursive: true });
}

function getRate(modelId) {
  for (const [key, rate] of Object.entries(MODEL_RATES)) {
    if (modelId.includes(key.split("/").pop())) return rate;
  }
  return { input: 1, output: 2 };
}

export function trackCost(sessionId, agent, provider, modelId, inputTokens, outputTokens) {
  ensureCostDir();
  const rate = getRate(modelId);
  const costUsd = (inputTokens / 1_000_000 * rate.input) + (outputTokens / 1_000_000 * rate.output);
  const event = {
    sessionId, agent, provider, modelId, inputTokens, outputTokens,
    totalTokens: inputTokens + outputTokens, costUsd,
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(COST_FILE, JSON.stringify(event) + "\n");
  try { if (_broadcast) _broadcast({ type: "cost", ...event }); } catch {}
  return event;
}

const costSummaryCache = { data: null, timestamp: 0, ttl: 5000 };

export function getCostSummary() {
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

export function getCostDetails() {
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

export function getBudgetConfig() {
  try { return JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")); }
  catch {
    return { maxSessionTokens: 500000, maxDailyTokens: 2000000, maxSessionCostUsd: 2, maxDailyCostUsd: 5, warningThreshold: 0.8 };
  }
}

export function setBudgetConfig(config) {
  ensureCostDir();
  const current = getBudgetConfig();
  const updated = { ...current, ...config };
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(updated, null, 2));
  try { if (_broadcast) _broadcast({ type: "budget", action: "config_updated", config: updated }); } catch {}
}

export function getForecast() {
  ensureCostDir();
  if (!fs.existsSync(COST_FILE)) {
    return { dailyAvgCost: 0, dailyAvgTokens: 0, projectedMonthlyCost: 0, projectedMonthlyTokens: 0, daysOfData: 0, trend: "insufficient_data", alert: null };
  }
  const lines = fs.readFileSync(COST_FILE, "utf8").trim().split("\n").filter(Boolean);
  const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (all.length < 5) {
    return { dailyAvgCost: 0, dailyAvgTokens: 0, projectedMonthlyCost: 0, projectedMonthlyTokens: 0, daysOfData: 0, trend: "insufficient_data", alert: null };
  }

  // Aggregate by day
  const dayMap = {};
  for (const e of all) {
    const day = e.timestamp.slice(0, 10);
    if (!dayMap[day]) dayMap[day] = { tokens: 0, costUsd: 0, calls: 0 };
    dayMap[day].tokens += e.totalTokens || 0;
    dayMap[day].costUsd += e.costUsd || 0;
    dayMap[day].calls++;
  }

  const days = Object.keys(dayMap).sort();
  const dayValues = days.map(d => dayMap[d]);

  // Simple trend: compare last 7 days vs previous 7
  const recentDays = dayValues.slice(-7);
  const olderDays = dayValues.slice(-14, -7);

  const recentDailyAvg = recentDays.length > 0
    ? recentDays.reduce((s, d) => s + d.costUsd, 0) / recentDays.length
    : 0;
  const olderDailyAvg = olderDays.length > 0
    ? olderDays.reduce((s, d) => s + d.costUsd, 0) / olderDays.length
    : 0;

  const trend = olderDailyAvg > 0
    ? (recentDailyAvg / olderDailyAvg > 1.2 ? "increasing" : recentDailyAvg / olderDailyAvg < 0.8 ? "decreasing" : "stable")
    : "stable";

  const dailyAvgCost = dayValues.reduce((s, d) => s + d.costUsd, 0) / dayValues.length;
  const dailyAvgTokens = dayValues.reduce((s, d) => s + d.tokens, 0) / dayValues.length;

  const projectedMonthlyCost = dailyAvgCost * 30;
  const projectedMonthlyTokens = dailyAvgTokens * 30;

  // Alert if projected monthly exceeds budget
  const budget = getBudgetConfig();
  let alert = null;
  if (budget.maxDailyCostUsd && recentDailyAvg > budget.maxDailyCostUsd) {
    alert = { level: "warning", message: `Daily spend ($${recentDailyAvg.toFixed(3)}) exceeds budget ($${budget.maxDailyCostUsd})` };
  }
  if (budget.maxDailyCostUsd && dailyAvgCost * 7 > budget.maxDailyCostUsd * 7 * 1.5) {
    alert = { level: "info", message: `Weekly projected spend is 50% over daily budget` };
  }

  return {
    dailyAvgCost: Math.round(dailyAvgCost * 1000) / 1000,
    dailyAvgTokens: Math.round(dailyAvgTokens),
    projectedMonthlyCost: Math.round(projectedMonthlyCost * 1000) / 1000,
    projectedMonthlyTokens: Math.round(projectedMonthlyTokens),
    daysOfData: dayValues.length,
    trend,
    recentDailyAvg: Math.round(recentDailyAvg * 1000) / 1000,
    olderDailyAvg: Math.round(olderDailyAvg * 1000) / 1000,
    alert,
  };
}
