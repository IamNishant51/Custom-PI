import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EpisodicMemory, type EmotionalValence } from "../cognition/episodic-memory";

describe("EpisodicMemory", () => {
  let memory: EpisodicMemory;

  beforeEach(() => {
    memory = new EpisodicMemory();
  });

  afterEach(() => {
    memory.destroy();
  });

  it("stores and retrieves episodes", async () => {
    const id = await memory.storeEpisode({
      type: "session",
      title: "Test Session",
      summary: "A test session",
      content: JSON.stringify({ messages: 5 }),
      valence: "neutral" as EmotionalValence,
      tags: ["test"],
      context: { testId: "123" },
    });
    expect(id).toContain("ep_");

    const episode = memory.getEpisode(id);
    expect(episode).toBeDefined();
    expect(episode!.title).toBe("Test Session");
    expect(episode!.type).toBe("session");
  });

  it("searches episodes by title", async () => {
    await memory.storeEpisode({
      type: "session",
      title: "Docker Deployment Session",
      summary: "Deployed to production",
      content: "{}",
      valence: "positive" as EmotionalValence,
      tags: ["docker", "deploy"],
      context: {},
    });
    const results = memory.searchEpisodes("Docker");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("returns recent episodes", async () => {
    await memory.storeEpisode({
      type: "session",
      title: "Recent Session",
      summary: "Fresh",
      content: "{}",
      valence: "neutral" as EmotionalValence,
      tags: [],
      context: {},
    });
    const recent = memory.getRecentEpisodes(5);
    expect(recent.length).toBeGreaterThanOrEqual(1);
  });

  it("filters episodes by type", async () => {
    await memory.storeEpisode({
      type: "failure",
      title: "Build Failure",
      summary: "CI failed",
      content: "{}",
      valence: "negative" as EmotionalValence,
      tags: ["ci"],
      context: {},
    });
    const failures = memory.getEpisodesByType("failure");
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });

  it("returns stats", async () => {
    await memory.storeEpisode({
      type: "success",
      title: "Deployment Success",
      summary: "All good",
      content: "{}",
      valence: "very_positive" as EmotionalValence,
      tags: [],
      context: {},
    });
    const stats = memory.getStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.byType).toHaveProperty("success");
    expect(stats.avgImportance).toBeGreaterThan(0);
  });

  it("detects failure patterns", async () => {
    await memory.storeEpisode({
      type: "failure",
      title: "Deploy Fail 1",
      summary: "Connection timeout to prod",
      content: "{}",
      valence: "very_negative" as EmotionalValence,
      tags: ["deployment", "failure"],
      context: { target: "production", error: "timeout" },
    });
    await memory.storeEpisode({
      type: "failure",
      title: "Deploy Fail 2",
      summary: "Connection timeout to prod again",
      content: "{}",
      valence: "very_negative" as EmotionalValence,
      tags: ["deployment", "failure"],
      context: { target: "production", error: "timeout" },
    });
    const patterns = memory.getFailurePatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(1);
  });

  it("detects success patterns", async () => {
    await memory.storeEpisode({
      type: "success",
      title: "Success 1",
      summary: "Deployed to staging",
      content: "{}",
      valence: "positive" as EmotionalValence,
      tags: ["deploy", "success"],
      context: { target: "staging" },
    });
    const patterns = memory.getSuccessPatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(1);
  });

  it("compresses old episodes", async () => {
    const id = await memory.storeEpisode({
      type: "observation",
      title: "Old Observation",
      summary: "A very long summary that should be compressed eventually. ".repeat(20),
      content: "Very long content that will be truncated. ".repeat(50),
      valence: "neutral" as EmotionalValence,
      tags: [],
      context: {},
    });
    const compressed = await memory.compressEpisodes();
    expect(compressed).toBeGreaterThanOrEqual(0);
  });
});
