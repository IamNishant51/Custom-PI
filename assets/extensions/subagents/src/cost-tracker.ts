import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const COST_DIR = path.join(os.homedir(), ".pi", "agent", "costs");
const BUDGET_FILE = path.join(COST_DIR, "budget.json");
const SESSION_COST_FILE = path.join(COST_DIR, "session-costs.jsonl");

// ── Cost Units ──────────────────────────────────────────────────────────────

export const COST_UNITS = {
  C_TOKEN: 1,
  C_TOOL: 50_000,    // fixed token-equivalent cost for complex tool invocations
  C_AGENT: 100_000,  // fixed token-equivalent per sub-agent execution step
} as const;

interface CostEvent {
  timestamp: string;
  sessionId: string;
  agent: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

interface BudgetConfig {
  maxSessionTokens: number;
  maxDailyTokens: number;
  maxSessionCostUsd: number;
  maxDailyCostUsd: number;
  warningThreshold: number;
}

const DEFAULT_BUDGET: BudgetConfig = {
  maxSessionTokens: 500_000,
  maxDailyTokens: 2_000_000,
  maxSessionCostUsd: 1.0,
  maxDailyCostUsd: 5.0,
  warningThreshold: 0.8,
};

const RATES: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-4": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "anthropic/claude-haiku-3.5": { input: 0.8 / 1_000_000, output: 4.0 / 1_000_000 },
  "openai/gpt-4o": { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
  "openai/gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "google/gemini-2.5-flash": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "google/gemini-2.5-pro": { input: 1.25 / 1_000_000, output: 5.0 / 1_000_000 },
  "google/gemma-4-e4b": { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
};

function ensureCostDir(): void {
  if (!fs.existsSync(COST_DIR)) fs.mkdirSync(COST_DIR, { recursive: true });
}

function loadBudget(): BudgetConfig {
  ensureCostDir();
  if (!fs.existsSync(BUDGET_FILE)) return { ...DEFAULT_BUDGET };
  try {
    return { ...DEFAULT_BUDGET, ...JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_BUDGET };
  }
}

function getRate(provider: string, model: string): { input: number; output: number } {
  const key = `${provider}/${model}`;
  const direct = RATES[key];
  if (direct) return direct;
  for (const [pattern, rate] of Object.entries(RATES)) {
    if (key.includes(pattern) || pattern.includes(key.split("/").pop() || "")) {
      return rate;
    }
  }
  return { input: 0, output: 0 };
}

function estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const safeInput = isFinite(inputTokens) && inputTokens >= 0 ? inputTokens : 0;
  const safeOutput = isFinite(outputTokens) && outputTokens >= 0 ? outputTokens : 0;
  const rate = getRate(provider, model);
  const cost = (safeInput * rate.input) + (safeOutput * rate.output);
  return isFinite(cost) ? cost : 0;
}

// ── In-memory cache to avoid re-reading the full JSONL on every trackCost ──

let cachedDailyCosts: CostEvent[] | null = null;
let cachedDailyDate: string | null = null;
let cachedSessionCosts: Map<string, CostEvent[]> = new Map();

function getDailyCost(): CostEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  if (cachedDailyCosts && cachedDailyDate === today) return cachedDailyCosts;
  ensureCostDir();
  if (!fs.existsSync(SESSION_COST_FILE)) { cachedDailyCosts = []; cachedDailyDate = today; return []; }
  const costs: CostEvent[] = [];
  try {
    const lines = fs.readFileSync(SESSION_COST_FILE, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as CostEvent;
        if (event.timestamp.startsWith(today)) costs.push(event);
      } catch {}
    }
  } catch {}
  cachedDailyCosts = costs;
  cachedDailyDate = today;
  return costs;
}

export interface CostResult {
  recorded: boolean;
  totalTokens: number;
  costUsd: number;
  sessionTotalTokens: number;
  sessionTotalCost: number;
  dailyTotalTokens: number;
  dailyTotalCost: number;
  budgetWarnings: string[];
  overBudget: boolean;
}

