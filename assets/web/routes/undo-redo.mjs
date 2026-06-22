import path from "node:path";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

export default function registerUndoRedo(app, { PI_DIR }) {
  const DB_PATH = path.join(PI_DIR, "action-log.db");

  function getDb() {
    try {
      const Database = _require("better-sqlite3");
      const db = new Database(DB_PATH);
      db.pragma("journal_mode = WAL");
      db.exec(`
        CREATE TABLE IF NOT EXISTS action_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          description TEXT,
          data TEXT,
          inverse_data TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `);
      return db;
    } catch { return null; }
  }

  function logAction(type, entityType, entityId, description, data, inverseData) {
    const db = getDb();
    if (!db) return null;
    const stmt = db.prepare(`
      INSERT INTO action_log (type, entity_type, entity_id, description, data, inverse_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(type, entityType, entityId || null, description, data ? JSON.stringify(data) : null, inverseData ? JSON.stringify(inverseData) : null);
    // Keep max 200 actions, delete oldest
    db.prepare("DELETE FROM action_log WHERE id NOT IN (SELECT id FROM action_log ORDER BY id DESC LIMIT 200)").run();
    db.close();
    return result.lastInsertRowid;
  }

  app.post("/api/undo/log", { schema: { body: { type: "object", additionalProperties: true, properties: { type: { type: "string" }, entityType: { type: "string" }, entityId: { type: "string" }, description: { type: "string" }, data: { type: "object" }, inverseData: { type: "object" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, id: { type: "number" }, error: { type: "string" } } } } } }, async (req) => {
    const { type, entityType, entityId, description, data, inverseData } = req.body || {};
    if (!type || !entityType) return { error: "type and entityType required" };
    const id = logAction(type, entityType, entityId, description, data, inverseData);
    return { ok: true, id };
  });

  app.get("/api/undo/history", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, actions: { type: "array", items: { type: "object" } } } } } }, async (req) => {
    const db = getDb();
    if (!db) return { ok: false, actions: [] };
    const limit = Math.min(Number(req.query?.limit) || 50, 200);
    const rows = db.prepare("SELECT * FROM action_log ORDER BY id DESC LIMIT ?").all(limit);
    db.close();
    return { ok: true, actions: rows.map(r => ({ ...r, data: r.data ? JSON.parse(r.data) : null, inverse_data: r.inverse_data ? JSON.parse(r.inverse_data) : null })) };
  });

  app.post("/api/undo/execute", { schema: { body: { type: "object", additionalProperties: true, properties: { id: { type: "number" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, type: { type: "string" }, data: { type: "object" }, description: { type: "string" }, error: { type: "string" } } } } } }, async (req) => {
    const { id } = req.body || {};
    if (!id) return { error: "id required" };
    const db = getDb();
    if (!db) return { ok: false, error: "Database unavailable" };
    const action = db.prepare("SELECT * FROM action_log WHERE id = ?").get(id);
    db.close();
    if (!action) return { error: "Action not found" };
    const inverseData = action.inverse_data ? JSON.parse(action.inverse_data) : null;
    return { ok: true, type: action.entity_type, data: inverseData, description: `Undo: ${action.description}` };
  });

  app.get("/api/undo/last", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, action: { type: "object", nullable: true } } } } } }, async () => {
    const db = getDb();
    if (!db) return { ok: false, action: null };
    const action = db.prepare("SELECT * FROM action_log ORDER BY id DESC LIMIT 1").get();
    db.close();
    if (!action) return { ok: false, action: null };
    return { ok: true, action: { ...action, data: action.data ? JSON.parse(action.data) : null, inverse_data: action.inverse_data ? JSON.parse(action.inverse_data) : null } };
  });

  return { logAction };
}
