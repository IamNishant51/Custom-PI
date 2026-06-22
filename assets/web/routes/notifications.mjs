import path from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

export default function registerNotifications(app, { PI_DIR, sendError }) {
  const DB_PATH = path.join(PI_DIR, "notifications.db");

  function getDb() {
    try {
      const Database = _require("better-sqlite3");
      const db = new Database(DB_PATH);
      db.pragma("journal_mode = WAL");
      db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          data TEXT,
          read INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `);
      return db;
    } catch { return null; }
  }

  function notify(type, title, body, data) {
    try {
      const db = getDb();
      if (!db) return;
      const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(`
        INSERT INTO notifications (id, type, title, body, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, type, title, body || null, data ? JSON.stringify(data) : null, Date.now());
      db.close();
    } catch {} // Ignored
  }

  app.get("/api/notifications", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, notifications: { type: "array", items: { type: "object" } } } } } } }, async (req) => {
    const db = getDb();
    if (!db) return { ok: false, notifications: [] };
    const unreadFirst = req.query?.unread_first !== "false";
    const limit = Math.min(Number(req.query?.limit) || 50, 200);
    const rows = db.prepare(`
      SELECT * FROM notifications
      ORDER BY ${unreadFirst ? "read ASC," : ""} created_at DESC
      LIMIT ?
    `).all(limit);
    db.close();
    return { ok: true, notifications: rows.map(r => ({ ...r, data: r.data ? JSON.parse(r.data) : null })) };
  });

  app.post("/api/notifications/:id/read", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } } } }, async (req) => {
    const db = getDb();
    if (!db) return { ok: false };
    db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(req.params.id);
    db.close();
    return { ok: true };
  });

  app.post("/api/notifications/read-all", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } } } }, async () => {
    const db = getDb();
    if (!db) return { ok: false };
    db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run();
    db.close();
    return { ok: true };
  });

  app.get("/api/notifications/unread-count", { schema: { response: { 200: { type: "object", properties: { count: { type: "number" } } } } } }, async () => {
    const db = getDb();
    if (!db) return { count: 0 };
    const row = db.prepare("SELECT COUNT(*) as count FROM notifications WHERE read = 0").get();
    db.close();
    return { count: row?.count || 0 };
  });

  return { notify };
}
