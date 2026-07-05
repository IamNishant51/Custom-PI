import { describe, it, expect, vi } from "vitest";
import { embed, cosineSimilarity } from "../memory-embedding";

describe("embed", () => {
  it("returns a vector for normal text", async () => {
    const result = await embed("hello world");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns 64-dimensional vector from fallback when no embedding service", async () => {
    const result = await embed("test text");
    expect(result.length).toBe(64);
  });

  it("is deterministic for the same text", async () => {
    const [a, b] = await Promise.all([embed("same text"), embed("same text")]);
    expect(a).toEqual(b);
  });

  it("returns a unit vector (magnitude ≈ 1)", async () => {
    const result = await embed("normalize check");
    const mag = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1, 5);
  });

  it("caches embeddings and returns cached value", async () => {
    const first = await embed("cache test");
    vi.mocked(fetch).mockClear();
    const second = await embed("cache test");
    expect(second).toEqual(first);
  });

  it("handles empty string", async () => {
    const result = await embed("");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(64);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it("handles zero-magnitude vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("is commutative", () => {
    const a = [3, 1, 4, 1, 5];
    const b = [2, 7, 1, 8, 2];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});
