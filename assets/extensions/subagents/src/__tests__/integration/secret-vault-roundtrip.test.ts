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

import {
  vaultSet, vaultGet, vaultDelete, vaultList, vaultHas,
  vaultExists, vaultHealth,
} from "../../secret-vault";

const VAULT_DIR = path.join(tmpDir, ".pi", "agent", ".vault");

describe("secret-vault encrypt/decrypt round-trip", () => {
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    try { fs.rmSync(VAULT_DIR, { recursive: true, force: true }); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(VAULT_DIR, { recursive: true, force: true }); } catch {}
  });

  it("vaultSet and vaultGet round-trip returns original value", async () => {
    await vaultSet("api-key", "sk-test-secret-12345");
    expect(await vaultGet("api-key")).toBe("sk-test-secret-12345");
  });

  it("stores and retrieves multiple secrets independently", async () => {
    await vaultSet("twitter-api-key", "twitter-key-value");
    await vaultSet("openai-api-key", "sk-openai-abc123");
    await vaultSet("db-password", "p@ssw0rd!");

    expect(await vaultGet("twitter-api-key")).toBe("twitter-key-value");
    expect(await vaultGet("openai-api-key")).toBe("sk-openai-abc123");
    expect(await vaultGet("db-password")).toBe("p@ssw0rd!");
  });

  it("vaultGet returns null for non-existent key", async () => {
    expect(await vaultGet("nonexistent-key")).toBeNull();
  });

  it("vaultDelete removes a stored secret", async () => {
    await vaultSet("delete-me", "value-to-delete");
    expect(await vaultHas("delete-me")).toBe(true);
    expect(await vaultDelete("delete-me")).toBe(true);
    expect(await vaultHas("delete-me")).toBe(false);
    expect(await vaultGet("delete-me")).toBeNull();
  });

  it("vaultList returns all stored keys", async () => {
    await vaultSet("key-a", "value-a");
    await vaultSet("key-b", "value-b");
    await vaultSet("key-c", "value-c");

    const keys = await vaultList();
    expect(keys.length).toBe(3);
    expect(keys).toContain("key-a");
    expect(keys).toContain("key-b");
    expect(keys).toContain("key-c");
  });

  it("vaultExists returns false before any write", async () => {
    expect(await vaultExists()).toBe(false);
  });

  it("vaultExists returns true after first write", async () => {
    await vaultSet("first", "value");
    expect(await vaultExists()).toBe(true);
  });

  it("handles empty string values", async () => {
    await vaultSet("empty", "");
    expect(await vaultGet("empty")).toBe("");
  });

  it("handles special characters in values", async () => {
    const special = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
    await vaultSet("special", special);
    expect(await vaultGet("special")).toBe(special);
  });

  it("health check does not create ghost entries", async () => {
    await vaultSet("real-key", "real-value");
    await vaultDelete("real-key");

    const health = await vaultHealth();
    expect(health.ok).toBe(true);

    const keys = await vaultList();
    expect(keys).not.toContain("___health_check___");
    expect(keys.length).toBe(0);
  });

  it("overwriting a secret updates the value", async () => {
    await vaultSet("updatable", "original-value");
    expect(await vaultGet("updatable")).toBe("original-value");

    await vaultSet("updatable", "updated-value");
    expect(await vaultGet("updatable")).toBe("updated-value");
  });
});
