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

import { loadSoul, getSoulPath, ensureSoulFile } from "../soul-loader";

const SOUL_PATH = path.join(tmpDir, ".pi", "agent", "SOUL.md");

describe("soul-loader", () => {
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    try {
      if (fs.existsSync(SOUL_PATH)) fs.unlinkSync(SOUL_PATH);
    } catch {}
  });

  afterEach(() => {
    try {
      if (fs.existsSync(SOUL_PATH)) fs.unlinkSync(SOUL_PATH);
    } catch {}
  });

  it("loadSoul returns default content when no file exists", async () => {
    const soul = await loadSoul();
    expect(soul).toContain("Custom-PI");
    expect(soul).toContain("autonomous AI software engineer");
  });

  it("loadSoul reads from file when it exists", async () => {
    const dir = path.dirname(SOUL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const custom = "You are a custom test identity.";
    fs.writeFileSync(SOUL_PATH, custom, "utf8");
    const soul = await loadSoul();
    expect(soul).toBe(custom);
  });

  it("getSoulPath returns correct path", () => {
    expect(getSoulPath()).toBe(SOUL_PATH);
  });

  it("ensureSoulFile creates the file if missing", async () => {
    expect(fs.existsSync(SOUL_PATH)).toBe(false);
    await ensureSoulFile();
    expect(fs.existsSync(SOUL_PATH)).toBe(true);
    const content = fs.readFileSync(SOUL_PATH, "utf8");
    expect(content).toContain("Custom-PI");
  });
});
