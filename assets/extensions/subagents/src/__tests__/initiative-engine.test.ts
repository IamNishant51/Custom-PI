import { describe, it, expect, beforeEach, vi } from "vitest";
import { InitiativeEngine } from "../autonomy/initiative-engine";

describe("InitiativeEngine", () => {
  let engine: InitiativeEngine;

  beforeEach(() => {
    engine = new InitiativeEngine();
  });

  it("evaluates opportunity with high score", () => {
    const opp = engine.evaluate("optimization", "Disk usage is high. Consider cleanup.", 0.8, 0.9);
    expect(opp).not.toBeNull();
    expect(opp!.category).toBe("optimization");
    expect(opp!.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it("returns null for low-scoring opportunities", () => {
    const opp = engine.evaluate("maintenance", "Minor thing.", 0.1, 0.1);
    expect(opp).toBeNull();
  });

  it("deduplicates identical descriptions", () => {
    const first = engine.evaluate("security", "Check for vulnerabilities", 0.5, 0.5);
    const dupe = engine.evaluate("security", "Check for vulnerabilities", 0.5, 0.5);
    expect(dupe).not.toBeNull();
    expect(dupe!.id).toBe(first!.id);
  });

  it("returns pending opportunities sorted by confidence", () => {
    engine.evaluate("learning", "Low priority", 0.2, 0.2);
    engine.evaluate("maintenance", "High priority", 0.9, 0.9);
    const pending = engine.getPendingOpportunities(0.5);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    if (pending.length >= 2) {
      expect(pending[0].confidence).toBeGreaterThanOrEqual(pending[1].confidence);
    }
  });

  it("dismisses opportunities", () => {
    const opp = engine.evaluate("proactive", "Review changes", 0.6, 0.6);
    if (opp) {
      expect(opp.dismissed).toBe(false);
      engine.dismiss(opp.id);
      const pending = engine.getPendingOpportunities(0);
      expect(pending.find(o => o.id === opp.id)).toBeUndefined();
    }
  });

  it("tracks user receptivity", () => {
    expect(engine.getUserReceptivity()).toBeGreaterThanOrEqual(0);
    expect(engine.getUserReceptivity()).toBeLessThanOrEqual(1);
  });

  it("records and tracks impact of autonomous actions", () => {
    const opp = engine.evaluate("optimization", "Test impact tracking", 0.7, 0.7);
    expect(opp).not.toBeNull();

    const statsBefore = engine.getImpactStats();
    engine.recordImpact(opp!.id, "Test autonomous action", true);
    const statsAfter = engine.getImpactStats();
    expect(statsAfter.total).toBe(statsBefore.total + 1);
    expect(statsAfter.succeeded).toBeGreaterThan(0);
  });

  it("completes impact records with details", () => {
    const opp = engine.evaluate("maintenance", "Test completion", 0.6, 0.6);
    expect(opp).not.toBeNull();

    engine.recordImpact(opp!.id, "Test action", true);
    const before = engine.getImpactStats();
    expect(before.pending).toBe(0);

    engine.recordImpact(opp!.id, "Pending action", false);
    const pendingRecords = engine.getRecentImpactRecords(24);
    const pendingRec = pendingRecords.find(r => r.success === false);
    if (pendingRec) {
      engine.completeImpactRecord(pendingRec.id, true, { compilationPassed: true, testsPassed: true });
      const stats = engine.getImpactStats();
      expect(stats.succeeded).toBeGreaterThan(0);
    }
  });

  it("returns recent impact records within time window", () => {
    engine.recordImpact("test_opp", "Recent action", true);
    const recent = engine.getRecentImpactRecords(24);
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent[0].action).toBe("Recent action");
  });

  it("checks autonomous mode from env var", () => {
    const saved = process.env.AUTONOMOUS_ENABLED;
    process.env.AUTONOMOUS_ENABLED = "true";
    expect(engine.isAutonomousEnabled()).toBe(true);
    process.env.AUTONOMOUS_ENABLED = "false";
    expect(engine.isAutonomousEnabled()).toBe(false);
    process.env.AUTONOMOUS_ENABLED = saved;
  });

  it("generates titled opportunities with metadata", () => {
    const opp = engine.evaluate("maintenance", "Test title generation with specific category", 0.8, 0.5);
    expect(opp).not.toBeNull();
    expect(opp!.title).toContain(":");
    expect(opp!.impact).toBe(0.8);
    expect(opp!.urgency).toBe(0.5);
  });

  it("clears old opportunities when over capacity", () => {
    for (let i = 0; i < 150; i++) {
      engine.evaluate("maintenance", `Opportunity ${i}`, 0.5, 0.5);
    }
    const pending = engine.getPendingOpportunities(0);
    expect(pending.length).toBeLessThanOrEqual(100);
  });
});
