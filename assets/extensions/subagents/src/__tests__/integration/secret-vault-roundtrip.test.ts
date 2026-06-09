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

  it("vaultSet and vaultGet round-trip returns original value", () => {
    vaultSet("api-key", "sk-test-secret-12345");
    expect(vaultGet("api-key")).toBe("sk-test-secret-12345");
  });

  it("stores and retrieves multiple secrets independently", () => {
    vaultSet("twitter-api-key", "twitter-key-value");
    vaultSet("openai-api-key", "sk-openai-abc123");
    vaultSet("db-password", "p@ssw0rd!");

    expect(vaultGet("twitter-api-key")).toBe("twitter-key-value");
    expect(vaultGet("openai-api-key")).toBe("sk-openai-abc123");
    expect(vaultGet("db-password")).toBe("p@ssw0rd!");
  });

  it("vaultGet returns null for non-existent key", () => {
    expect(vaultGet("nonexistent-key")).toBeNull();
  });

  it("vaultDelete removes a stored secret", () => {
    vaultSet("delete-me", "value-to-delete");
    expect(vaultHas("delete-me")).toBe(true);
    expect(vaultDelete("delete-me")).toBe(true);
    expect(vaultHas("delete-me")).toBe(false);
    expect(vaultGet("delete-me")).toBeNull();
  });

  it("vaultList returns all stored keys", () => {
    vaultSet("key-a", "value-a");
    vaultSet("key-b", "value-b");
    vaultSet("key-c", "value-c");

    const keys = vaultList();
    expect(keys.length).toBe(3);
    expect(keys).toContain("key-a");
    expect(keys).toContain("key-b");
    expect(keys).toContain("key-c");
  });

  it("vaultExists returns false before any write", () => {
    expect(vaultExists()).toBe(false);
  });

  it("vaultExists returns true after first write", () => {
    vaultSet("first", "value");
    expect(vaultExists()).toBe(true);
  });

  it("handles empty string values", () => {
    vaultSet("empty", "");
    expect(vaultGet("empty")).toBe("");
  });

  it("handles special characters in values", () => {
    const special = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
    vaultSet("special", special);
    expect(vaultGet("special")).toBe(special);
  });

  it("health check does not create ghost entries", () => {
    vaultSet("real-key", "real-value");
    vaultDelete("real-key");

    const health = vaultHealth();
    expect(health.ok).toBe(true);

    const keys = vaultList();
    expect(keys).not.toContain("___health_check___");
    expect(keys.length).toBe(0);
  });

  it("overwriting a secret updates the value", () => {
    vaultSet("updatable", "original-value");
    expect(vaultGet("updatable")).toBe("original-value");

    vaultSet("updatable", "updated-value");
    expect(vaultGet("updatable")).toBe("updated-value");
  });
});