export function trackCost(
  sessionId: string,
  agent: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): CostResult {
  ensureCostDir();
  const safeInput = isFinite(inputTokens) && inputTokens >= 0 ? inputTokens : 0;
  const safeOutput = isFinite(outputTokens) && outputTokens >= 0 ? outputTokens : 0;
  const totalTokens = safeInput + safeOutput;
  const costUsd = estimateCost(provider, model, safeInput, safeOutput);
  const budget = loadBudget();

  const event: CostEvent = {
    timestamp: new Date().toISOString(),
    sessionId,
    agent,
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
  };

  fs.appendFileSync(SESSION_COST_FILE, JSON.stringify(event) + "\n", "utf8");

  // Invalidate caches
  cachedDailyCosts = null;
  cachedSessionCosts.delete(sessionId);

  const sessionCosts = getSessionCosts(sessionId);
  const dailyCosts = getDailyCost();

  const sessionTotalTokens = sessionCosts.reduce((s, c) => s + c.totalTokens, 0);
  const sessionTotalCost = sessionCosts.reduce((s, c) => s + c.costUsd, 0);
  const dailyTotalTokens = dailyCosts.reduce((s, c) => s + c.totalTokens, 0);
  const dailyTotalCost = dailyCosts.reduce((s, c) => s + c.costUsd, 0);

  const warnings: string[] = [];

  if (sessionTotalTokens > budget.maxSessionTokens * budget.warningThreshold) {
    warnings.push(`Session token usage at ${Math.round((sessionTotalTokens / budget.maxSessionTokens) * 100)}% of budget.`);
  }
  if (sessionTotalCost > budget.maxSessionCostUsd * budget.warningThreshold) {
    warnings.push(`Session cost at ${Math.round((sessionTotalCost / budget.maxSessionCostUsd) * 100)}% of budget.`);
  }
  if (dailyTotalTokens > budget.maxDailyTokens * budget.warningThreshold) {
    warnings.push(`Daily token usage at ${Math.round((dailyTotalTokens / budget.maxDailyTokens) * 100)}% of budget.`);
  }
  if (dailyTotalCost > budget.maxDailyCostUsd * budget.warningThreshold) {
    warnings.push(`Daily cost at ${Math.round((dailyTotalCost / budget.maxDailyCostUsd) * 100)}% of budget.`);
  }

  const overBudget =
    sessionTotalTokens > budget.maxSessionTokens ||
    sessionTotalCost > budget.maxSessionCostUsd ||
    dailyTotalTokens > budget.maxDailyTokens ||
    dailyTotalCost > budget.maxDailyCostUsd;

  return {
    recorded: true,
    totalTokens,
    costUsd,
    sessionTotalTokens,
    sessionTotalCost,
    dailyTotalTokens,
    dailyTotalCost,
    budgetWarnings: warnings,
    overBudget,
  };
}

export function trackToolCost(sessionId: string, agent: string): CostResult {
  return trackCost(sessionId, agent, "system", "tool-call", COST_UNITS.C_TOOL, 0);
}

export function trackAgentStepCost(sessionId: string, agent: string): CostResult {
  return trackCost(sessionId, agent, "system", "agent-step", COST_UNITS.C_AGENT, 0);
}

export function getSessionCosts(sessionId: string): CostEvent[] {
  if (cachedSessionCosts.has(sessionId)) return cachedSessionCosts.get(sessionId)!;
  ensureCostDir();
  if (!fs.existsSync(SESSION_COST_FILE)) return [];
  const costs: CostEvent[] = [];
  try {
    const lines = fs.readFileSync(SESSION_COST_FILE, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as CostEvent;
        if (event.sessionId === sessionId) costs.push(event);
      } catch {}
    }
  } catch {}
  cachedSessionCosts.set(sessionId, costs);
  return costs;
}

// ── CPUW (Cost Per Unit of Work) ────────────────────────────────────────────

export interface CpuwResult {
  totalCostUsd: number;
  totalTokenEquiv: number;
  stepCount: number;
  cpuw: number;           // cost per step
  tokenEquivPerStep: number;
  efficiency: "low" | "medium" | "high";
}

export function calculateCpuw(sessionId: string): CpuwResult {
  const events = getSessionCosts(sessionId);
  if (events.length === 0) {
    return { totalCostUsd: 0, totalTokenEquiv: 0, stepCount: 0, cpuw: 0, tokenEquivPerStep: 0, efficiency: "high" };
  }

  const totalCostUsd = events.reduce((s, e) => s + e.costUsd, 0);
  const totalTokenEquiv = events.reduce((s, e) => s + e.totalTokens, 0);
  const stepCount = events.length;

  const cpuw = totalCostUsd / stepCount;
  const tokenEquivPerStep = totalTokenEquiv / stepCount;

  let efficiency: "low" | "medium" | "high";
  if (cpuw > 0.05) efficiency = "low";
  else if (cpuw > 0.01) efficiency = "medium";
  else efficiency = "high";

  return { totalCostUsd, totalTokenEquiv, stepCount, cpuw, tokenEquivPerStep, efficiency };
}

export function getBudgetConfig(): BudgetConfig {
  return loadBudget();
}

export function setBudgetConfig(partial: Partial<BudgetConfig>): BudgetConfig {
  const current = loadBudget();
  const updated = { ...current, ...partial };
  ensureCostDir();
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(updated, null, 2), "utf8");
  return updated;
}

export function getCostSummary(): {
  totalSessions: number;
  totalTokens: number;
  totalCostUsd: number;
  dailyTokens: number;
  dailyCostUsd: number;
  today: string;
} {
  ensureCostDir();
  if (!fs.existsSync(SESSION_COST_FILE)) {
    return { totalSessions: 0, totalTokens: 0, totalCostUsd: 0, dailyTokens: 0, dailyCostUsd: 0, today: new Date().toISOString().slice(0, 10) };
  }
  const lines = fs.readFileSync(SESSION_COST_FILE, "utf8").trim().split("\n").filter(Boolean);
  const all: CostEvent[] = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const daily = all.filter(e => e.timestamp.startsWith(today));
  const sessions = new Set(all.map(e => e.sessionId));

  return {
    totalSessions: sessions.size,
    totalTokens: all.reduce((s, e) => s + e.totalTokens, 0),
    totalCostUsd: all.reduce((s, e) => s + e.costUsd, 0),
    dailyTokens: daily.reduce((s, e) => s + e.totalTokens, 0),
    dailyCostUsd: daily.reduce((s, e) => s + e.costUsd, 0),
    today,
  };
}

export function getModelRates(): Record<string, { input: number; output: number }> {
  return { ...RATES };
}
