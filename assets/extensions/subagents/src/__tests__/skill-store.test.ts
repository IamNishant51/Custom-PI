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

import {
  saveSkill,
  getSkill,
  listSkills,
  deleteSkill,
  recordSkillUsage,
  getSkillUsage,
  getAllUsage,
  parseSkillFile,
} from "../skill-store";

const SKILLS_DIR = path.join(tmpDir, ".pi", "skills");

describe("skill-store", () => {
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    try { fs.rmSync(SKILLS_DIR, { recursive: true, force: true }); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(SKILLS_DIR, { recursive: true, force: true }); } catch {}
  });

  it("saveSkill creates a skill file", () => {
    const skill = saveSkill("test-skill", "A test skill", "## Steps\n1. Do this\n2. Do that", "agent");
    expect(skill.frontmatter.name).toBe("test-skill");
    expect(fs.existsSync(skill.filePath)).toBe(true);
  });

  it("getSkill retrieves a saved skill", () => {
    saveSkill("my-skill", "My description", "Body content", "agent");
    const retrieved = getSkill("my-skill");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.frontmatter.description).toBe("My description");
  });

  it("listSkills returns all skills", () => {
    saveSkill("skill-a", "A", "Body a", "agent");
    saveSkill("skill-b", "B", "Body b", "user");
    const all = listSkills();
    expect(all.length).toBe(2);
    const agentOnly = listSkills("agent");
    expect(agentOnly.length).toBe(1);
    expect(agentOnly[0].frontmatter.name).toBe("skill-a");
  });

  it("deleteSkill removes a skill", () => {
    saveSkill("delete-me", "To delete", "Body", "agent");
    expect(getSkill("delete-me")).not.toBeNull();
    const ok = deleteSkill("delete-me");
    expect(ok).toBe(true);
    expect(getSkill("delete-me")).toBeNull();
  });

  it("recordSkillUsage tracks usage", () => {
    saveSkill("tracked", "Tracked skill", "Body", "agent");
    recordSkillUsage("tracked", "sess-1", true);
    recordSkillUsage("tracked", "sess-2", true);
    recordSkillUsage("tracked", "sess-3", false);

    const usage = getSkillUsage("tracked");
    expect(usage).not.toBeNull();
    expect(usage!.useCount).toBe(3);
    expect(usage!.successRate).toBeCloseTo(2 / 3, 2);
    expect(usage!.sessionsUsed.length).toBe(3);
  });

  it("getAllUsage returns all records", () => {
    saveSkill("u1", "U1", "Body", "agent");
    saveSkill("u2", "U2", "Body", "agent");
    recordSkillUsage("u1", "s1", true);
    recordSkillUsage("u2", "s2", false);
    const all = getAllUsage();
    expect(Object.keys(all).length).toBe(2);
  });

  it("parseSkillFile parses YAML frontmatter", () => {
    const content = `---
name: parsed-skill
description: Parsed description
author: agent
tags:
  - test
complexity: 5
---
This is the skill body.`;
    const parsed = parseSkillFile(content, "/tmp/test.md");
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.name).toBe("parsed-skill");
    expect(parsed!.frontmatter.tags).toContain("test");
    expect(parsed!.body).toBe("This is the skill body.");
  });
});
