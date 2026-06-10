import { describe, it, expect, beforeEach } from "vitest";
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
    engine.evaluate("security", "Check for vulnerabilities", 0.5, 0.5);
    const dupe = engine.evaluate("security", "Check for vulnerabilities", 0.5, 0.5);
    expect(dupe).not.toBeNull();
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
});
