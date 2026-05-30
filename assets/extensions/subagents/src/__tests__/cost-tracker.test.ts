import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  trackCost,
  getSessionCosts,
  getCostSummary,
  getBudgetConfig,
  setBudgetConfig,
  getModelRates,
} from "../cost-tracker";

const COST_DIR = path.join(os.homedir(), ".pi", "agent", "costs");

describe("cost-tracker", () => {
  beforeEach(() => {
    try { fs.rmSync(COST_DIR, { recursive: true, force: true }); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(COST_DIR, { recursive: true, force: true }); } catch {}
  });

  it("trackCost records an event", () => {
    const result = trackCost("session-1", "builder", "anthropic", "claude-sonnet-4", 500, 100);
    expect(result.recorded).toBe(true);
    expect(result.totalTokens).toBe(600);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("getSessionCosts returns session events", () => {
    trackCost("sess-a", "agent-x", "openai", "gpt-4o", 100, 50);
    trackCost("sess-a", "agent-x", "openai", "gpt-4o", 200, 30);
    trackCost("sess-b", "agent-y", "google", "gemini-2.5-flash", 50, 10);

    const costs = getSessionCosts("sess-a");
    expect(costs.length).toBe(2);
  });

  it("getCostSummary returns aggregate stats", () => {
    trackCost("s-1", "a1", "anthropic", "claude-sonnet-4", 1000, 200);
    trackCost("s-2", "a2", "openai", "gpt-4o-mini", 500, 100);

    const summary = getCostSummary();
    expect(summary.totalSessions).toBeGreaterThanOrEqual(2);
    expect(summary.totalTokens).toBeGreaterThan(0);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
  });

  it("getBudgetConfig returns defaults", () => {
    const budget = getBudgetConfig();
    expect(budget.maxSessionTokens).toBe(500000);
    expect(budget.maxDailyCostUsd).toBe(5.0);
  });

  it("setBudgetConfig updates config", () => {
    setBudgetConfig({ maxSessionTokens: 100000, maxSessionCostUsd: 0.5 });
    const budget = getBudgetConfig();
    expect(budget.maxSessionTokens).toBe(100000);
    expect(budget.maxSessionCostUsd).toBe(0.5);
  });

  it("getModelRates returns known rates", () => {
    const rates = getModelRates();
    expect(Object.keys(rates).length).toBeGreaterThan(0);
    expect(rates["anthropic/claude-sonnet-4"]).toBeDefined();
  });

  it("trackCost returns budget warnings", () => {
    setBudgetConfig({ maxSessionTokens: 100, maxDailyTokens: 1000, maxSessionCostUsd: 10, maxDailyCostUsd: 10, warningThreshold: 0.5 });
    const result = trackCost("warn-sess", "agent", "anthropic", "claude-sonnet-4", 60, 40);
    expect(result.budgetWarnings.length).toBeGreaterThan(0);
  });

  it("trackCost detects overBudget", () => {
    setBudgetConfig({ maxSessionTokens: 50, maxDailyTokens: 1000, maxSessionCostUsd: 10, maxDailyCostUsd: 10, warningThreshold: 0.8 });
    const result = trackCost("over-sess", "agent", "openai", "gpt-4o-mini", 60, 0);
    expect(result.overBudget).toBe(true);
  });
});
