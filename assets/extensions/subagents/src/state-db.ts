import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { writeAtomic, writeAtomicAsync } from "./storage-driver";

const DB_DIR = path.join(os.homedir(), ".pi", "agent");
const DB_PATH = path.join(DB_DIR, "session-state.db");
const CHECKPOINT_DIR = path.join(DB_DIR, "checkpoints");

export interface Checkpoint {
  taskId: string;
  sessionId: string;
  timestamp: number;
  goal: string;
  currentSubtask: string;
  completedSubtasks: string[];
  pendingSubtasks: string[];
  stateNotes: string;
  activeAgentName: string | null;
  lastToolResult: string | null;
}

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

    CREATE TABLE IF NOT EXISTS triplets (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_label TEXT NOT NULL,
      predicate_type TEXT NOT NULL,
      predicate_label TEXT NOT NULL,
      object_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_label TEXT NOT NULL,
      confidence_score REAL DEFAULT 1.0,
      last_updated INTEGER,
      source_session TEXT
    );

    CREATE TABLE IF NOT EXISTS failure_triplets (
      id TEXT PRIMARY KEY,
      component_id TEXT NOT NULL,
      component_label TEXT NOT NULL,
      error_code TEXT NOT NULL,
      error_message TEXT,
      severity TEXT DEFAULT 'medium',
      source TEXT DEFAULT 'unknown',
      raw_log TEXT,
      created_at INTEGER,
      acknowledged INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      component TEXT,
      error_code TEXT,
      count INTEGER DEFAULT 1,
      first_seen INTEGER,
      last_seen INTEGER,
      severity TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      triage_task_id TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS service_health (
      service_name TEXT PRIMARY KEY,
      endpoint TEXT,
      status TEXT DEFAULT 'unknown',
      latency_ms REAL DEFAULT 0,
      jitter_ms REAL DEFAULT 0,
      last_ok INTEGER,
      last_fail INTEGER,
      consecutive_failures INTEGER DEFAULT 0,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      service TEXT PRIMARY KEY,
      remaining INTEGER DEFAULT 60,
      limit_total INTEGER DEFAULT 60,
      reset_at INTEGER,
      breached INTEGER DEFAULT 0,
      backoff_delay_ms REAL DEFAULT 1000,
      last_checked INTEGER
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
  createdAt?: string;
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
                  m.created_at as createdAt,
                  snippet(messages_fts, 1, '<mark>', '</mark>', '...', 40) as snippet,
                  rank
           FROM messages_fts 
           JOIN messages m ON messages_fts.rowid = m.id
           WHERE messages_fts MATCH ? AND m.session_id = ?
           ORDER BY rank LIMIT ?`;
    params = [q, sessionId, k];
  } else {
    sql = `SELECT m.id, m.session_id as sessionId, m.role, m.content,
                  m.created_at as createdAt,
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

export interface TripletRecord {
  id: string;
  subjectId: string;
  subjectType: string;
  subjectLabel: string;
  predicateType: string;
  predicateLabel: string;
  objectId: string;
  objectType: string;
  objectLabel: string;
  confidenceScore: number;
  lastUpdated?: number;
  sourceSession: string;
}

export function insertTriplet(record: TripletRecord): void {
  const d = openDb();
  const lastUpdated = Date.now();
  d.prepare(`
    INSERT INTO triplets (
      id, subject_id, subject_type, subject_label, 
      predicate_type, predicate_label, 
      object_id, object_type, object_label, 
      confidence_score, last_updated, source_session
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      confidence_score = ?,
      last_updated = ?
  `).run(
    record.id, record.subjectId, record.subjectType, record.subjectLabel,
    record.predicateType, record.predicateLabel,
    record.objectId, record.objectType, record.objectLabel,
    record.confidenceScore, lastUpdated, record.sourceSession,
    record.confidenceScore, lastUpdated
  );
}

export function queryTriplets(filter: {
  subjectId?: string;
  subjectType?: string;
  predicateType?: string;
  objectId?: string;
  objectType?: string;
  minConfidence?: number;
}): TripletRecord[] {
  const d = openDb();
  let sql = "SELECT id, subject_id as subjectId, subject_type as subjectType, subject_label as subjectLabel, predicate_type as predicateType, predicate_label as predicateLabel, object_id as objectId, object_type as objectType, object_label as objectLabel, confidence_score as confidenceScore, last_updated as lastUpdated, source_session as sourceSession FROM triplets WHERE 1=1";
  const params: any[] = [];
  
  if (filter.subjectId) {
    sql += " AND subject_id = ?";
    params.push(filter.subjectId);
  }
  if (filter.subjectType) {
    sql += " AND subject_type = ?";
    params.push(filter.subjectType);
  }
  if (filter.predicateType) {
    sql += " AND predicate_type = ?";
    params.push(filter.predicateType);
  }
  if (filter.objectId) {
    sql += " AND object_id = ?";
    params.push(filter.objectId);
  }
  if (filter.objectType) {
    sql += " AND object_type = ?";
    params.push(filter.objectType);
  }
  if (filter.minConfidence !== undefined) {
    sql += " AND confidence_score >= ?";
    params.push(filter.minConfidence);
  }
  sql += " ORDER BY confidence_score DESC, last_updated DESC";
  
  return d.prepare(sql).all(...params) as TripletRecord[];
}

export interface AggregatedEntity {
  entityId: string;
  entityType: string;
  entityLabel: string;
  triplets: TripletRecord[];
  avgConfidence: number;
  lastUpdated: number;
}

export function aggregateByEntity(entityId: string): AggregatedEntity | null {
  const triples = queryTriplets({ subjectId: entityId });
  if (triples.length === 0) return null;

  const first = triples[0];
  return {
    entityId,
    entityType: first.subjectType,
    entityLabel: first.subjectLabel,
    triplets: triples,
    avgConfidence: triples.reduce((s, t) => s + t.confidenceScore, 0) / triples.length,
    lastUpdated: Math.max(...triples.map(t => t.lastUpdated || 0)),
  };
}

export interface ConnectedEntity {
  entityId: string;
  entityType: string;
  entityLabel: string;
  relationship: string;
  direction: "outgoing" | "incoming";
  confidenceScore: number;
}

export function findConnectedEntities(entityId: string): ConnectedEntity[] {
  const d = openDb();
  const results: ConnectedEntity[] = [];

  // Outgoing: this entity is the subject
  const outgoing = d.prepare(`
    SELECT object_id as entityId, object_type as entityType, object_label as entityLabel,
           predicate_label as relationship, confidence_score as confidenceScore
    FROM triplets WHERE subject_id = ?
    ORDER BY confidence_score DESC
  `).all(entityId) as any[];

  for (const r of outgoing) {
    results.push({ ...r, direction: "outgoing" });
  }

  // Incoming: this entity is the object
  const incoming = d.prepare(`
    SELECT subject_id as entityId, subject_type as entityType, subject_label as entityLabel,
           predicate_label as relationship, confidence_score as confidenceScore
    FROM triplets WHERE object_id = ?
    ORDER BY confidence_score DESC
  `).all(entityId) as any[];

  for (const r of incoming) {
    results.push({ ...r, direction: "incoming" });
  }

  return results;
}

export function deleteTriplet(id: string): boolean {
  const d = openDb();
  const res = d.prepare("DELETE FROM triplets WHERE id = ?").run(id);
  return res.changes > 0;
}

// ── Triplet TTL Policy ─────────────────────────────────────────────────────

const TTL_DAYS: Record<string, number> = {
  tool: 7,
  file: 90,
  function: 180,
  class: 180,
  concept: 365,
  dependency: 365,
  setting: 365,
  person: 365 * 5,
};

const DEFAULT_TTL_DAYS = 90;
const REDUNDANCY_SIMILARITY_THRESHOLD = 0.85;

export interface PruneResult {
  staleDeleted: number;
  redundantMerged: number;
  totalBefore: number;
  totalAfter: number;
  staleItems: string[];
  mergedItems: { kept: string; removed: string; reason: string }[];
}

const PRUNE_LOG_PATH = path.join(DB_DIR, "prune-log.json");

function appendPruneLog(entry: any): void {
  try {
    const log: any[] = fs.existsSync(PRUNE_LOG_PATH)
      ? JSON.parse(fs.readFileSync(PRUNE_LOG_PATH, "utf8"))
      : [];
    log.push({ ...entry, timestamp: Date.now() });
    if (log.length > 1000) log.splice(0, log.length - 1000);
    fs.writeFileSync(PRUNE_LOG_PATH, JSON.stringify(log, null, 2));
  } catch { /* prune log is best-effort */ }
}

export function getTtlDays(subjectType: string): number {
  return TTL_DAYS[subjectType] ?? DEFAULT_TTL_DAYS;
}

export function pruneStaleTriplets(): { count: number; items: string[] } {
  const d = openDb();
  const now = Date.now();
  const items: string[] = [];

  const all = d.prepare(
    "SELECT id, subject_id, subject_label, predicate_label, object_label, subject_type, last_updated FROM triplets"
  ).all() as { id: string; subject_id: string; subject_label: string; predicate_label: string; object_label: string; subject_type: string; last_updated: number }[];

  for (const row of all) {
    const ttlDays = getTtlDays(row.subject_type);
    const ttlMs = ttlDays * 86_400_000;
    const age = now - (row.last_updated || now);
    if (age > ttlMs) {
      d.prepare("DELETE FROM triplets WHERE id = ?").run(row.id);
      items.push(`${row.subject_label} → ${row.predicate_label} → ${row.object_label} (${row.subject_type}, expired ${Math.round(age / 86_400_000)}d/${ttlDays}d)`);
    }
  }

  return { count: items.length, items };
}

export function mergeRedundantTriplets(): { count: number; items: { kept: string; removed: string; reason: string }[] } {
  const d = openDb();
  const all = d.prepare(
    "SELECT id, subject_id, subject_label, predicate_type, predicate_label, object_id, object_label, confidence_score FROM triplets ORDER BY confidence_score DESC"
  ).all() as {
    id: string; subject_id: string; subject_label: string;
    predicate_type: string; predicate_label: string;
    object_id: string; object_label: string;
    confidence_score: number;
  }[];

  const items: { kept: string; removed: string; reason: string }[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < all.length; i++) {
    if (processed.has(all[i].id)) continue;
    for (let j = i + 1; j < all.length; j++) {
      if (processed.has(all[j].id)) continue;

      const a = all[i];
      const b = all[j];
      const sim =
        (a.subject_id === b.subject_id ? 0.3 : 0) +
        (a.predicate_type === b.predicate_type ? 0.3 : 0) +
        (a.object_id === b.object_id ? 0.3 : 0) +
        (a.confidence_score > 0.7 && b.confidence_score > 0.7 ? 0.1 : 0);

      if (sim >= REDUNDANCY_SIMILARITY_THRESHOLD) {
        // Keep the higher-confidence entry, delete the other
        if (a.confidence_score >= b.confidence_score) {
          d.prepare("DELETE FROM triplets WHERE id = ?").run(b.id);
          processed.add(b.id);
          items.push({ kept: `${a.subject_label} → ${a.predicate_label} → ${a.object_label}`, removed: `${b.subject_label} → ${b.predicate_label} → ${b.object_label}`, reason: `redundant (sim=${sim.toFixed(2)}, kept confidence=${a.confidence_score})` });
        } else {
          d.prepare("DELETE FROM triplets WHERE id = ?").run(a.id);
          processed.add(a.id);
          items.push({ kept: `${b.subject_label} → ${b.predicate_label} → ${b.object_label}`, removed: `${a.subject_label} → ${a.predicate_label} → ${a.object_label}`, reason: `redundant (sim=${sim.toFixed(2)}, kept confidence=${b.confidence_score})` });
        }
      }
    }
  }

  return { count: items.length, items };
}

export function pruneTriplets(): PruneResult {
  const d = openDb();
  const totalBefore = (d.prepare("SELECT COUNT(*) as c FROM triplets").get() as any).c;
  const stale = pruneStaleTriplets();
  const redundant = mergeRedundantTriplets();
  const totalAfter = (d.prepare("SELECT COUNT(*) as c FROM triplets").get() as any).c;
  const result: PruneResult = { staleDeleted: stale.count, redundantMerged: redundant.count, totalBefore, totalAfter, staleItems: stale.items, mergedItems: redundant.items };
  if (result.staleDeleted > 0 || result.redundantMerged > 0) {
    appendPruneLog({ action: "prune", result });
  }
  return result;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ── Checkpointing ───────────────────────────────────────────────────────────

function ensureCheckpointDir(): void {
  if (!fs.existsSync(CHECKPOINT_DIR)) {
    fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  }
}

export function saveCheckpoint(cp: Checkpoint): void {
  ensureCheckpointDir();
  const filePath = path.join(CHECKPOINT_DIR, `${cp.sessionId}.json`);
  writeAtomic(filePath, JSON.stringify(cp, null, 2));
}

export async function saveCheckpointAsync(cp: Checkpoint): Promise<void> {
  ensureCheckpointDir();
  const filePath = path.join(CHECKPOINT_DIR, `${cp.sessionId}.json`);
  await writeAtomicAsync(filePath, JSON.stringify(cp, null, 2));
}

export function loadCheckpoint(sessionId: string): Checkpoint | null {
  const filePath = path.join(CHECKPOINT_DIR, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Checkpoint;
  } catch {
    return null;
  }
}

export function listCheckpoints(): string[] {
  ensureCheckpointDir();
  return fs.readdirSync(CHECKPOINT_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(/\.json$/, ""));
}

export function deleteCheckpoint(sessionId: string): void {
  const filePath = path.join(CHECKPOINT_DIR, `${sessionId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function getLatestCheckpoint(): Checkpoint | null {
  const ids = listCheckpoints();
  if (ids.length === 0) return null;
  let latest: Checkpoint | null = null;
  for (const id of ids) {
    const cp = loadCheckpoint(id);
    if (cp && (!latest || cp.timestamp > latest.timestamp)) {
      latest = cp;
    }
  }
  return latest;
}

// ── Failure Triplets & Incidents ────────────────────────────────────────────

export interface FailureTripletRecord {
  id: string;
  componentId: string;
  componentLabel: string;
  errorCode: string;
  errorMessage?: string;
  severity: string;
  source: string;
  rawLog?: string;
  createdAt: number;
  acknowledged: number;
}

export function insertFailureTriplet(record: FailureTripletRecord): void {
  const d = openDb();
  d.prepare(`
    INSERT INTO failure_triplets (id, component_id, component_label, error_code, error_message, severity, source, raw_log, created_at, acknowledged)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(record.id, record.componentId, record.componentLabel, record.errorCode, record.errorMessage || "", record.severity, record.source, record.rawLog || "", record.createdAt, record.acknowledged);
}

export function queryFailureTriplets(filter: { severity?: string; component?: string; limit?: number }): FailureTripletRecord[] {
  const d = openDb();
  let sql = "SELECT id, component_id as componentId, component_label as componentLabel, error_code as errorCode, error_message as errorMessage, severity, source, raw_log as rawLog, created_at as createdAt, acknowledged FROM failure_triplets WHERE 1=1";
  const params: any[] = [];
  if (filter.severity) { sql += " AND severity = ?"; params.push(filter.severity); }
  if (filter.component) { sql += " AND component_id = ?"; params.push(filter.component); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(filter.limit || 50);
  return d.prepare(sql).all(...params) as FailureTripletRecord[];
}

export function insertIncident(record: {
  id: string; summary: string; component?: string; errorCode?: string;
  severity?: string; triageTaskId?: string;
}): void {
  const d = openDb();
  const now = Date.now();
  d.prepare(`
    INSERT INTO incidents (id, summary, component, error_code, count, first_seen, last_seen, severity, status, triage_task_id, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'open', ?, ?)
    ON CONFLICT(id) DO UPDATE SET count = count + 1, last_seen = ?, severity = ?
  `).run(record.id, record.summary, record.component || "", record.errorCode || "", now, now, record.severity || "medium", record.triageTaskId || "", now, now, record.severity || "medium");
}

export function queryOpenIncidents(): any[] {
  const d = openDb();
  return d.prepare("SELECT * FROM incidents WHERE status = 'open' ORDER BY last_seen DESC").all();
}

// ── Service Health ──────────────────────────────────────────────────────────

export interface ServiceHealthRecord {
  serviceName: string;
  endpoint: string;
  status: string;
  latencyMs: number;
  jitterMs: number;
  lastOk: number;
  lastFail: number;
  consecutiveFailures: number;
  updatedAt: number;
}

export function upsertServiceHealth(record: ServiceHealthRecord): void {
  const d = openDb();
  d.prepare(`
    INSERT INTO service_health (service_name, endpoint, status, latency_ms, jitter_ms, last_ok, last_fail, consecutive_failures, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(service_name) DO UPDATE SET
      status = ?, endpoint = ?, latency_ms = ?, jitter_ms = ?,
      last_ok = ?, last_fail = ?, consecutive_failures = ?, updated_at = ?
  `).run(
    record.serviceName, record.endpoint, record.status, record.latencyMs, record.jitterMs,
    record.lastOk, record.lastFail, record.consecutiveFailures, record.updatedAt,
    record.status, record.endpoint, record.latencyMs, record.jitterMs,
    record.lastOk, record.lastFail, record.consecutiveFailures, record.updatedAt
  );
}

export function getServiceHealth(name: string): ServiceHealthRecord | null {
  const d = openDb();
  return d.prepare("SELECT service_name as serviceName, endpoint, status, latency_ms as latencyMs, jitter_ms as jitterMs, last_ok as lastOk, last_fail as lastFail, consecutive_failures as consecutiveFailures, updated_at as updatedAt FROM service_health WHERE service_name = ?").get(name) as any || null;
}

export function getAllServiceHealth(): ServiceHealthRecord[] {
  const d = openDb();
  return d.prepare("SELECT service_name as serviceName, endpoint, status, latency_ms as latencyMs, jitter_ms as jitterMs, last_ok as lastOk, last_fail as lastFail, consecutive_failures as consecutiveFailures, updated_at as updatedAt FROM service_health ORDER BY status").all() as ServiceHealthRecord[];
}

// ── Rate Limits ─────────────────────────────────────────────────────────────

export interface RateLimitRecord {
  service: string;
  remaining: number;
  limitTotal: number;
  resetAt: number;
  breached: number;
  backoffDelayMs: number;
  lastChecked: number;
}

export function upsertRateLimit(record: RateLimitRecord): void {
  const d = openDb();
  d.prepare(`
    INSERT INTO rate_limits (service, remaining, limit_total, reset_at, breached, backoff_delay_ms, last_checked)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(service) DO UPDATE SET
      remaining = ?, limit_total = ?, reset_at = ?, breached = ?,
      backoff_delay_ms = ?, last_checked = ?
  `).run(
    record.service, record.remaining, record.limitTotal, record.resetAt,
    record.breached ? 1 : 0, record.backoffDelayMs, record.lastChecked,
    record.remaining, record.limitTotal, record.resetAt, record.breached ? 1 : 0,
    record.backoffDelayMs, record.lastChecked
  );
}

export function getRateLimit(service: string): RateLimitRecord | null {
  const d = openDb();
  return d.prepare("SELECT service, remaining, limit_total as limitTotal, reset_at as resetAt, breached, backoff_delay_ms as backoffDelayMs, last_checked as lastChecked FROM rate_limits WHERE service = ?").get(service) as any || null;
}

export function getAllBreachedRateLimits(): RateLimitRecord[] {
  const d = openDb();
  return d.prepare("SELECT service, remaining, limit_total as limitTotal, reset_at as resetAt, breached, backoff_delay_ms as backoffDelayMs, last_checked as lastChecked FROM rate_limits WHERE breached = 1").all() as RateLimitRecord[];
}
