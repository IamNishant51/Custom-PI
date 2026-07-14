import { describe, it, expect, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", () => ({
  visibleWidth: (s: string) => s.length,
}));

import { render } from "../tui/markdown/render";
import { stripAnsi } from "../tui/render/format";

describe("markdown renderer", () => {
  const w = 60;

  it("renders bold text", () => {
    const result = render("hello **world**", { width: w });
    expect(result.length).toBeGreaterThan(0);
    const plain = stripAnsi(result[0]);
    expect(plain).toContain("world");
  });

  it("renders italic text", () => {
    const result = render("hello *world*", { width: w });
    expect(result.length).toBeGreaterThan(0);
    const plain = stripAnsi(result[0]);
    expect(plain).toContain("world");
  });

  it("renders bold-italic text", () => {
    const result = render("hello ***world***", { width: w });
    expect(result.length).toBeGreaterThan(0);
    const plain = stripAnsi(result[0]);
    expect(plain).toContain("world");
  });

  it("renders inline code", () => {
    const result = render("use `code` here", { width: w });
    expect(result.length).toBeGreaterThan(0);
    const plain = stripAnsi(result[0]);
    expect(plain).toContain("code");
  });

  it("renders fenced code blocks", () => {
    const result = render("```ts\nconst x = 1;\n```", { width: w });
    expect(result.length).toBeGreaterThanOrEqual(3);
    const plain = stripAnsi(result.join("\n"));
    expect(plain).toContain("const x = 1;");
  });

  it("renders headers at different levels", () => {
    const h1 = render("# Title", { width: w });
    expect(h1.length).toBeGreaterThanOrEqual(2);
    const h2 = render("## Title", { width: w });
    expect(h2.length).toBeGreaterThanOrEqual(1);
    const h3 = render("### Title", { width: w });
    expect(h3.length).toBeGreaterThanOrEqual(1);
  });

  it("renders unordered lists", () => {
    const result = render("- item1\n- item2", { width: w });
    expect(result.length).toBeGreaterThanOrEqual(2);
    const plain = stripAnsi(result.join("\n"));
    expect(plain).toContain("item1");
    expect(plain).toContain("item2");
  });

  it("renders ordered lists", () => {
    const result = render("1. first\n2. second", { width: w });
    expect(result.length).toBeGreaterThanOrEqual(2);
    const plain = stripAnsi(result.join("\n"));
    expect(plain).toContain("first");
    expect(plain).toContain("second");
  });

  it("renders blockquotes", () => {
    const result = render("> quoted text", { width: w });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const plain = stripAnsi(result.join("\n"));
    expect(plain).toContain("quoted text");
  });

  it("renders tables", () => {
    const result = render("| a | b |\n| 1 | 2 |", { width: w });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const plain = stripAnsi(result.join("\n"));
    expect(plain).toContain("a");
    expect(plain).toContain("1");
  });

  it("renders links", () => {
    const result = render("[label](https://example.com)", { width: w });
    expect(result.length).toBeGreaterThan(0);
    const plain = stripAnsi(result.join("\n"));
    expect(plain).toContain("label");
    expect(plain).toContain("example.com");
  });

  it("renders horizontal rules", () => {
    const result = render("---", { width: w });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("handles unclosed fences gracefully (streaming tolerance)", () => {
    const result = render("```ts\nconst x = 1;", { width: w, streaming: true });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const plain = stripAnsi(result.join("\n"));
    expect(plain).toContain("const x = 1;");
  });

  it("handles unrecognized language code blocks", () => {
    const result = render("```unknown\nsome code\n```", { width: w });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const plain = stripAnsi(result.join("\n"));
    expect(plain).toContain("some code");
  });

  it("handles over-wide table without crashing", () => {
    const result = render("| a | b | c |\n| x | y | z |", { width: 20 });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("renders empty text", () => {
    const result = render("", { width: w });
    expect(result.length).toBe(0);
  });
});
