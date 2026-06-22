import path from "node:path";
import crypto from "node:crypto";
import { getOrCreateDb } from "../services/db.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;
const SESSIONS_DB_PATH = path.join(PI_DIR, "sessions.db");

function getSessionsDb() {
  try {
    const db = getOrCreateDb(SESSIONS_DB_PATH);
    if (!db) return null;
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        model_id TEXT DEFAULT '',
        preset TEXT DEFAULT '',
        token_count INTEGER DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    return db;
  } catch { return null; }
}

export default function registerSessions(app, { sendError }) {
  app.get("/api/sessions", { schema: { response: { 200: { type: "object", properties: { sessions: { type: "array", items: { type: "object" } } } } } } }, async (req) => {
    const db = getSessionsDb();
    if (!db) return { sessions: [] };
    const includeArchived = req.query?.archived === "true";
    const rows = db.prepare(`
      SELECT id, title, model_id, preset, token_count, message_count,
             created_at AS createdAt, updated_at AS updatedAt, archived
      FROM sessions
      WHERE archived ${includeArchived ? "IN (0,1)" : "= 0"}
      ORDER BY updated_at DESC
      LIMIT 100
    `).all();
    return { sessions: rows };
  });

  app.post("/api/sessions", { schema: { body: { type: "object", additionalProperties: true, properties: { title: { type: "string" }, modelId: { type: "string" } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" }, id: { type: "string" }, error: { type: "string" } } } } } }, async (req) => {
    const db = getSessionsDb();
    if (!db) return { error: "Database unavailable" };
    const { title, modelId } = req.body || {};
    const id = `session_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, title, model_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, title || "New Chat", modelId || "", now, now);
    return { success: true, id };
  });

  app.put("/api/sessions/:id", { schema: { body: { type: "object", additionalProperties: true, properties: { title: { type: "string" }, archived: { type: "boolean" } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } } } }, async (req) => {
    const db = getSessionsDb();
    if (!db) return { error: "Database unavailable" };
    const { id } = req.params;
    const updates = req.body || {};
    const fields = [];
    const values = [];
    if (updates.title !== undefined) { fields.push("title = ?"); values.push(updates.title); }
    if (updates.archived !== undefined) { fields.push("archived = ?"); values.push(updates.archived ? 1 : 0); }
    if (fields.length === 0) return { error: "No fields to update" };
    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);
    db.prepare(`UPDATE sessions SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return { success: true };
  });

  app.delete("/api/sessions/:id", { schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } } } }, async (req) => {
    const db = getSessionsDb();
    if (!db) return { error: "Database unavailable" };
    const { id } = req.params;
    db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return { success: true };
  });

  app.get("/api/sessions/:id/messages", { schema: { response: { 200: { type: "object", properties: { messages: { type: "array", items: { type: "object" } } } } } } }, async (req) => {
    const db = getSessionsDb();
    if (!db) return { messages: [] };
    const { id } = req.params;
    const rows = db.prepare(`
      SELECT id, role, content, created_at AS createdAt
      FROM session_messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(id);
    return { messages: rows };
  });

  app.post("/api/sessions/:id/messages", { schema: { body: { type: "object", additionalProperties: true, properties: { role: { type: "string" }, content: { type: "string" } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" }, id: { type: "string" }, error: { type: "string" } } } } } }, async (req) => {
    const db = getSessionsDb();
    if (!db) return { error: "Database unavailable" };
    const { id } = req.params;
    const { role, content } = req.body || {};
    if (!role || !content) return { error: "role and content required" };
    const msgId = `msg_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const now = Date.now();
    db.prepare(`
      INSERT INTO session_messages (id, session_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(msgId, id, role, content, now);
    db.prepare(`
      UPDATE sessions SET message_count = message_count + 1, token_count = token_count + ?, updated_at = ?
      WHERE id = ?
    `).run(content.length, now, id);
    return { success: true, id: msgId };
  });
}
