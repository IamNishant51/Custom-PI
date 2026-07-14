import { describe, it, expect } from "vitest";
import { THEME } from "../tui/theme/theme";
import type { ThemeColors } from "../tui/types";

describe("THEME", () => {
  it("has all required ThemeColors keys", () => {
    const keys = Object.keys(THEME) as (keyof ThemeColors)[];
    expect(keys).toContain("accent");
    expect(keys).toContain("ink");
    expect(keys).toContain("canvas");
    expect(keys).toContain("muted");
    expect(keys).toContain("surface");
    expect(keys).toContain("success");
    expect(keys).toContain("error");
    expect(keys).toContain("warning");
    expect(keys).toContain("info");
  });

  it("values are valid hex colors", () => {
    const hexKeys = Object.entries(THEME).filter(([k]) => k !== "banner") as [string, string][];
    for (const [, value] of hexKeys) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("banner is a 3-element gradient array", () => {
    expect(THEME.banner).toHaveLength(3);
    for (const color of THEME.banner) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("accent matches expected brand value", () => {
    expect(THEME.accent).toBe("#8f7af4");
  });

  it("canvas is the dark background", () => {
    expect(THEME.canvas).toBe("#0f0e15");
  });
});
