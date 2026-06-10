import { describe, it, expect, beforeEach } from "vitest";
import { Metacognition } from "../cognition/metacognition";

describe("Metacognition", () => {
  let metacog: Metacognition;

  beforeEach(() => {
    metacog = new Metacognition();
  });

  it("selects strategy for a task", () => {
    const strategy = metacog.selectStrategy("Write a sorting algorithm", "coding");
    expect(["cot", "tot", "react", "reflexion", "plan-execute", "auto"]).toContain(strategy);
  });

  it("records and retrieves thought history", () => {
    const id = metacog.recordThought({
      taskDescription: "Debug memory leak",
      strategyUsed: "cot",
      alternatives: ["react", "reflexion"],
      confidence: 0.8,
      uncertaintyRegions: ["heap analysis"],
      processingTimeMs: 15000,
      knowledgeGaps: ["Rust ownership"],
      success: true,
      toolCalls: 5,
      tokensUsed: 2000,
    });
    expect(id).toContain("thought_");
  });

  it("assesses confidence based on history", () => {
    metacog.recordThought({
      taskDescription: "Fix React component",
      strategyUsed: "cot",
      alternatives: [],
      confidence: 0.9,
      uncertaintyRegions: [],
      processingTimeMs: 5000,
      knowledgeGaps: [],
      success: true,
      toolCalls: 3,
      tokensUsed: 1000,
    });
    const confidence = metacog.assessConfidence("Fix another React component");
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("returns default confidence when no history", () => {
    const confidence = metacog.assessConfidence("Brand new task type");
    expect(confidence).toBe(0.5);
  });

  it("identifies knowledge gaps", () => {
    const gaps = metacog.identifyKnowledgeGaps("Deploy to Docker with Kubernetes");
    expect(Array.isArray(gaps)).toBe(true);
  });

  it("returns strategy stats", () => {
    const stats = metacog.getStrategyStats();
    expect(stats.length).toBeGreaterThan(0);
    expect(stats[0]).toHaveProperty("strategy");
    expect(stats[0]).toHaveProperty("taskCategory");
    expect(stats[0]).toHaveProperty("totalUses");
  });

  it("returns overall stats", () => {
    metacog.recordThought({
      taskDescription: "Task 1",
      strategyUsed: "cot",
      alternatives: [],
      confidence: 0.8,
      uncertaintyRegions: [],
      processingTimeMs: 1000,
      knowledgeGaps: [],
      success: true,
      toolCalls: 1,
      tokensUsed: 100,
    });
    const stats = metacog.getOverallStats();
    expect(stats.totalThoughts).toBe(1);
    expect(stats.overallSuccessRate).toBe(1);
    expect(stats.averageConfidence).toBe(0.8);
  });
});
