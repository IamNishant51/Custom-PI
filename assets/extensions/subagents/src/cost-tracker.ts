import { getSystemStore, type CostEvent, type BudgetConfig } from "./system-store";
import { logger } from "./logger";

export const COST_UNITS = {
  C_TOKEN: 1,
  C_TOOL: 50_000,
  C_AGENT: 100_000,
} as const;

const RATES: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-4": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "anthropic/claude-haiku-3.5": { input: 0.8 / 1_000_000, output: 4.0 / 1_000_000 },
  "openai/gpt-4o": { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
  "openai/gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "google/gemini-2.5-flash": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "google/gemini-2.5-pro": { input: 1.25 / 1_000_000, output: 5.0 / 1_000_000 },
  "google/gemma-4-e4b": { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
};

function getRate(provider: string, model: string): { input: number; output: number } {
  const key = `${provider}/${model}`;
  const direct = RATES[key];
  if (direct) return direct;
  for (const [pattern, rate] of Object.entries(RATES)) {
    if (key.includes(pattern) || pattern.includes(key.split("/").pop() || "")) {
      return rate;
    }
  }
  const envRate = process.env[`PI_COST_RATE_${provider.toUpperCase()}_${model.toUpperCase().replace(/[^a-zA-Z0-9]/g, "_")}`];
  if (envRate) {
    const parts = envRate.split(",").map(Number);
    if (parts.length === 2 && isFinite(parts[0]) && isFinite(parts[1])) {
      return { input: parts[0], output: parts[1] };
    }
  }
  logger.warn(`Unknown model rate for ${provider}/${model}, returning 0. Set PI_COST_RATE_${provider.toUpperCase()}_${model.toUpperCase().replace(/[^a-zA-Z0-9]/g, "_")}=input,output to configure.`);
  return { input: 0, output: 0 };
}

function estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const safeInput = isFinite(inputTokens) && inputTokens >= 0 ? inputTokens : 0;
  const safeOutput = isFinite(outputTokens) && outputTokens >= 0 ? outputTokens : 0;
  const rate = getRate(provider, model);
  const cost = (safeInput * rate.input) + (safeOutput * rate.output);
  return isFinite(cost) ? cost : 0;
}

let cachedDailyCosts: CostEvent[] | null = null;
let cachedDailyDate: string | null = null;
let cachedSessionCosts: Map<string, CostEvent[]> = new Map();

function getDailyCost(): CostEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  if (cachedDailyCosts && cachedDailyDate === today) return cachedDailyCosts;
  try {
    cachedDailyCosts = getSystemStore().getCostEvents(undefined, today);
    cachedDailyDate = today;
  } catch {
    cachedDailyCosts = [];
    cachedDailyDate = today;
  }
  return cachedDailyCosts;
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
  const safeInput = isFinite(inputTokens) && inputTokens >= 0 ? inputTokens : 0;
  const safeOutput = isFinite(outputTokens) && outputTokens >= 0 ? outputTokens : 0;
  const totalTokens = safeInput + safeOutput;
  const costUsd = estimateCost(provider, model, safeInput, safeOutput);
  const budget = getSystemStore().getBudgetConfig();

  const event: CostEvent = {
    timestamp: new Date().toISOString(),
    sessionId,
    agent,
    provider,
    model,
    inputTokens: safeInput,
    outputTokens: safeOutput,
    totalTokens,
    costUsd,
  };

  getSystemStore().appendCostEvent(event);

  cachedDailyCosts = null;
  cachedSessionCosts.delete(sessionId);

  const sessionCosts = getSystemStore().getCostEvents(sessionId);
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
  try {
    const costs = getSystemStore().getCostEvents(sessionId);
    cachedSessionCosts.set(sessionId, costs);
    return costs;
  } catch {
    return [];
  }
}

export interface CpuwResult {
  totalCostUsd: number;
  totalTokenEquiv: number;
  stepCount: number;
  cpuw: number;
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
  return getSystemStore().getBudgetConfig();
}

export function setBudgetConfig(partial: Partial<BudgetConfig>): BudgetConfig {
  return getSystemStore().setBudgetConfig(partial);
}

export function getCostSummary(): {
  totalSessions: number;
  totalTokens: number;
  totalCostUsd: number;
  dailyTokens: number;
  dailyCostUsd: number;
  today: string;
} {
  return getSystemStore().getCostSummary();
}

export function getModelRates(): Record<string, { input: number; output: number }> {
  return { ...RATES };
}
