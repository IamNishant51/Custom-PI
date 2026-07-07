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

  it("vaultSet and vaultGet roundtrip", async () => {
    await vaultSet("test-key", "hello-world-secret");
    expect(await vaultGet("test-key")).toBe("hello-world-secret");
  });

  it("vaultGet returns null for missing key", async () => {
    expect(await vaultGet("nonexistent")).toBeNull();
  });

  it("vaultDelete removes a key", async () => {
    await vaultSet("delete-me", "value");
    expect(await vaultHas("delete-me")).toBe(true);
    expect(await vaultDelete("delete-me")).toBe(true);
    expect(await vaultHas("delete-me")).toBe(false);
  });

  it("vaultDelete returns false for missing key", async () => {
    expect(await vaultDelete("nope")).toBe(false);
  });

  it("vaultList returns all keys", async () => {
    await vaultSet("a", "1");
    await vaultSet("b", "2");
    await vaultSet("c", "3");
    const keys = await vaultList();
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    expect(keys).toContain("c");
    expect(keys.length).toBe(3);
  });

  it("vaultHas checks key existence", async () => {
    expect(await vaultHas("exists")).toBe(false);
    await vaultSet("exists", "val");
    expect(await vaultHas("exists")).toBe(true);
  });

  it("vaultExists returns false before any write", async () => {
    expect(await vaultExists()).toBe(false);
  });

  it("vaultExists returns true after first write", async () => {
    await vaultSet("x", "y");
    expect(await vaultExists()).toBe(true);
  });

  it("vaultHealth returns status", async () => {
    const health = await vaultHealth();
    expect(health).toHaveProperty("ok");
    expect(health).toHaveProperty("message");
  });

  it("stores multiple secrets independently", async () => {
    await vaultSet("api-key", "sk-test123");
    await vaultSet("db-pass", "s3cret!");
    expect(await vaultGet("api-key")).toBe("sk-test123");
    expect(await vaultGet("db-pass")).toBe("s3cret!");
  });

  it("handles empty string values", async () => {
    await vaultSet("empty", "");
    expect(await vaultGet("empty")).toBe("");
  });
});
