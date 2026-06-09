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
  recordWorkProduct,
  getWorkProducts,
  getWorkProductSummary,
  clearWorkProducts,
} from "../work-products";

const PRODUCTS_DIR = path.join(tmpDir, ".pi", "agent", "work-products");

describe("work-products", () => {
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    try { fs.rmSync(PRODUCTS_DIR, { recursive: true, force: true }); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(PRODUCTS_DIR, { recursive: true, force: true }); } catch {}
  });

  it("recordWorkProduct creates an entry", () => {
    const wp = recordWorkProduct("sess-1", "builder", "Build API", "/tmp/test.ts", "create", "content here");
    expect(wp.action).toBe("create");
    expect(wp.agent).toBe("builder");
    expect(wp.filePath).toBe("/tmp/test.ts");
    expect(wp.id).toBeTruthy();
  });

  it("getWorkProducts returns recent products", () => {
    recordWorkProduct("sess-1", "a1", "Task 1", "/tmp/a.ts", "create", "aaa");
    recordWorkProduct("sess-2", "a2", "Task 2", "/tmp/b.ts", "modify", "bbb");
    const all = getWorkProducts();
    expect(all.length).toBe(2);
    const filtered = getWorkProducts("sess-1");
    expect(filtered.length).toBe(1);
    expect(filtered[0].agent).toBe("a1");
  });

  it("getWorkProductSummary returns formatted summary", () => {
    recordWorkProduct("sess-1", "builder", "Task", "/tmp/f.ts", "create", "x");
    recordWorkProduct("sess-1", "builder", "Task", "/tmp/f.ts", "modify", "y");
    const summary = getWorkProductSummary("sess-1");
    expect(summary).toContain("Work Products");
    expect(summary).toContain("1 created");
    expect(summary).toContain("1 modified");
  });

  it("getWorkProductSummary returns empty message for no products", () => {
    const summary = getWorkProductSummary("nonexistent");
    expect(summary).toBe("No work products recorded.");
  });

  it("clearWorkProducts clears all with no sessionId", () => {
    recordWorkProduct("s-1", "a", "T", "/tmp/f", "create", "");
    recordWorkProduct("s-2", "b", "T", "/tmp/f", "create", "");
    const cleared = clearWorkProducts();
    expect(cleared).toBe(2);
    expect(getWorkProducts().length).toBe(0);
  });

  it("clearWorkProducts clears by sessionId", () => {
    recordWorkProduct("s-a", "a", "T", "/tmp/f", "create", "");
    recordWorkProduct("s-b", "b", "T", "/tmp/f", "create", "");
    const cleared = clearWorkProducts("s-a");
    expect(cleared).toBe(1);
    expect(getWorkProducts().length).toBe(1);
  });
});
