import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ensureMemoryFiles,
  memoryWrite,
  readMemoryRaw,
  loadMemorySnapshot,
  memoryConsolidate,
  getMemoryStats,
} from "../memory-file-store";

const TEST_MEMORIES_DIR = path.join(os.homedir(), ".pi", "agent", "memories");

describe("memory-file-store", () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_MEMORIES_DIR)) fs.mkdirSync(TEST_MEMORIES_DIR, { recursive: true });
    fs.writeFileSync(path.join(TEST_MEMORIES_DIR, "MEMORY.md"), "", "utf8");
    fs.writeFileSync(path.join(TEST_MEMORIES_DIR, "USER.md"), "", "utf8");
  });

  afterEach(() => {
    try {
      fs.rmSync(TEST_MEMORIES_DIR, { recursive: true, force: true });
    } catch {}
  });

  it("ensureMemoryFiles creates files if missing", () => {
    fs.rmSync(TEST_MEMORIES_DIR, { recursive: true, force: true });
    ensureMemoryFiles();
    expect(fs.existsSync(path.join(TEST_MEMORIES_DIR, "MEMORY.md"))).toBe(true);
    expect(fs.existsSync(path.join(TEST_MEMORIES_DIR, "USER.md"))).toBe(true);
  });

  it("memoryWrite adds entries", () => {
    const r1 = memoryWrite("add", "memory", "The project uses React 18");
    expect(r1.success).toBe(true);
    const content = readMemoryRaw("memory");
    expect(content).toContain("React 18");
  });

  it("memoryWrite rejects duplicate entries", () => {
    memoryWrite("add", "memory", "Duplicate entry");
    const r2 = memoryWrite("add", "memory", "Duplicate entry");
    expect(r2.success).toBe(false);
    expect(r2.message).toContain("already exists");
  });

  it("memoryWrite adds to user target", () => {
    memoryWrite("add", "user", "User prefers tabs over spaces");
    const content = readMemoryRaw("user");
    expect(content).toContain("tabs over spaces");
  });

  it("memoryWrite removes entries", () => {
    memoryWrite("add", "memory", "Thing to remove");
    const result = memoryWrite("remove", "memory", "", "Thing to remove");
    expect(result.success).toBe(true);
    const content = readMemoryRaw("memory");
    expect(content).not.toContain("Thing to remove");
  });

  it("memoryWrite replace works", () => {
    memoryWrite("add", "memory", "Old content");
    const result = memoryWrite("replace", "memory", "New content", "Old content");
    expect(result.success).toBe(true);
    const content = readMemoryRaw("memory");
    expect(content).toContain("New content");
    expect(content).not.toContain("Old content");
  });

  it("loadMemorySnapshot returns correct structure", () => {
    memoryWrite("add", "memory", "Test fact");
    memoryWrite("add", "user", "Test preference");
    const snap = loadMemorySnapshot();
    expect(snap.memory).toContain("Test fact");
    expect(snap.user).toContain("Test preference");
    expect(typeof snap.memoryCapacityPct).toBe("number");
    expect(typeof snap.userCapacityPct).toBe("number");
  });

  it("getMemoryStats returns valid stats", () => {
    const stats = getMemoryStats();
    expect(stats).toHaveProperty("memoryChars");
    expect(stats).toHaveProperty("userChars");
    expect(stats).toHaveProperty("memoryMax");
    expect(stats).toHaveProperty("userMax");
    expect(stats.memoryMax).toBeGreaterThan(0);
    expect(stats.userMax).toBeGreaterThan(0);
  });

  it("memoryConsolidate handles empty files", async () => {
    const result = await memoryConsolidate("memory");
    expect(result.beforeChars).toBe(0);
  });
});
