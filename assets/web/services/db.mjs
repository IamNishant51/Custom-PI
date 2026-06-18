// ── Persistent SQLite Connection Manager ─────────────────────────────────────
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

// Singleton map of dbPath -> better-sqlite3 connection
const dbConnections = new Map();

export function getOrCreateDb(dbPath) {
  if (dbConnections.has(dbPath)) {
    const conn = dbConnections.get(dbPath);
    try { conn.prepare("SELECT 1").get(); return conn; } catch {
      dbConnections.delete(dbPath);
    }
  }
  try {
    const Database = _require("better-sqlite3");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    dbConnections.set(dbPath, db);
    return db;
  } catch { return null; }
}

export function closeAllDbConnections() {
  for (const [path, db] of dbConnections) {
    try { db.close(); } catch {}
  }
  dbConnections.clear();
}
