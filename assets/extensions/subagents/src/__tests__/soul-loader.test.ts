import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadSoul, getSoulPath, ensureSoulFile } from "../soul-loader";

const SOUL_PATH = path.join(os.homedir(), ".pi", "agent", "SOUL.md");

describe("soul-loader", () => {
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

  it("loadSoul returns default content when no file exists", () => {
    const soul = loadSoul();
    expect(soul).toContain("Custom-PI");
    expect(soul).toContain("autonomous AI software engineer");
  });

  it("loadSoul reads from file when it exists", () => {
    const dir = path.dirname(SOUL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const custom = "You are a custom test identity.";
    fs.writeFileSync(SOUL_PATH, custom, "utf8");
    const soul = loadSoul();
    expect(soul).toBe(custom);
  });

  it("getSoulPath returns correct path", () => {
    expect(getSoulPath()).toBe(SOUL_PATH);
  });

  it("ensureSoulFile creates the file if missing", () => {
    expect(fs.existsSync(SOUL_PATH)).toBe(false);
    ensureSoulFile();
    expect(fs.existsSync(SOUL_PATH)).toBe(true);
    const content = fs.readFileSync(SOUL_PATH, "utf8");
    expect(content).toContain("Custom-PI");
  });
});
