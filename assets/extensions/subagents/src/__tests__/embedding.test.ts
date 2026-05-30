import { describe, it, expect } from "vitest";
import { embed, cosineSimilarity } from "../memory-embedding";

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
