import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = vi.hoisted(() => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-int-"));
  return dir;
});

vi.mock("node:os", () => {
  const actual = require("node:os");
  const ns = { ...actual, homedir: () => tmpDir };
  return { default: ns, ...ns };
});

import { store, search, consolidate, stats, remove } from "../../memory-store";
import { flushWrite, loadSync } from "../../core-store";

const MEMORY_DIR = path.join(tmpDir, ".pi", "agent", "memory");
const SEMANTIC_FILE = path.join(MEMORY_DIR, "semantic.json");

describe("memory-store CRUD + search integration", () => {
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    if (fs.existsSync(SEMANTIC_FILE)) fs.unlinkSync(SEMANTIC_FILE);
  });

  afterEach(async () => {
    await flushWrite();
    try { if (fs.existsSync(SEMANTIC_FILE)) fs.unlinkSync(SEMANTIC_FILE); } catch {}
  });

  it("stores a memory and loadSync retrieves it", async () => {
    const id = await store(
      "The project uses React 18 for the frontend",
      "fact",
      7,
      "pi-custom-pack",
      ["react", "frontend"],
    );
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");

    await flushWrite();
    const entry = loadSync().find(e => e.id === id);
    expect(entry).toBeDefined();
    expect(entry!.content).toBe("The project uses React 18 for the frontend");
  });

  it("stores multiple memories with different projects", async () => {
    const id1 = await store("PostgreSQL is the primary database", "fact", 6, "arch-db", ["db"]);
    const id2 = await store("Redis is used for caching", "fact", 6, "arch-cache", ["cache"]);
    const id3 = await store("User prefers dark mode", "preference", 5, "ui-ux", ["ux"]);
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);

    await flushWrite();
    const entries = loadSync();
    expect(entries.find(e => e.id === id1)).toBeDefined();
    expect(entries.find(e => e.id === id2)).toBeDefined();
    expect(entries.find(e => e.id === id3)).toBeDefined();
  });

  it("remove deletes a stored memory", async () => {
    const id = await store("Temporary fact to delete", "fact", 3, "test-del", ["temp"]);
    await flushWrite();

    const afterStore = loadSync().find(e => e.id === id);
    expect(afterStore).toBeDefined();

    const removed = await remove(id);
    expect(removed).toBe(true);
    await flushWrite();

    const afterRemove = loadSync().find(e => e.id === id);
    expect(afterRemove).toBeUndefined();
  });

  it("stats returns valid metrics", async () => {
    const s = stats();
    expect(s).toHaveProperty("totalEntries");
    expect(s).toHaveProperty("byType");
    expect(s).toHaveProperty("averageImportance");
  });

  it("consolidate does not crash with stored memories", async () => {
    await store("Consolidation test entry alpha", "fact", 5, "test-cons", []);
    await store("Consolidation test entry beta", "fact", 5, "test-cons", []);
    await flushWrite();

    const result = await consolidate();
    expect(result).toHaveProperty("merged");
    expect(result).toHaveProperty("pruned");
    expect(result).toHaveProperty("refreshed");
  });

  it("deduplicates exact same content on store", async () => {
    const id1 = await store("xx_UNIQUE_DUP_TEST_xx", "fact", 5, "dedup-test", []);
    const id2 = await store("xx_UNIQUE_DUP_TEST_xx", "fact", 5, "dedup-test", []);
    expect(id1).toBe(id2);

    await flushWrite();
    const entries = loadSync();
    const matches = entries.filter(e => e.content === "xx_UNIQUE_DUP_TEST_xx");
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe(id1);
  });

  it("search returns results for stored content", async () => {
    await store("Custom search test for integration verification", "fact", 7, "test-search", []);
    await flushWrite();

    const results = await search("Custom search test", 5, "test-search");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.entry.content.includes("integration verification"))).toBe(true);
  });
});
