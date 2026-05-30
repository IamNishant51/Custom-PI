import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const COST_DIR = path.join(os.homedir(), ".pi", "agent", "costs");
const BUDGET_FILE = path.join(COST_DIR, "budget.json");
const SESSION_COST_FILE = path.join(COST_DIR, "session-costs.jsonl");

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
  const rate = getRate(provider, model);
  return (inputTokens * rate.input) + (outputTokens * rate.output);
}

function getDailyCost(): CostEvent[] {
  ensureCostDir();
  if (!fs.existsSync(SESSION_COST_FILE)) return [];
  const today = new Date().toISOString().slice(0, 10);
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
  const totalTokens = inputTokens + outputTokens;
  const costUsd = estimateCost(provider, model, inputTokens, outputTokens);
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

export function getSessionCosts(sessionId: string): CostEvent[] {
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
  return costs;
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
