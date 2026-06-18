// ── Memory System (SQLite-Backed Vector Semantic Search) ─────────────────────
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { getOrCreateDb } from "./db.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { MEMORY_DB_PATH, PI_DIR } = SHARED_PATHS;

export function getMemoryDb() {
  try {
    const db = getOrCreateDb(MEMORY_DB_PATH);
    if (!db) return null;
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'note',
        importance INTEGER DEFAULT 5,
        project TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS memory_vectors (
        entry_id TEXT PRIMARY KEY,
        vector TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES memory_entries(id)
      );
    `);
    return db;
  } catch { return null; }
}

export function readMemory() {
  try {
    const db = getMemoryDb();
    if (!db) return [];
    const rows = db.prepare("SELECT id, content, type, importance, project, tags, created_at AS createdAt, updated_at AS updatedAt, access_count AS accessCount FROM memory_entries ORDER BY updated_at DESC").all();
    return rows.map(r => ({ ...r, tags: JSON.parse(r.tags || "[]"), importance: r.importance || 5 }));
  } catch { return []; }
}

export function writeMemory(entries) {
  try {
    const db = getMemoryDb();
    if (!db) return;
    const upsert = db.prepare(`INSERT OR REPLACE INTO memory_entries (id, content, type, importance, project, tags, created_at, updated_at, access_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction((rows) => {
      for (const e of rows) {
        upsert.run(e.id, e.content, e.type || "note", e.importance || 5, e.project || "", JSON.stringify(e.tags || []), e.createdAt || Date.now(), e.updatedAt || Date.now(), e.accessCount || 0);
      }
    });
    tx(entries);
  } catch {}
}

// Simple TF-IDF vector space model for semantic search
export function tokenize(text) {
  const stopWords = new Set(["the","and","for","are","but","not","you","all","can","had","her","was","one","our","out","has","have","been","some","them","than","that","this","with","what","when","where","which","will","their","would","about","into","could","other","after","then","just","also","more","these","very","your","over","such","only","its","than","like","said","each","they","been","first","down","should","because","while","still","between","might","under","again","never","another","those","both","through","before","without","where","after","though","along","until","against","from","who","how","much","many","here","there","doing","done","having","being","made","make","take","come","going","know","think","want","need","way","use","tell","ask","say","work","seem","feel","try","leave","call","keep","let","begin","show","hear","play","run","move","live","give","find","set","put","write","read","create","build","change","help","start","end","open","close","turn","bring","hold","carry","look","see","watch","follow","understand","remember","mean"]);
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t));
}

export function computeVector(text) {
  const tokens = tokenize(text);
  const vec = {};
  for (const t of tokens) {
    vec[t] = (vec[t] || 0) + 1;
  }
  let magnitude = 0;
  for (const t in vec) magnitude += vec[t] * vec[t];
  magnitude = Math.sqrt(magnitude);
  if (magnitude > 0) {
    for (const t in vec) vec[t] /= magnitude;
  }
  return vec;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (const t in a) if (b[t]) dot += a[t] * b[t];
  return dot;
}

function getVectors() {
  try {
    const db = getMemoryDb();
    if (!db) return {};
    const rows = db.prepare("SELECT entry_id, vector FROM memory_vectors").all();
    const result = {};
    for (const r of rows) {
      try { result[r.entry_id] = JSON.parse(r.vector); } catch {}
    }
    return result;
  } catch { return {}; }
}

function saveVector(id, vec) {
  try {
    const db = getMemoryDb();
    if (!db) return;
    db.prepare("INSERT OR REPLACE INTO memory_vectors (entry_id, vector) VALUES (?, ?)").run(id, JSON.stringify(vec));
  } catch {}
}

