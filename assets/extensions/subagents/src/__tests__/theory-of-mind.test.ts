import { describe, it, expect, beforeEach } from "vitest";
import { TheoryOfMind } from "../cognition/theory-of-mind";

describe("TheoryOfMind", () => {
  let tom: TheoryOfMind;

  beforeEach(() => {
    tom = new TheoryOfMind();
  });

  it("creates default user model", () => {
    const user = tom.getUserModel("test-user");
    expect(user.userId).toBe("test-user");
    expect(user.expertise).toBe("intermediate");
    expect(user.communicationStyle).toBe("conversational");
    expect(user.emotionalState).toBe("neutral");
    expect(user.trustLevel).toBe(0.5);
  });

  it("analyzes user message for expertise", () => {
    tom.analyzeUserMessage("user1", "Can you write a function that deploys a Docker container using async/await with TypeScript interfaces?");
    const user = tom.getUserModel("user1");
    expect(user.expertise).toBe("advanced");
  });

  it("detects frustration signals", () => {
    tom.analyzeUserMessage("user2", "Why is this not working? This bug is annoying!");
    const user = tom.getUserModel("user2");
    expect(user.emotionalState).toBe("frustrated");
  });

  it("detects urgency signals", () => {
    tom.analyzeUserMessage("user3", "Fix this ASAP, it's critical!");
    const user = tom.getUserModel("user3");
    expect(user.emotionalState).toBe("urgent");
  });

  it("detects satisfaction signals", () => {
    tom.analyzeUserMessage("user4", "Thank you, that's perfect!");
    const user = tom.getUserModel("user4");
    expect(user.emotionalState).toBe("satisfied");
  });

  it("infers communication style from message length", () => {
    tom.analyzeUserMessage("user5", "Hi");
    expect(tom.getUserModel("user5").communicationStyle).toBe("concise");

    tom.analyzeUserMessage("user5", "a".repeat(600));
    expect(tom.getUserModel("user5").communicationStyle).toBe("detailed");
  });

  it("manages preferences", () => {
    tom.updatePreference("user", "theme", "dark", "explicit");
    expect(tom.getPreference("user", "theme")).toBe("dark");

    tom.updatePreference("user", "verbose", true, "inferred");
    expect(tom.getPreference("user", "verbose")).toBe(true);
  });

  it("adjusts trust level", () => {
    tom.adjustTrust("user", 0.2);
    expect(tom.getTrustLevel("user")).toBeCloseTo(0.7, 5);

    tom.adjustTrust("user", -0.3);
    expect(tom.getTrustLevel("user")).toBeCloseTo(0.4, 5);
  });

  it("manages emotional state", () => {
    tom.setEmotionalState("user", "curious");
    expect(tom.inferEmotionalState("user")).toBe("curious");
  });

  it("tracks knowledge domains", () => {
    tom.addKnowledgeDomain("user", "TypeScript");
    tom.addKnowledgeDomain("user", "React");
    const user = tom.getUserModel("user");
    expect(user.knowledgeDomains.has("TypeScript")).toBe(true);
    expect(user.knowledgeDomains.has("React")).toBe(true);
  });

  it("provides contextual advice", () => {
    tom.setEmotionalState("user", "frustrated");
    tom.updatePreference("user", "style", "concise", "inferred");
    const advice = tom.getContextualAdvice("user");
    expect(advice).toContain("frustrated");
  });

  it("returns interaction history for new users", () => {
    const history = tom.getInteractionHistory("new-user");
    expect(history.totalInteractions).toBe(0);
    expect(history.averageCorrectionsPerSession).toBe(0);
  });
});
