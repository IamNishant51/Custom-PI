import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";

const DB_DIR = path.join(os.homedir(), ".pi", "agent");
const DB_PATH = path.join(DB_DIR, "session-state.db");

let db: any = null;

function openDb(): any {
  if (db) return db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("cache_size = -8000");
  initializeSchema();
  return db;
}

function initializeSchema(): void {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      project TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_args TEXT,
      token_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      role UNINDEXED,
      content=messages,
      content_rowid=id,
      tokenize='trigram'
    );

    CREATE TABLE IF NOT EXISTS task_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      state_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
  `);

  // Triggers to keep FTS index in sync
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'messages_fts_%'").all();
  if (triggers.length === 0) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content, role) VALUES (new.id, new.content, new.role);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, role) VALUES('delete', old.id, old.content, old.role);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, role) VALUES('delete', old.id, old.content, old.role);
        INSERT INTO messages_fts(rowid, content, role) VALUES (new.id, new.content, new.role);
      END;
    `);
  }
}

export interface SessionRecord {
  sessionId: string;
  project: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  toolName: string | null;
  createdAt: string;
}

export interface FtsResult {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  snippet: string;
  rank: number;
}

export interface TaskStateRecord {
  sessionId: string;
  stateJson: string;
}

export function ensureSession(sessionId: string, project: string = ""): SessionRecord {
  const d = openDb();
  const existing = d.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as SessionRecord | undefined;
  if (existing) {
    d.prepare("UPDATE sessions SET updated_at = datetime('now'), project = ? WHERE session_id = ?").run(project, sessionId);
    return existing;
  }
  d.prepare("INSERT INTO sessions (session_id, project) VALUES (?, ?)").run(sessionId, project);
  return { sessionId, project, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function insertMessage(
  sessionId: string,
  role: string,
  content: string,
  toolName?: string,
  toolArgs?: string,
  tokenCount?: number,
): number {
  const d = openDb();
  ensureSession(sessionId);
  const result = d.prepare(
    "INSERT INTO messages (session_id, role, content, tool_name, tool_args, token_count) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(sessionId, role, content, toolName || null, toolArgs || null, tokenCount || 0);
  d.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE session_id = ?").run(sessionId);
  return Number(result.lastInsertRowid);
}

export function getMessages(sessionId: string, limit: number = 50, offset: number = 0): MessageRecord[] {
  const d = openDb();
  const rows = d.prepare(
    "SELECT id, session_id as sessionId, role, content, tool_name as toolName, created_at as createdAt FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?"
  ).all(sessionId, limit, offset) as MessageRecord[];
  return rows;
}

export function searchSession(query: string, sessionId?: string, k: number = 10): FtsResult[] {
  const d = openDb();
  if (!query.trim()) return [];
  const q = query.trim().replace(/'/g, "''");
  let sql: string;
  let params: any[];
  if (sessionId) {
    sql = `SELECT m.id, m.session_id as sessionId, m.role, m.content, 
                  snippet(messages_fts, 1, '<mark>', '</mark>', '...', 40) as snippet,
                  rank
           FROM messages_fts 
           JOIN messages m ON messages_fts.rowid = m.id
           WHERE messages_fts MATCH ? AND m.session_id = ?
           ORDER BY rank LIMIT ?`;
    params = [q, sessionId, k];
  } else {
    sql = `SELECT m.id, m.session_id as sessionId, m.role, m.content,
                  snippet(messages_fts, 1, '<mark>', '</mark>', '...', 40) as snippet,
                  rank
           FROM messages_fts 
           JOIN messages m ON messages_fts.rowid = m.id
           WHERE messages_fts MATCH ?
           ORDER BY rank LIMIT ?`;
    params = [q, k];
  }
  return d.prepare(sql).all(...params) as FtsResult[];
}

export function saveTaskState(sessionId: string, stateJson: string): void {
  const d = openDb();
  d.prepare(
    "INSERT INTO task_states (session_id, state_json) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET state_json = ?, updated_at = datetime('now')"
  ).run(sessionId, stateJson, stateJson);
}

export function getTaskState(sessionId: string): TaskStateRecord | null {
  const d = openDb();
  const row = d.prepare("SELECT session_id as sessionId, state_json as stateJson FROM task_states WHERE session_id = ?").get(sessionId) as TaskStateRecord | undefined;
  return row || null;
}

export function getRecentSessions(limit: number = 5): SessionRecord[] {
  const d = openDb();
  return d.prepare(
    "SELECT session_id as sessionId, project, created_at as createdAt, updated_at as updatedAt FROM sessions ORDER BY updated_at DESC LIMIT ?"
  ).all(limit) as SessionRecord[];
}

export function getMessageCount(sessionId: string): number {
  const d = openDb();
  const row = d.prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?").get(sessionId) as any;
  return row?.count || 0;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
