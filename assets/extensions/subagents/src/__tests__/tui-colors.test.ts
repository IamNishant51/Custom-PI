import { describe, it, expect } from "vitest";
import { C } from "../tui-colors";

describe("tui-colors", () => {
  it("has all required color keys", () => {
    const keys = Object.keys(C);
    expect(keys).toContain("orange");
    expect(keys).toContain("night");
    expect(keys).toContain("dusty");
    expect(keys).toContain("slate");
    expect(keys).toContain("charcoal");
  });

  it("values are valid hex colors", () => {
    for (const value of Object.values(C)) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("has exactly expected keys", () => {
    expect(Object.keys(C).length).toBe(20);
  });
});
