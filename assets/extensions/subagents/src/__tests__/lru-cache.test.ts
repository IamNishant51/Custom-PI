import { describe, it, expect, beforeEach } from "vitest";
import { LRUCache, getCache, clearAllCaches } from "../lru-cache";

describe("LRUCache", () => {
  beforeEach(() => {
    clearAllCaches();
  });

  it("stores and retrieves values", () => {
    const cache = new LRUCache({ capacity: 10, ttlMs: 60000 });
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("returns undefined for missing keys", () => {
    const cache = new LRUCache();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts oldest entries when over capacity", () => {
    const cache = new LRUCache({ capacity: 3, ttlMs: 60000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  it("renews entry on access", () => {
    const cache = new LRUCache({ capacity: 2, ttlMs: 60000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });

  it("respects TTL", async () => {
    const cache = new LRUCache({ capacity: 10, ttlMs: 10 });
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
    await new Promise(r => setTimeout(r, 20));
    expect(cache.get("key")).toBeUndefined();
  });

  it("delete removes entry", () => {
    const cache = new LRUCache();
    cache.set("key", "value");
    cache.delete("key");
    expect(cache.get("key")).toBeUndefined();
  });

  it("clear removes all entries", () => {
    const cache = new LRUCache();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("size counts only valid entries", async () => {
    const cache = new LRUCache({ capacity: 10, ttlMs: 10 });
    cache.set("a", 1);
    cache.set("b", 2);
    await new Promise(r => setTimeout(r, 20));
    expect(cache.size).toBe(0);
  });

  it("getCache returns shared instance", () => {
    const c1 = getCache("shared", { capacity: 100 });
    const c2 = getCache("shared");
    expect(c1).toBe(c2);
  });
});
