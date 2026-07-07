import { describe, it, expect } from "vitest";
import { serializeMessageContent, extractToolName, extractToolArgs, hasToolCalls, countToolCalls, getConversationText } from "../../utils/serialize-message";
import { AppError, ToolExecutionError, NotFoundError, ValidationError, SecurityError, ConfigurationError, DatabaseError, NetworkError, TimeoutError } from "../../errors";
import { LRUCache } from "../../lru-cache";
import { PATHS } from "../../config";
import path from "node:path";

describe("serialize-message", () => {
  it("handles string content", () => {
    expect(serializeMessageContent({ content: "hello" })).toBe("hello");
  });

  it("handles array content with text blocks", () => {
    const msg = { content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] };
    expect(serializeMessageContent(msg)).toBe("hello\nworld");
  });

  it("handles toolCall blocks", () => {
    const msg = { content: [{ type: "toolCall", name: "bash", arguments: { command: "ls" } }] };
    const result = serializeMessageContent(msg);
    expect(result).toContain("bash");
    expect(result).toContain("ls");
  });

  it("handles toolResult blocks", () => {
    const msg = { content: [{ type: "toolResult", content: [{ text: "result data" }] }] };
    const result = serializeMessageContent(msg);
    expect(result).toContain("result data");
  });

  it("returns empty string for unknown content types", () => {
    expect(serializeMessageContent({})).toBe("");
  });

  it("extractToolName finds toolCall name", () => {
    const msg = { content: [{ type: "toolCall", name: "bash" }] };
    expect(extractToolName(msg)).toBe("bash");
  });

  it("extractToolName returns null when no toolCall", () => {
    expect(extractToolName({ content: [] })).toBeNull();
  });

  it("hasToolCalls detects tool calls", () => {
    expect(hasToolCalls({ content: [{ type: "toolCall" }] })).toBe(true);
    expect(hasToolCalls({ content: [{ type: "text" }] })).toBe(false);
  });

  it("countToolCalls counts correctly", () => {
    const msg = { content: [{ type: "toolCall" }, { type: "text" }, { type: "toolCall" }] };
    expect(countToolCalls(msg)).toBe(2);
  });

  it("getConversationText formats messages with roles", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const text = getConversationText(msgs);
    expect(text).toContain("USER: hi");
    expect(text).toContain("ASSISTANT: hello");
  });

  it("getConversationText respects maxLength per message", () => {
    const msgs = [{ role: "user", content: "a".repeat(100) }];
    const text = getConversationText(msgs, 10);
    expect(text.length).toBeLessThan(20);
  });
});

describe("errors", () => {
  it("AppError has correct name and code", () => {
    const err = new AppError("test");
    expect(err.name).toBe("AppError");
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).toBe("test");
  });

  it("AppError accepts custom code", () => {
    const err = new AppError("test", "CUSTOM");
    expect(err.code).toBe("CUSTOM");
  });

  it("AppError toJSON returns structured data", () => {
    const err = new AppError("test", "CODE");
    expect(err.toJSON()).toEqual({ name: "AppError", message: "test", code: "CODE" });
  });

  it("NotFoundError includes entity type", () => {
    const err = new NotFoundError("Agent", "42");
    expect(err.message).toContain("Agent");
    expect(err.message).toContain("42");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("NotFoundError without id", () => {
    const err = new NotFoundError("Server");
    expect(err.message).toBe("Server not found");
  });

  it("ValidationError has correct code", () => {
    const err = new ValidationError("bad input");
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("SecurityError has correct code", () => {
    const err = new SecurityError("access denied");
    expect(err.code).toBe("SECURITY_ERROR");
  });

  it("ConfigurationError has correct code", () => {
    const err = new ConfigurationError("missing key");
    expect(err.code).toBe("CONFIGURATION_ERROR");
  });

  it("DatabaseError wraps cause", () => {
    const cause = new Error("disk full");
    const err = new DatabaseError("write failed", { cause });
    expect(err.code).toBe("DATABASE_ERROR");
    expect(err.cause).toBe(cause);
  });

  it("NetworkError has correct code", () => {
    const err = new NetworkError("timeout");
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("TimeoutError has correct code", () => {
    const err = new TimeoutError("deadline");
    expect(err.code).toBe("TIMEOUT_ERROR");
  });

  it("ToolExecutionError has correct code", () => {
    const err = new ToolExecutionError("crashed");
    expect(err.code).toBe("TOOL_EXECUTION_ERROR");
  });

  it("errors are instanceof AppError and Error", () => {
    const err = new NotFoundError("X");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });
});

describe("lru-cache", () => {
  it("basic set/get", () => {
    const cache = new LRUCache<string>({ capacity: 10 });
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  it("returns undefined for missing key", () => {
    const cache = new LRUCache<string>({ capacity: 10 });
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts least recently used when over capacity", () => {
    const cache = new LRUCache<string>({ capacity: 2 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3"); // should evict 'a'
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("refresh on get prevents eviction", () => {
    const cache = new LRUCache<string>({ capacity: 2 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a"); // refreshes 'a'
    cache.set("c", "3"); // should evict 'b' (LRU), not 'a'
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
  });

  it("respects ttl", async () => {
    const cache = new LRUCache<string>({ capacity: 10, ttlMs: 50 });
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
    await new Promise(r => setTimeout(r, 60));
    expect(cache.get("key")).toBeUndefined();
  });

  it("clear removes all entries", () => {
    const cache = new LRUCache<string>({ capacity: 10 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});

describe("config", () => {
  it("PATHS contains expected keys", () => {
    expect(PATHS).toHaveProperty("PI_DIR");
    expect(PATHS).toHaveProperty("SESSION_DB");
    expect(PATHS).toHaveProperty("SYSTEM_DB");
  });

  it("PATHS.PI_DIR points to .pi/agent", () => {
    expect(PATHS.PI_DIR.endsWith(path.join(".pi", "agent"))).toBe(true);
  });
});
