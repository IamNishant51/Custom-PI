import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = vi.hoisted(() => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-"));
  return dir;
});

vi.mock("node:os", () => {
  const actual = require("node:os");
  const ns = { ...actual, homedir: () => tmpDir };
  return { default: ns, ...ns };
});

import { saveSkill, recordSkillUsage } from "../skill-store";
import { retrieveSkills, renderSkillProgressive, formatSkillsContextBlock } from "../skill-retrieval";

const SKILLS_DIR = path.join(tmpDir, ".pi", "skills");

describe("skill-retrieval", () => {
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    try { fs.rmSync(SKILLS_DIR, { recursive: true, force: true }); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(SKILLS_DIR, { recursive: true, force: true }); } catch {}
  });

  it("retrieveSkills returns matching skills", async () => {
    await saveSkill("react-setup", "React project setup and configuration", "Steps for React setup with Vite", "agent", ["react", "frontend"]);
    await saveSkill("api-design", "REST API design patterns", "Design REST endpoints following best practices", "agent", ["api", "backend"]);
    await saveSkill("database-migration", "Database migration patterns", "Run SQL migrations safely", "agent", ["database"]);

    const results = await retrieveSkills("react frontend", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].skill.frontmatter.name).toBe("react-setup");
  });

  it("retrieveSkills returns empty for no match", async () => {
    await saveSkill("test-skill", "Test", "Body", "agent");
    const results = await retrieveSkills("xyznonexistent12345", 5);
    expect(results.length).toBe(0);
  });

  it("retrieveSkills boosts frequently used skills", async () => {
    await saveSkill("frequent", "Frequently used skill", "Body content", "agent");
    await saveSkill("rare", "Rarely used skill", "Body content", "agent");
    await recordSkillUsage("frequent", "s1", true);
    await recordSkillUsage("frequent", "s2", true);
    await recordSkillUsage("frequent", "s3", true);

    const results = await retrieveSkills("skill", 5);
    expect(results.length).toBe(2);
    expect(results[0].skill.frontmatter.name).toBe("frequent");
    expect(results[0].useCount).toBe(3);
  });

  it("renderSkillProgressive level 0 shows truncated body", async () => {
    const skill = await saveSkill("render-test", "Render test", "A".repeat(300), "agent");
    const rendered = renderSkillProgressive(skill, 0);
    expect(rendered).toContain("render-test");
    expect(rendered.length).toBeLessThan(400);
  });

  it("formatSkillsContextBlock formats skills", async () => {
    const skill = await saveSkill("ctx-skill", "Context skill", "Body", "agent");
    await recordSkillUsage("ctx-skill", "s1", true);
    const retrieved = await retrieveSkills("context", 5);
    const block = formatSkillsContextBlock(retrieved);
    expect(block).toContain("RELEVANT SKILLS");
    expect(block).toContain("ctx-skill");
  });
});
