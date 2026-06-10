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
  ensureSession, insertMessage, getMessages, searchSession,
  insertTriplet, queryTriplets, closeDb as closeStateDb,
} from "../../state-db";
import {
  trackCost, getSessionCosts, getCostSummary, getBudgetConfig,
  setBudgetConfig,
} from "../../cost-tracker";

const DB_PATH = path.join(tmpDir, ".pi", "agent", "session-state.db");
const COST_DIR = path.join(tmpDir, ".pi", "agent", "costs");

describe("cross-module: state-db + cost-tracker", () => {
  afterAll(() => {
    try { closeStateDb(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    try { fs.unlinkSync(DB_PATH + "-wal"); } catch {}
    try { fs.unlinkSync(DB_PATH + "-shm"); } catch {}
    try { fs.unlinkSync(DB_PATH); } catch {}
    try { fs.rmSync(COST_DIR, { recursive: true, force: true }); } catch {}
  });

  afterEach(() => {
    try { closeStateDb(); } catch {}
    try { fs.unlinkSync(DB_PATH + "-wal"); } catch {}
    try { fs.unlinkSync(DB_PATH + "-shm"); } catch {}
    try { fs.unlinkSync(DB_PATH); } catch {}
    try { fs.rmSync(COST_DIR, { recursive: true, force: true }); } catch {}
  });

  it("stores data in state-db and records cost in cost-tracker independently", () => {
    const session = ensureSession("cross-sess", "cross-project");
    expect(session.sessionId).toBe("cross-sess");

    insertMessage("cross-sess", "user", "Store this conversation");
    const msgs = getMessages("cross-sess");
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe("Store this conversation");

    const cost = trackCost("cross-sess", "agent-x", "anthropic", "claude-sonnet-4", 500, 100);
    expect(cost.recorded).toBe(true);
    expect(cost.totalTokens).toBe(600);

    const costs = getSessionCosts("cross-sess");
    expect(costs.length).toBe(1);
    expect(costs[0].sessionId).toBe("cross-sess");
  });

  it("FTS search and cost summary both work after mixed operations", () => {
    ensureSession("mixed-sess");
    insertMessage("mixed-sess", "user", "Implemented sorting algorithm with O(n log n)");
    insertMessage("mixed-sess", "assistant", "The quicksort implementation looks correct");

    trackCost("mixed-sess", "builder", "anthropic", "claude-sonnet-4", 1000, 250);
    trackCost("mixed-sess", "builder", "anthropic", "claude-sonnet-4", 500, 100);

    const ftsResults = searchSession("quicksort", "mixed-sess", 10);
    expect(ftsResults.length).toBeGreaterThan(0);

    const summary = getCostSummary();
    expect(summary.totalTokens).toBeGreaterThan(0);
    expect(summary.totalSessions).toBeGreaterThanOrEqual(1);
  });

  it("stores triplets and tracks costs with same session id", () => {
    ensureSession("triplet-cost");
    insertMessage("triplet-cost", "user", "Learning about the codebase architecture");

    insertTriplet({
      id: "arch-triplet",
      subjectId: "svc-web",
      subjectType: "service",
      subjectLabel: "Web Server",
      predicateType: "communicates_with",
      predicateLabel: "communicates with",
      objectId: "svc-db",
      objectType: "service",
      objectLabel: "Database",
      confidenceScore: 0.95,
      sourceSession: "triplet-cost",
    });

    trackCost("triplet-cost", "architect", "openai", "gpt-4o", 800, 150);

    const triplets = queryTriplets({ subjectId: "svc-web" });
    expect(triplets.length).toBe(1);
    expect(triplets[0].objectLabel).toBe("Database");

    const costs = getSessionCosts("triplet-cost");
    expect(costs.length).toBe(1);
    expect(costs[0].sessionId).toBe("triplet-cost");
  });

  it("multiple sessions with cost tracking work correctly", () => {
    ensureSession("session-alpha");
    ensureSession("session-beta");

    insertMessage("session-alpha", "user", "Alpha conversation");
    insertMessage("session-beta", "user", "Beta conversation");

    trackCost("session-alpha", "agent-a", "anthropic", "claude-sonnet-4", 100, 20);
    trackCost("session-alpha", "agent-a", "anthropic", "claude-sonnet-4", 200, 40);
    trackCost("session-beta", "agent-b", "google", "gemini-2.5-flash", 50, 10);

    const alphaCosts = getSessionCosts("session-alpha");
    expect(alphaCosts.length).toBe(2);

    const betaCosts = getSessionCosts("session-beta");
    expect(betaCosts.length).toBe(1);

    const summary = getCostSummary();
    expect(summary.totalSessions).toBeGreaterThanOrEqual(2);
  });

  it("cost data persists separately from state-db (different tables)", () => {
    ensureSession("persist-test");
    insertMessage("persist-test", "user", "Test persistence");

    trackCost("persist-test", "agent", "anthropic", "claude-sonnet-4", 100, 20);

    closeStateDb();

    const dbFileExists = fs.existsSync(DB_PATH);
    expect(dbFileExists).toBe(true);

    const systemDbExists = fs.existsSync(path.join(tmpDir, ".pi", "agent", "system.db"));
    expect(systemDbExists).toBe(true);
  });

  it("budget config and state-db operate on different files", () => {
    setBudgetConfig({ maxSessionTokens: 250000 });

    ensureSession("budget-sess");
    insertMessage("budget-sess", "user", "Budget test");

    const budget = getBudgetConfig();
    expect(budget.maxSessionTokens).toBe(250000);

    const msgs = getMessages("budget-sess");
    expect(msgs.length).toBe(1);
  });
});
