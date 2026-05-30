import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const TMP_DIR = path.join(os.tmpdir(), `pi-web-agent-test-${Date.now()}`);

// Simulates the server's agent loading (line-based YAML parse without external deps)
function parseFrontmatter(content: string): { config: Record<string, any>; body: string } | null {
  const match = content.match(/^\s*---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/);
  if (!match) return null;
  const raw = match[1];
  const body = match[2];
  const config: Record<string, any> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value: any = trimmed.slice(colonIdx + 1).trim();
    // Parse arrays: [item1, item2]
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, ""));
    }
    // Parse numbers
    else if (/^\d+$/.test(value)) value = parseInt(value, 10);
    // Parse booleans
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    // Strip surrounding quotes
    else value = value.replace(/^["']|["']$/g, "");
    config[key] = value;
  }
  return { config, body };
}

describe("Agent Loading", () => {
  const AGENTS_DIR = path.join(TMP_DIR, "agents");

  beforeAll(() => {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  });

  it("parses agent with frontmatter", () => {
    fs.writeFileSync(path.join(AGENTS_DIR, "builder.md"), `---
name: builder
description: Full-stack builder agent
tools: [read, write, bash, glob, grep]
model: gemma-4
---
You are a builder agent. Build things.
`);

    const content = fs.readFileSync(path.join(AGENTS_DIR, "builder.md"), "utf8");
    const parsed = parseFrontmatter(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.config.name).toBe("builder");
    expect(parsed!.config.description).toBe("Full-stack builder agent");
    expect(parsed!.config.tools).toEqual(["read", "write", "bash", "glob", "grep"]);
    expect(parsed!.body).toContain("builder agent");
  });

  it("handles agent files without frontmatter gracefully", () => {
    fs.writeFileSync(path.join(AGENTS_DIR, "simple.md"), "Just a description, no frontmatter.");
    const content = fs.readFileSync(path.join(AGENTS_DIR, "simple.md"), "utf8");
    const parsed = parseFrontmatter(content);
    expect(parsed).toBeNull();
  });

  it("lists agents correctly", () => {
    const agents: Record<string, any> = {};
    for (const file of fs.readdirSync(AGENTS_DIR).filter((f: string) => f.endsWith(".md"))) {
      const content = fs.readFileSync(path.join(AGENTS_DIR, file), "utf8");
      const parsed = parseFrontmatter(content);
      if (parsed) {
        agents[parsed.config.name] = parsed;
      }
    }

    const listed = Object.entries(agents).map(([name, a]: [string, any]) => ({
      name,
      description: a.config.description || "",
      tools: a.config.tools || [],
    }));

    expect(listed.length).toBeGreaterThanOrEqual(1);
    expect(listed.some((a: any) => a.name === "builder")).toBe(true);
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });
});
