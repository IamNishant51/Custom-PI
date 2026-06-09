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
  vaultSet,
  vaultGet,
  vaultDelete,
  vaultList,
  vaultHas,
  vaultExists,
  vaultHealth,
} from "../secret-vault";

const VAULT_DIR = path.join(tmpDir, ".pi", "agent", ".vault");

describe("secret-vault", () => {
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    try { fs.rmSync(VAULT_DIR, { recursive: true, force: true }); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(VAULT_DIR, { recursive: true, force: true }); } catch {}
  });

  it("vaultSet and vaultGet roundtrip", () => {
    vaultSet("test-key", "hello-world-secret");
    expect(vaultGet("test-key")).toBe("hello-world-secret");
  });

  it("vaultGet returns null for missing key", () => {
    expect(vaultGet("nonexistent")).toBeNull();
  });

  it("vaultDelete removes a key", () => {
    vaultSet("delete-me", "value");
    expect(vaultHas("delete-me")).toBe(true);
    expect(vaultDelete("delete-me")).toBe(true);
    expect(vaultHas("delete-me")).toBe(false);
  });

  it("vaultDelete returns false for missing key", () => {
    expect(vaultDelete("nope")).toBe(false);
  });

  it("vaultList returns all keys", () => {
    vaultSet("a", "1");
    vaultSet("b", "2");
    vaultSet("c", "3");
    const keys = vaultList();
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    expect(keys).toContain("c");
    expect(keys.length).toBe(3);
  });

  it("vaultHas checks key existence", () => {
    expect(vaultHas("exists")).toBe(false);
    vaultSet("exists", "val");
    expect(vaultHas("exists")).toBe(true);
  });

  it("vaultExists returns false before any write", () => {
    expect(vaultExists()).toBe(false);
  });

  it("vaultExists returns true after first write", () => {
    vaultSet("x", "y");
    expect(vaultExists()).toBe(true);
  });

  it("vaultHealth returns status", () => {
    const health = vaultHealth();
    expect(health).toHaveProperty("ok");
    expect(health).toHaveProperty("message");
  });

  it("stores multiple secrets independently", () => {
    vaultSet("api-key", "sk-test123");
    vaultSet("db-pass", "s3cret!");
    expect(vaultGet("api-key")).toBe("sk-test123");
    expect(vaultGet("db-pass")).toBe("s3cret!");
  });

  it("handles empty string values", () => {
    vaultSet("empty", "");
    expect(vaultGet("empty")).toBe("");
  });
});
