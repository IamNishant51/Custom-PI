import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");

const MIGRATIONS = [
  {
    id: "001_initial_schema",
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )`);
    },
  },
  {
    id: "002_rate_limits",
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS rate_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route TEXT NOT NULL,
        method TEXT NOT NULL,
        client_ip TEXT,
        breached INTEGER DEFAULT 0,
        count INTEGER DEFAULT 0,
        last_checked INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )`);
    },
  },
  {
    id: "003_notifications",
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)`);
    },
  },
  {
    id: "004_feature_flags",
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS feature_flags (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT 'off',
        description TEXT,
        updated_at INTEGER NOT NULL
      )`);
    },
  },
];

let _migrationDb = null;

export function initMigrations(stateDb) {
  _migrationDb = stateDb;
  try {
    stateDb.exec(`CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`);
    const applied = new Set(
      stateDb.prepare("SELECT id FROM _migrations").all().map(r => r.id)
    );
    const pending = MIGRATIONS.filter(m => !applied.has(m.id));
    for (const m of pending) {
      try {
        m.up(stateDb);
        stateDb.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(m.id, Date.now());
        console.log(`[migrations] Applied: ${m.id}`);
      } catch (err) {
        console.error(`[migrations] Failed ${m.id}:`, err.message);
        throw err;
      }
    }
    if (pending.length === 0) console.log("[migrations] All up to date");
    return { applied: applied.size, pending: pending.length };
  } catch (err) {
    console.error("[migrations] Init failed:", err.message);
    return { error: err.message };
  }
}

export function getMigrationStatus() {
  if (!_migrationDb) return { error: "Migrations not initialized" };
  try {
    const applied = _migrationDb.prepare("SELECT id, applied_at FROM _migrations ORDER BY applied_at").all();
    return { applied, pending: MIGRATIONS.filter(m => !applied.find(a => a.id === m.id)).map(m => m.id) };
  } catch { return { error: "Failed to get status" }; }
}
