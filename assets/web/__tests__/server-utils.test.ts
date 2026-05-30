import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

// Re-implement minimal versions of the server functions for testing
const TMP_DIR = path.join(os.tmpdir(), `pi-web-test-${Date.now()}`);

function makeServerUtils(piDir: string) {
  const VAULT_DIR = path.join(piDir, ".vault");
  const KEY_FILE = path.join(VAULT_DIR, "master.key");
  const VAULT_FILE = path.join(VAULT_DIR, "vault.json");
  const MEMORY_FILE = path.join(piDir, "memory", "semantic.json");
  const COST_FILE = path.join(piDir, "costs", "session-costs.jsonl");
  const PRODUCTS_FILE = path.join(piDir, "work-products", "products.jsonl");

  function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true }); }

  function getMasterKey() {
    ensureDir(VAULT_DIR);
    if (!fs.existsSync(KEY_FILE)) {
      const key = crypto.randomBytes(32);
      fs.writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
    }
    return Buffer.from(fs.readFileSync(KEY_FILE, "utf8").trim(), "hex");
  }

  function encrypt(text: string) {
    const key = getMasterKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let enc = cipher.update(text, "utf8", "hex");
    enc += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");
    return JSON.stringify({ iv: iv.toString("hex"), data: enc, tag });
  }

  function decrypt(payload: string) {
    const { iv, data, tag } = JSON.parse(payload);
    const key = getMasterKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    let dec = decipher.update(data, "hex", "utf8");
    dec += decipher.final("utf8");
    return dec;
  }

  function readVault(): Record<string, string> {
    ensureDir(VAULT_DIR);
    try { return JSON.parse(fs.readFileSync(VAULT_FILE, "utf8")); }
    catch { return {}; }
  }

  function writeVault(data: Record<string, string>) {
    ensureDir(VAULT_DIR);
    fs.writeFileSync(VAULT_FILE, JSON.stringify(data, null, 2));
  }

  function vaultSet(key: string, value: string) {
    const v = readVault();
    v[key] = encrypt(value);
    writeVault(v);
  }

  function vaultGet(key: string) {
    const v = readVault();
    if (!v[key]) return null;
    try { return decrypt(v[key]); } catch { return null; }
  }

  function vaultDelete(key: string) {
    const v = readVault();
    if (!v[key]) return false;
    delete v[key];
    writeVault(v);
    return true;
  }

  function vaultList(): string[] {
    return Object.keys(readVault());
  }

  function memoryStore(content: string, type: string, importance: number, project: string, tags: string[]) {
    ensureDir(path.dirname(MEMORY_FILE));
    const entries = (() => { try { return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")); } catch { return []; } })();
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    entries.push({ id, content, type, importance, project, tags, createdAt: Date.now(), accessCount: 0 });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(entries, null, 2));
    return id;
  }

  function memorySearch(query: string, k = 5) {
    let entries: any[] = [];
    try { entries = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")); } catch { return []; }
    const tokens = query.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
    if (!tokens.length) return [];
    const scored = entries.map((entry: any) => {
      const lower = entry.content.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (lower.includes(token)) score += 1;
        if (lower.startsWith(token)) score += 0.5;
      }
      if (entry.type === "skill") score += 0.5;
      score += (entry.importance || 1) * 0.1;
      score += (entry.accessCount || 0) * 0.05;
      return { entry, score: Math.min(score / tokens.length, 1) };
    });
    scored.sort((a: any, b: any) => b.score - a.score);
    return scored.slice(0, k);
  }

  function memoryStats() {
    let entries: any[] = [];
    try { entries = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")); } catch { return { totalEntries: 0, byType: {}, averageImportance: "0" }; }
    const byType: Record<string, number> = {};
    for (const e of entries) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    const avgImp = entries.length ? entries.reduce((s: number, e: any) => s + (e.importance || 5), 0) / entries.length : 0;
    return { totalEntries: entries.length, byType, averageImportance: avgImp.toFixed(1) };
  }

  function trackCost(sessionId: string, agent: string, provider: string, modelId: string, inputTokens: number, outputTokens: number) {
    ensureDir(path.dirname(COST_FILE));
    const rate = { input: 1, output: 2 };
    const costUsd = (inputTokens / 1_000_000 * rate.input) + (outputTokens / 1_000_000 * rate.output);
    const event = { sessionId, agent, provider, modelId, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd, timestamp: new Date().toISOString() };
    fs.appendFileSync(COST_FILE, JSON.stringify(event) + "\n");
    return event;
  }

  function getCostSummary() {
    try {
      if (!fs.existsSync(COST_FILE)) return { totalSessions: 0, totalTokens: 0, totalCostUsd: 0, dailyTokens: 0, dailyCostUsd: 0 };
      const lines = fs.readFileSync(COST_FILE, "utf8").trim().split("\n").filter(Boolean);
      const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const today = new Date().toISOString().slice(0, 10);
      const daily = all.filter((e: any) => e.timestamp.startsWith(today));
      return {
        totalSessions: new Set(all.map((e: any) => e.sessionId)).size,
        totalTokens: all.reduce((s: number, e: any) => s + e.totalTokens, 0),
        totalCostUsd: all.reduce((s: number, e: any) => s + e.costUsd, 0),
        dailyTokens: daily.reduce((s: number, e: any) => s + e.totalTokens, 0),
        dailyCostUsd: daily.reduce((s: number, e: any) => s + e.costUsd, 0),
      };
    } catch { return { totalSessions: 0, totalTokens: 0, totalCostUsd: 0, dailyTokens: 0, dailyCostUsd: 0 }; }
  }

  function recordWorkProduct(sessionId: string, agent: string, task: string, filePath: string, action: string, content: string) {
    ensureDir(path.dirname(PRODUCTS_FILE));
    const hash = crypto.createHash("sha256").update(content || "").digest("hex").slice(0, 12);
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, sessionId, agent, task, filePath, action, hash, size: (content || "").length, timestamp: new Date().toISOString() };
    fs.appendFileSync(PRODUCTS_FILE, JSON.stringify(entry) + "\n");
    return entry;
  }

  function getWorkProducts(sessionId?: string) {
    try {
      if (!fs.existsSync(PRODUCTS_FILE)) return [];
      const lines = fs.readFileSync(PRODUCTS_FILE, "utf8").trim().split("\n").filter(Boolean);
      const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (sessionId) return all.filter((e: any) => e.sessionId === sessionId).slice(-100);
      return all.slice(-100);
    } catch { return []; }
  }

  return { vaultSet, vaultGet, vaultDelete, vaultList, memoryStore, memorySearch, memoryStats, trackCost, getCostSummary, recordWorkProduct, getWorkProducts };
}

describe("Web Server Utilities", () => {
  const piDir = path.join(TMP_DIR, "pi");
  const utils = makeServerUtils(piDir);

  beforeAll(() => {
    fs.mkdirSync(piDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  describe("Vault", () => {
    it("should set and get a secret", () => {
      utils.vaultSet("TEST_KEY", "test-value-123");
      expect(utils.vaultGet("TEST_KEY")).toBe("test-value-123");
    });

    it("should list keys", () => {
      utils.vaultSet("KEY_A", "val_a");
      utils.vaultSet("KEY_B", "val_b");
      const keys = utils.vaultList();
      expect(keys).toContain("KEY_A");
      expect(keys).toContain("KEY_B");
    });

    it("should return null for missing key", () => {
      expect(utils.vaultGet("NONEXISTENT")).toBeNull();
    });

    it("should delete a secret", () => {
      utils.vaultSet("DELETE_ME", "to-delete");
      expect(utils.vaultGet("DELETE_ME")).toBe("to-delete");
      expect(utils.vaultDelete("DELETE_ME")).toBe(true);
      expect(utils.vaultGet("DELETE_ME")).toBeNull();
    });

    it("should handle delete of missing key gracefully", () => {
      expect(utils.vaultDelete("ALREADY_GONE")).toBe(false);
    });

    it("should handle duplicates without error", () => {
      utils.vaultSet("DUP", "first");
      utils.vaultSet("DUP", "second");
      expect(utils.vaultGet("DUP")).toBe("second");
    });
  });

  describe("Memory", () => {
    it("should store and search memory", () => {
      utils.memoryStore("The sky is blue", "fact", 3, "test", ["weather"]);
      utils.memoryStore("User prefers dark mode", "preference", 7, "test", ["ui"]);
      utils.memoryStore("TypeScript is compiled to JavaScript", "fact", 5, "test", ["lang"]);

      const results = utils.memorySearch("sky", 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].entry.content).toContain("sky");
    });

    it("should rank by relevance", () => {
      utils.memoryStore("Python is a programming language", "fact", 2, "test", []);
      utils.memoryStore("JavaScript runs in the browser", "fact", 8, "test", []);

      const results = utils.memorySearch("javascript programming", 5);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].entry.content.toLowerCase()).toContain("javascript");
    });

    it("should respect k parameter", () => {
      const results = utils.memorySearch("fact", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should return stats", () => {
      const stats = utils.memoryStats();
      expect(stats.totalEntries).toBeGreaterThan(0);
      expect(stats.byType).toHaveProperty("fact");
      expect(Number(stats.averageImportance)).toBeGreaterThan(0);
    });
  });

  describe("Cost Tracking", () => {
    it("should track a cost event", () => {
      const event = utils.trackCost("session-1", "agent-1", "lmstudio", "gemma-4", 100, 50);
      expect(event.sessionId).toBe("session-1");
      expect(event.totalTokens).toBe(150);
      expect(event.costUsd).toBeGreaterThan(0);
    });

    it("should return cost summary", () => {
      const summary = utils.getCostSummary();
      expect(summary.totalSessions).toBeGreaterThanOrEqual(1);
      expect(summary.totalTokens).toBeGreaterThan(0);
      expect(summary.totalCostUsd).toBeGreaterThan(0);
    });
  });

  describe("Work Products", () => {
    it("should record a work product", () => {
      const wp = utils.recordWorkProduct("sess-1", "agent-x", "Fix bug", "/src/foo.ts", "create", "console.log('hello')");
      expect(wp.action).toBe("create");
      expect(wp.filePath).toBe("/src/foo.ts");
    });

    it("should list work products", () => {
      utils.recordWorkProduct("sess-2", "agent-y", "Refactor", "/src/bar.ts", "modify", "updated content");
      const products = utils.getWorkProducts();
      expect(products.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter by sessionId", () => {
      const products = utils.getWorkProducts("sess-2");
      expect(products.every((p: any) => p.sessionId === "sess-2")).toBe(true);
    });
  });
});
