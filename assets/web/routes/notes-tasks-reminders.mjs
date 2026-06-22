import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { getOrCreateDb } from "../services/db.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;

export default function registerNotesTasksReminders(app, { sendError }) {
  const NOTES_DB_PATH = path.join(PI_DIR, "notes.db");

  function getNotesDb() {
    try {
      const db = getOrCreateDb(NOTES_DB_PATH);
      if (!db) return null;
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT DEFAULT '',
          color TEXT DEFAULT '', pinned INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
          tags TEXT DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER DEFAULT 0,
          status TEXT DEFAULT 'todo', priority TEXT DEFAULT 'medium',
          due_date INTEGER, note_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
      `);
      return db;
    } catch { return null; }
  }

  app.get("/api/notes", {
    schema: { response: { 200: { type: "object", properties: { notes: { type: "array", items: { type: "object" } } } } } },
  }, async () => {
    const db = getNotesDb();
    if (!db) return { notes: [] };
    const rows = db.prepare("SELECT * FROM notes WHERE archived = 0 ORDER BY pinned DESC, updated_at DESC LIMIT 100").all();
    return { notes: rows.map(r => ({ ...r, tags: JSON.parse(r.tags || "[]") })) };
  });

  app.post("/api/notes", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { title: { type: "string" }, content: { type: "string" }, color: { type: "string" }, tags: { type: "array", items: { type: "string" } } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, id: { type: "string" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    const { title, content, color, tags } = req.body || {};
    const id = `note_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const now = Date.now();
    db.prepare("INSERT INTO notes (id, title, content, color, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, title || "", content || "", color || "", JSON.stringify(tags || []), now, now);
    return { success: true, id };
  });

  app.put("/api/notes/:id", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { title: { type: "string" }, content: { type: "string" }, color: { type: "string" }, pinned: { type: "number" }, archived: { type: "number" }, tags: { type: "array", items: { type: "string" } } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    const { id } = req.params;
    const updates = req.body || {};
    const fields = []; const vals = [];
    for (const k of ["title", "content", "color", "pinned", "archived"]) {
      if (updates[k] !== undefined) { fields.push(`${k} = ?`); vals.push(updates[k]); }
    }
    if (updates.tags) { fields.push("tags = ?"); vals.push(JSON.stringify(updates.tags)); }
    if (!fields.length) return { error: "No fields" };
    fields.push("updated_at = ?"); vals.push(Date.now()); vals.push(id);
    db.prepare(`UPDATE notes SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
    return { success: true };
  });

  app.delete("/api/notes/:id", {
    schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } } },
  }, async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    db.prepare("DELETE FROM notes WHERE id = ?").run(req.params.id);
    return { success: true };
  });

  app.get("/api/tasks", {
    schema: { response: { 200: { type: "object", properties: { tasks: { type: "array", items: { type: "object" } } } } } },
  }, async () => {
    const db = getNotesDb();
    if (!db) return { tasks: [] };
    const rows = db.prepare("SELECT * FROM tasks ORDER BY done ASC, due_date ASC, created_at DESC LIMIT 100").all();
    return { tasks: rows };
  });

  app.post("/api/tasks", {
    schema: {
      body: { type: "object", properties: { title: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] }, dueDate: { type: "number" }, noteId: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, id: { type: "string" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    const { title, priority, dueDate, noteId } = req.body || {};
    const id = `task_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const now = Date.now();
    db.prepare("INSERT INTO tasks (id, title, priority, due_date, note_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, title || "", priority || "medium", dueDate || null, noteId || "", now, now);
    return { success: true, id };
  });

  app.put("/api/tasks/:id", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { title: { type: "string" }, done: { type: "number" }, status: { type: "string" }, priority: { type: "string" }, due_date: { type: "number" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    const updates = req.body || {};
    const fields = []; const vals = [];
    for (const k of ["title", "done", "status", "priority", "due_date"]) {
      if (updates[k] !== undefined) { fields.push(`${k} = ?`); vals.push(updates[k]); }
    }
    if (!fields.length) return { error: "No fields" };
    fields.push("updated_at = ?"); vals.push(Date.now()); vals.push(req.params.id);
    db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
    return { success: true };
  });

  app.delete("/api/tasks/:id", {
    schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } } },
  }, async (req) => {
    const db = getNotesDb();
    if (!db) return { error: "Database unavailable" };
    db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
    return { success: true };
  });

  const REMINDERS_FILE = path.join(PI_DIR, "reminders.json");
  function loadReminders() {
    try { return JSON.parse(fs.readFileSync(REMINDERS_FILE, "utf8")); } catch { return []; }
  }
  function saveReminders(reminders) { fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2)); }

  app.get("/api/reminders", {
    schema: { response: { 200: { type: "object", properties: { reminders: { type: "array", items: { type: "object" } } } } } },
  }, async () => ({ reminders: loadReminders() }));
  app.post("/api/reminders", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { title: { type: "string" }, dueAt: { type: "number" }, noteId: { type: "string" }, recurring: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, reminder: { type: "object" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const { title, dueAt, noteId, recurring } = req.body || {};
    if (!title) return { error: "title required" };
    const reminders = loadReminders();
    const r = { id: `rem_${Date.now()}`, title, dueAt: dueAt || Date.now() + 86400000, noteId: noteId || null, recurring: recurring || null, done: false, createdAt: Date.now() };
    reminders.push(r);
    saveReminders(reminders);
    return { success: true, reminder: r };
  });
  app.post("/api/reminders/:id/done", {
    schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" } } } } },
  }, async (req) => {
    saveReminders(loadReminders().map(r => r.id === req.params.id ? { ...r, done: true } : r));
    return { success: true };
  });
  app.delete("/api/reminders/:id", {
    schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" } } } } },
  }, async (req) => {
    saveReminders(loadReminders().filter(r => r.id !== req.params.id));
    return { success: true };
  });

  const SCHEDULED_FILE = path.join(PI_DIR, "scheduled-actions.json");
  function loadScheduled() {
    try { return JSON.parse(fs.readFileSync(SCHEDULED_FILE, "utf8")); } catch { return []; }
  }
  function saveScheduled(actions) { fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(actions, null, 2)); }

  app.get("/api/scheduled-actions", {
    schema: { response: { 200: { type: "object", properties: { actions: { type: "array", items: { type: "object" } } } } } },
  }, async () => ({ actions: loadScheduled() }));
  app.post("/api/scheduled-actions", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { name: { type: "string" }, description: { type: "string" }, intervalMs: { type: "number" }, agentTask: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const { name, description, intervalMs, agentTask } = req.body || {};
    if (!name || !intervalMs) return { error: "name and intervalMs required" };
    const actions = loadScheduled();
    actions.push({ id: `sch_${Date.now()}`, name, description: description || "", intervalMs, agentTask: agentTask || "", lastRun: null, createdAt: Date.now() });
    saveScheduled(actions);
    return { success: true };
  });
  app.delete("/api/scheduled-actions/:id", {
    schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" } } } } },
  }, async (req) => {
    saveScheduled(loadScheduled().filter(a => a.id !== req.params.id));
    return { success: true };
  });
}