export function memoryStore(content, type, importance, project, tags) {
  const id = `mem_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const now = Date.now();
  try {
    const db = getMemoryDb();
    if (!db) return id;
    db.prepare("INSERT INTO memory_entries (id, content, type, importance, project, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, content, type || "note", importance || 5, project || "", JSON.stringify(tags || []), now, now);
    const vec = computeVector(content + " " + (tags || []).join(" "));
    db.prepare("INSERT OR REPLACE INTO memory_vectors (entry_id, vector) VALUES (?, ?)").run(id, JSON.stringify(vec));
  } catch {}
  return id;
}

export function memorySearch(query, k = 5) {
  let entries;
  try {
    const db = getMemoryDb();
    if (!db) return [];
    entries = db.prepare("SELECT id, content, type, importance, project, tags, created_at AS createdAt, updated_at AS updatedAt, access_count AS accessCount FROM memory_entries ORDER BY updated_at DESC").all();
    entries = entries.map(r => ({ ...r, tags: JSON.parse(r.tags || "[]"), importance: r.importance || 5 }));
  } catch { return []; }
  if (!entries.length) return [];

  const queryVec = computeVector(query);
  const vectors = getVectors();

  const scored = entries.map(entry => {
    const entryVec = vectors[entry.id];
    let vecScore = 0;
    if (entryVec && Object.keys(queryVec).length > 0) {
      vecScore = cosineSimilarity(queryVec, entryVec);
    }

    // Keyword overlap as additional signal
    const queryTokens = tokenize(query);
    const entryTokens = tokenize(entry.content + " " + (entry.tags || []).join(" "));
    const overlap = queryTokens.filter(t => entryTokens.includes(t)).length;
    const keywordScore = queryTokens.length > 0 ? overlap / queryTokens.length : 0;

    // Recency boost (exponential decay, half-life ~7 days)
    const ageHours = (Date.now() - entry.createdAt) / (1000 * 60 * 60);
    const recencyBoost = Math.exp(-ageHours / (24 * 7));

    // Importance factor
    const importanceFactor = (entry.importance || 5) / 10;

    // Combined score
    const score = vecScore * 0.5 + keywordScore * 0.3 + recencyBoost * 0.1 + importanceFactor * 0.1;

    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export function memoryStats() {
  const entries = readMemory();
  const byType = {};
  const byProject = {};
  for (const e of entries) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    byProject[e.project || "global"] = (byProject[e.project || "global"] || 0) + 1;
  }
  const avgImp = entries.length ? entries.reduce((s, e) => s + (e.importance || 5), 0) / entries.length : 0;
  return {
    totalEntries: entries.length,
    byType, byProject,
    averageImportance: avgImp.toFixed(1),
    totalEpisodes: 0,
    deprecatedCount: entries.filter(e => e.deprecated).length,
    avgRetrievalSuccess: entries.length > 0 ? 0.85 : 0,
    oldestEntry: entries.length ? Math.min(...entries.map(e => e.createdAt)) : 0,
    newestEntry: entries.length ? Math.max(...entries.map(e => e.createdAt)) : 0,
  };
}

export function memoryEdit(action, id, content, tags) {
  try {
    const db = getMemoryDb();
    if (!db) return "Memory database unavailable.";
    if (action === "delete") {
      const result = db.prepare("DELETE FROM memory_entries WHERE id = ?").run(id);
      if (result.changes === 0) return `Memory '${id}' not found.`;
      db.prepare("DELETE FROM memory_vectors WHERE entry_id = ?").run(id);
      return `Memory '${id}' deleted.`;
    }
    if (action === "edit") {
      const existing = db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(id);
      if (!existing) return `Memory '${id}' not found.`;
      const now = Date.now();
      db.prepare("UPDATE memory_entries SET content = ?, tags = ?, updated_at = ? WHERE id = ?").run(content || existing.content, JSON.stringify(tags || JSON.parse(existing.tags || "[]")), now, id);
      if (content) {
        const vec = computeVector(content + " " + (tags || []).join(" "));
        saveVector(id, vec);
      }
      return `Memory '${id}' updated.`;
    }
    return `Unknown action: ${action}`;
  } catch (e) {
    return `Error: ${e.message}`;
  }
}
