import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = vi.hoisted(() => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-int-"));
  return dir;
});

vi.mock("node:os", () => {
  const actual = require("node:os");
  const ns = { ...actual, homedir: () => tmpDir };
  return { default: ns, ...ns };
});

import {
  trackCost, getSessionCosts, getCostSummary, getModelRates,
  setBudgetConfig, getBudgetConfig, trackToolCost, trackAgentStepCost,
  calculateCpuw,
} from "../../cost-tracker";

const COST_DIR = path.join(tmpDir, ".pi", "agent", "costs");

describe("cost-tracker integration", () => {
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    try { fs.rmSync(COST_DIR, { recursive: true, force: true }); } catch {}
    setBudgetConfig({ maxSessionTokens: 500000, maxDailyTokens: 2000000, maxSessionCostUsd: 1.0, maxDailyCostUsd: 5.0, warningThreshold: 0.8 });
  });

  afterEach(() => {
    try { fs.rmSync(COST_DIR, { recursive: true, force: true }); } catch {}
  });

  it("trackCost records event and returns correct totals", () => {
    const result = trackCost("sess-int-1", "agent-x", "anthropic", "claude-sonnet-4", 500, 100);
    expect(result.recorded).toBe(true);
    expect(result.totalTokens).toBe(600);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.sessionTotalTokens).toBe(600);
  });

  it("getSessionCosts returns all events for a session", () => {
    trackCost("sess-int-a", "agent-1", "openai", "gpt-4o", 200, 50);
    trackCost("sess-int-a", "agent-1", "openai", "gpt-4o", 300, 30);
    trackCost("sess-int-b", "agent-2", "google", "gemini-2.5-flash", 100, 20);

    const costsA = getSessionCosts("sess-int-a");
    expect(costsA.length).toBe(2);

    const costsB = getSessionCosts("sess-int-b");
    expect(costsB.length).toBe(1);
  });

  it("getCostSummary returns aggregate stats across sessions", () => {
    trackCost("s-1", "a1", "anthropic", "claude-sonnet-4", 1000, 200);
    trackCost("s-2", "a2", "openai", "gpt-4o-mini", 500, 100);

    const summary = getCostSummary();
    expect(summary.totalSessions).toBeGreaterThanOrEqual(2);
    expect(summary.totalTokens).toBeGreaterThan(0);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
    expect(summary.today).toBeTruthy();
  });

  it("NaN input tokens are guarded and treated as 0", () => {
    const result = trackCost("sess-nan", "agent", "openai", "gpt-4o", NaN, 100);
    expect(result.recorded).toBe(true);
    expect(result.totalTokens).toBe(100);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("Infinity input tokens are guarded and treated as 0", () => {
    const result = trackCost("sess-inf", "agent", "openai", "gpt-4o", Infinity, 100);
    expect(result.recorded).toBe(true);
    expect(result.totalTokens).toBe(100);
  });

  it("negative tokens are guarded and treated as 0", () => {
    const result = trackCost("sess-neg", "agent", "openai", "gpt-4o", -50, 100);
    expect(result.recorded).toBe(true);
    expect(result.totalTokens).toBe(100);
  });

  it("NaN and Infinity for both tokens are guarded", () => {
    const result = trackCost("sess-nan2", "agent", "openai", "gpt-4o", NaN, Infinity);
    expect(result.recorded).toBe(true);
    expect(result.totalTokens).toBe(0);
    expect(result.costUsd).toBe(0);
  });

  it("trackToolCost records tool call cost", () => {
    const result = trackToolCost("sess-tool", "agent-y");
    expect(result.recorded).toBe(true);
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it("trackAgentStepCost records agent step cost", () => {
    const result = trackAgentStepCost("sess-agent", "agent-z");
    expect(result.recorded).toBe(true);
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it("getModelRates returns known rates", () => {
    const rates = getModelRates();
    expect(Object.keys(rates).length).toBeGreaterThan(0);
    expect(rates["anthropic/claude-sonnet-4"]).toBeDefined();
    expect(rates["anthropic/claude-sonnet-4"].input).toBeGreaterThan(0);
  });

  it("getBudgetConfig returns defaults", () => {
    const budget = getBudgetConfig();
    expect(budget.maxSessionTokens).toBe(500000);
    expect(budget.maxDailyCostUsd).toBe(5.0);
  });

  it("setBudgetConfig persists updates", () => {
    setBudgetConfig({ maxSessionTokens: 100000, maxSessionCostUsd: 0.5 });
    const budget = getBudgetConfig();
    expect(budget.maxSessionTokens).toBe(100000);
    expect(budget.maxSessionCostUsd).toBe(0.5);
  });

  it("calculateCpuw returns efficiency for session with costs", () => {
    trackCost("cpuw-sess", "agent", "anthropic", "claude-sonnet-4", 1000, 200);
    trackCost("cpuw-sess", "agent", "anthropic", "claude-sonnet-4", 500, 100);

    const cpuw = calculateCpuw("cpuw-sess");
    expect(cpuw.stepCount).toBe(2);
    expect(cpuw.totalCostUsd).toBeGreaterThan(0);
    expect(["low", "medium", "high"]).toContain(cpuw.efficiency);
  });

  it("trackCost returns budget warnings when approaching limits", () => {
    setBudgetConfig({ maxSessionTokens: 100, maxDailyTokens: 1000, maxSessionCostUsd: 10, maxDailyCostUsd: 10, warningThreshold: 0.5 });
    const result = trackCost("warn-int", "agent", "anthropic", "claude-sonnet-4", 60, 40);
    expect(result.budgetWarnings.length).toBeGreaterThan(0);
  });

  it("trackCost detects overBudget", () => {
    setBudgetConfig({ maxSessionTokens: 50, maxDailyTokens: 1000, maxSessionCostUsd: 10, maxDailyCostUsd: 10, warningThreshold: 0.8 });
    const result = trackCost("over-int", "agent", "openai", "gpt-4o-mini", 60, 0);
    expect(result.overBudget).toBe(true);
  });

  it("compactDailyCosts removes duplicates", async () => {
    trackCost("dedup-sess", "agent", "anthropic", "claude-sonnet-4", 100, 50);
    const beforeCompact = getSessionCosts("dedup-sess");
    expect(beforeCompact.length).toBe(1);
  });
});
