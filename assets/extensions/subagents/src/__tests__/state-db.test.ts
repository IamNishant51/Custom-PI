import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

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
  ensureSession,
  insertMessage,
  getMessages,
  searchSession,
  saveTaskState,
  getTaskState,
  getMessageCount,
  closeDb,
  getRecentSessions,
} from "../state-db";

const DB_PATH = path.join(tmpDir, ".pi", "agent", "session-state.db");

describe("state-db", () => {
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    try { fs.unlinkSync(DB_PATH + "-wal"); } catch {}
    try { fs.unlinkSync(DB_PATH + "-shm"); } catch {}
    try { fs.unlinkSync(DB_PATH); } catch {}
  });

  afterEach(() => {
    try { closeDb(); } catch {}
    try { fs.unlinkSync(DB_PATH + "-wal"); } catch {}
    try { fs.unlinkSync(DB_PATH + "-shm"); } catch {}
    try { fs.unlinkSync(DB_PATH); } catch {}
  });

  it("ensures session and returns record", () => {
    const session = ensureSession("test-session-1", "test-project");
    expect(session.sessionId).toBe("test-session-1");
    expect(session.project).toBe("test-project");
  });

  it("inserts and retrieves messages", () => {
    ensureSession("sess-2");
    insertMessage("sess-2", "user", "Hello world");
    insertMessage("sess-2", "assistant", "Hi there", undefined, undefined, 10);
    const msgs = getMessages("sess-2");
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Hello world");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("Hi there");
  });

  it("searches messages with FTS5", () => {
    ensureSession("fts-test");
    insertMessage("fts-test", "user", "How do I implement a sorting algorithm?");
    insertMessage("fts-test", "assistant", "You can use quick sort for efficient sorting.");
    insertMessage("fts-test", "user", "What about bubble sort?");
    const results = searchSession("sorting", "fts-test", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.content.includes("sorting"))).toBe(true);
  });

  it("saves and retrieves task state", () => {
    ensureSession("task-test");
    const state = JSON.stringify({ goal: "Build feature X" });
    saveTaskState("task-test", state);
    const retrieved = getTaskState("task-test");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sessionId).toBe("task-test");
    expect(JSON.parse(retrieved!.stateJson).goal).toBe("Build feature X");
  });

  it("gets message count", () => {
    ensureSession("count-test");
    insertMessage("count-test", "user", "msg1");
    insertMessage("count-test", "user", "msg2");
    expect(getMessageCount("count-test")).toBe(2);
  });

  it("searches across all sessions", () => {
    ensureSession("sess-a", "proj-a");
    ensureSession("sess-b", "proj-b");
    insertMessage("sess-a", "user", "Angular components");
    insertMessage("sess-b", "user", "React hooks");
    const results = searchSession("React", undefined, 10);
    expect(results.length).toBe(1);
    expect(results[0].content).toContain("React");
  });

  it("getRecentSessions returns sessions ordered by updated_at", () => {
    ensureSession("recent-a", "proj-a");
    insertMessage("recent-a", "user", "test");
    ensureSession("recent-b", "proj-b");
    insertMessage("recent-b", "user", "test");
    const recent = getRecentSessions(5);
    expect(recent.length).toBeGreaterThanOrEqual(2);
  });
});
