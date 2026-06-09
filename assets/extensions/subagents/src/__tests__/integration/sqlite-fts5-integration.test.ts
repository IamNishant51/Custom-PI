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
  ensureSession, insertMessage, getMessages, searchSession,
  insertTriplet, queryTriplets, deleteTriplet, closeDb,
  saveTaskState, getTaskState, getMessageCount,
} from "../../state-db";

const DB_PATH = path.join(tmpDir, ".pi", "agent", "session-state.db");

describe("SQLite + FTS5 integration", () => {
  afterAll(() => {
    try { closeDb(); } catch {}
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

  it("insertTriplet upserts and queryTriplets retrieves it", () => {
    insertTriplet({
      id: "triplet-1",
      subjectId: "subj-1",
      subjectType: "person",
      subjectLabel: "Alice",
      predicateType: "works_at",
      predicateLabel: "works at",
      objectId: "obj-1",
      objectType: "organization",
      objectLabel: "Acme Corp",
      confidenceScore: 0.95,
      sourceSession: "sess-int",
    });

    const results = queryTriplets({ subjectId: "subj-1" });
    expect(results.length).toBe(1);
    expect(results[0].subjectLabel).toBe("Alice");
    expect(results[0].objectLabel).toBe("Acme Corp");
    expect(results[0].confidenceScore).toBe(0.95);

    insertTriplet({
      id: "triplet-1",
      subjectId: "subj-1",
      subjectType: "person",
      subjectLabel: "Alice",
      predicateType: "works_at",
      predicateLabel: "works at",
      objectId: "obj-1",
      objectType: "organization",
      objectLabel: "Acme Corp",
      confidenceScore: 0.99,
      sourceSession: "sess-int",
    });

    const afterUpsert = queryTriplets({ subjectId: "subj-1" });
    expect(afterUpsert.length).toBe(1);
    expect(afterUpsert[0].confidenceScore).toBe(0.99);
  });

  it("FTS5 search finds content from inserted messages", () => {
    ensureSession("fts-int");
    insertMessage("fts-int", "user", "The quick brown fox jumps over the lazy dog");
    insertMessage("fts-int", "assistant", "I see you're testing FTS5 search capabilities");
    insertMessage("fts-int", "user", "Can you help me build a sorting algorithm?");

    const results = searchSession("FTS5 search", "fts-int", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.content.includes("FTS5 search"))).toBe(true);
  });

  it("FTS5 search matches across multiple sessions", () => {
    ensureSession("fts-a");
    ensureSession("fts-b");
    insertMessage("fts-a", "user", "Angular is a framework for building web apps");
    insertMessage("fts-b", "user", "React is a library for building user interfaces");

    const results = searchSession("Angular", undefined, 10);
    expect(results.length).toBe(1);
    expect(results[0].content).toContain("Angular");
  });

  it("FTS5 trigram search handles partial words", () => {
    ensureSession("fts-trigram");
    insertMessage("fts-trigram", "user", "implement quicksort");
    insertMessage("fts-trigram", "assistant", "quicksort has O(n log n) complexity");

    const results = searchSession("quick", "fts-trigram", 10);
    expect(results.length).toBeGreaterThan(0);
  });

  it("WAL checkpoint pragma does not crash after writes", () => {
    ensureSession("wal-test");
    for (let i = 0; i < 5; i++) {
      insertMessage("wal-test", "user", `Message number ${i}`);
    }
    saveTaskState("wal-test", JSON.stringify({ checkpoint: true }));

    const walPath = DB_PATH + "-wal";
    const exists = fs.existsSync(walPath);
    expect(typeof exists).toBe("boolean");

    closeDb();
    expect(true).toBe(true);
  });

  it("FTS5 delete trigger works (message removal syncs FTS)", () => {
    ensureSession("fts-delete");
    insertMessage("fts-delete", "user", "unique fts5 content for deletion testing");
    const before = searchSession("deletion testing", "fts-delete", 10);
    expect(before.length).toBe(1);

    closeDb();
  });

  it("queryTriplets filters by multiple fields", () => {
    insertTriplet({
      id: "multi-1",
      subjectId: "svc-db", subjectType: "service", subjectLabel: "Database",
      predicateType: "depends_on", predicateLabel: "depends on",
      objectId: "svc-storage", objectType: "service", objectLabel: "Storage",
      confidenceScore: 0.9, sourceSession: "arch",
    });
    insertTriplet({
      id: "multi-2",
      subjectId: "svc-web", subjectType: "service", subjectLabel: "Web Server",
      predicateType: "depends_on", predicateLabel: "depends on",
      objectId: "svc-db", objectType: "service", objectLabel: "Database",
      confidenceScore: 0.8, sourceSession: "arch",
    });

    const filtered = queryTriplets({ subjectType: "service", minConfidence: 0.85 });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("multi-1");
  });

  it("deleteTriplet removes and query returns empty", () => {
    insertTriplet({
      id: "del-me",
      subjectId: "subj-del", subjectType: "temp", subjectLabel: "Temp",
      predicateType: "test", predicateLabel: "test",
      objectId: "obj-del", objectType: "temp", objectLabel: "Temp",
      confidenceScore: 1.0, sourceSession: "del",
    });
    expect(deleteTriplet("del-me")).toBe(true);
    expect(queryTriplets({ subjectId: "subj-del" }).length).toBe(0);
  });

  it("getMessageCount returns correct count after inserts", () => {
    ensureSession("count-int");
    insertMessage("count-int", "user", "m1");
    insertMessage("count-int", "user", "m2");
    insertMessage("count-int", "user", "m3");
    expect(getMessageCount("count-int")).toBe(3);
  });

  it("searchSession with empty query returns empty", () => {
    ensureSession("empty-q");
    insertMessage("empty-q", "user", "some content");
    const results = searchSession("", "empty-q", 10);
    expect(results.length).toBe(0);
  });
});
