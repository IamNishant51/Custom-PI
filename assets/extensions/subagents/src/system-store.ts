import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
// better-sqlite3 types use namespace merging; use any for the instance type to avoid version conflicts
type DbHandle = any;

const DB_PATH = path.join(os.homedir(), ".pi", "agent", "system.db");

export interface GateGuardEntry {
  path: string;
  blocked: boolean;
  approved: boolean;
  blockedAt: number;
  approvedAt: number | null;
}

export interface NudgeState {
  turnsSinceMemory: number;
  turnsSinceSkill: number;
  totalTurns: number;
}

export interface CostEvent {
  timestamp: string;
  sessionId: string;
  agent: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface BudgetConfig {
  maxSessionTokens: number;
  maxDailyTokens: number;
  maxSessionCostUsd: number;
  maxDailyCostUsd: number;
  warningThreshold: number;
}

export interface WorkProduct {
  id: string;
  timestamp: string;
  sessionId: string;
  agent: string;
  task: string;
  filePath: string;
  action: "create" | "modify" | "delete" | "read";
  size: number;
  hash: string;
  summary: string;
}

interface Migration {
  version: number;
  description: string;
  up: (db: DbHandle) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial schema: kv_store, gateguard_entries, cost_events, budget_config, daemon_state, initiative_state, work_products",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS kv_store (
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (namespace, key)
        );

        CREATE TABLE IF NOT EXISTS gateguard_entries (
          file_path TEXT PRIMARY KEY,
          blocked INTEGER NOT NULL DEFAULT 1,
          approved INTEGER NOT NULL DEFAULT 0,
          blocked_at INTEGER NOT NULL,
          approved_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS cost_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          session_id TEXT NOT NULL,
          agent TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS budget_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daemon_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS initiative_state (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS work_products (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          session_id TEXT NOT NULL,
          agent TEXT NOT NULL,
          task TEXT NOT NULL,
          file_path TEXT NOT NULL,
          action TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          hash TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS nudge_state (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL DEFAULT 0
        );
      `);
    },
  },
];

let _instance: SqliteSystemStore | null = null;

export function getSystemStore(): SqliteSystemStore {
  if (!_instance) {
    _instance = new SqliteSystemStore();
  }
  return _instance;
}

export function resetSystemStore(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}

export class SqliteSystemStore {
  private db: DbHandle;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || DB_PATH;
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const migrations: Migration[] = MIGRATIONS;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT DEFAULT (datetime('now')),
        description TEXT
      )
    `);

    const currentVersion = this.db.prepare(
      "SELECT COALESCE(MAX(version), 0) FROM schema_version"
    ).pluck().get() as number;

    for (const m of migrations) {
      if (m.version > currentVersion) {
        this.db.transaction(() => {
          m.up(this.db);
          this.db.prepare(
            "INSERT INTO schema_version (version, description) VALUES (?, ?)"
          ).run(m.version, m.description);
        })();
      }
    }
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ── KV Store ──────────────────────────────────────────────────────────────

  kvGet(namespace: string, key: string): string | undefined {
    const row = this.db.prepare(
      "SELECT value FROM kv_store WHERE namespace = ? AND key = ?"
    ).get(namespace, key) as { value: string } | undefined;
    return row?.value;
  }

  kvSet(namespace: string, key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO kv_store (namespace, key, value, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(namespace, key, value);
  }

  kvDelete(namespace: string, key: string): void {
    this.db.prepare("DELETE FROM kv_store WHERE namespace = ? AND key = ?").run(namespace, key);
  }

  kvList(namespace: string): Record<string, string> {
    const rows = this.db.prepare(
      "SELECT key, value FROM kv_store WHERE namespace = ?"
    ).all(namespace) as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  kvGetAll(namespace: string): Array<{ key: string; value: string }> {
    return this.db.prepare(
      "SELECT key, value FROM kv_store WHERE namespace = ?"
    ).all(namespace) as Array<{ key: string; value: string }>;
  }

  // ── GateGuard ─────────────────────────────────────────────────────────────

  getGateGuardEntry(filePath: string): GateGuardEntry | undefined {
    const row = this.db.prepare(
      "SELECT * FROM gateguard_entries WHERE file_path = ?"
    ).get(filePath) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      path: row.file_path as string,
      blocked: !!row.blocked,
      approved: !!row.approved,
      blockedAt: row.blocked_at as number,
      approvedAt: row.approved_at as number | null,
    };
  }

  setGateGuardEntry(entry: GateGuardEntry): void {
    this.db.prepare(`
      INSERT INTO gateguard_entries (file_path, blocked, approved, blocked_at, approved_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        blocked = excluded.blocked,
        approved = excluded.approved,
        blocked_at = excluded.blocked_at,
        approved_at = excluded.approved_at
    `).run(entry.path, entry.blocked ? 1 : 0, entry.approved ? 1 : 0, entry.blockedAt, entry.approvedAt ?? null);
  }

  getAllGateGuardEntries(): Record<string, GateGuardEntry> {
    const rows = this.db.prepare("SELECT * FROM gateguard_entries").all() as Array<Record<string, unknown>>;
    const result: Record<string, GateGuardEntry> = {};
    for (const row of rows) {
      result[row.file_path as string] = {
        path: row.file_path as string,
        blocked: !!row.blocked,
        approved: !!row.approved,
        blockedAt: row.blocked_at as number,
        approvedAt: row.approved_at as number | null,
      };
    }
    return result;
  }

  // ── Nudge State ────────────────────────────────────────────────────────────

  getNudgeState(): NudgeState {
    const turnsSinceMemory = this.db.prepare(
      "SELECT value FROM nudge_state WHERE key = 'turnsSinceMemory'"
    ).pluck().get() as number | undefined;
    const turnsSinceSkill = this.db.prepare(
      "SELECT value FROM nudge_state WHERE key = 'turnsSinceSkill'"
    ).pluck().get() as number | undefined;
    const totalTurns = this.db.prepare(
      "SELECT value FROM nudge_state WHERE key = 'totalTurns'"
    ).pluck().get() as number | undefined;
    return {
      turnsSinceMemory: turnsSinceMemory ?? 0,
      turnsSinceSkill: turnsSinceSkill ?? 0,
      totalTurns: totalTurns ?? 0,
    };
  }

  setNudgeState(state: NudgeState): void {
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO nudge_state (key, value) VALUES ('turnsSinceMemory', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(state.turnsSinceMemory);
      this.db.prepare(`
        INSERT INTO nudge_state (key, value) VALUES ('turnsSinceSkill', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(state.turnsSinceSkill);
      this.db.prepare(`
        INSERT INTO nudge_state (key, value) VALUES ('totalTurns', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(state.totalTurns);
    });
  }

  // ── Cost Events ────────────────────────────────────────────────────────────

  appendCostEvent(event: CostEvent): void {
    this.db.prepare(`
      INSERT INTO cost_events (timestamp, session_id, agent, provider, model, input_tokens, output_tokens, total_tokens, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.timestamp, event.sessionId, event.agent, event.provider, event.model, event.inputTokens, event.outputTokens, event.totalTokens, event.costUsd);
  }

  getCostEvents(sessionId?: string, date?: string): CostEvent[] {
    let query = "SELECT * FROM cost_events WHERE 1=1";
    const params: unknown[] = [];
    if (sessionId) {
      query += " AND session_id = ?";
      params.push(sessionId);
    }
    if (date) {
      query += " AND timestamp >= ?";
      params.push(date);
    }
    query += " ORDER BY timestamp ASC";
    const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      timestamp: row.timestamp as string,
      sessionId: row.session_id as string,
      agent: row.agent as string,
      provider: row.provider as string,
      model: row.model as string,
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      totalTokens: row.total_tokens as number,
      costUsd: row.cost_usd as number,
    }));
  }

  getCostSummary(): { totalSessions: number; totalTokens: number; totalCostUsd: number; dailyTokens: number; dailyCostUsd: number; today: string } {
    const total = this.db.prepare(
      "SELECT COUNT(DISTINCT session_id) as sessions, COALESCE(SUM(total_tokens),0) as tokens, COALESCE(SUM(cost_usd),0) as cost FROM cost_events"
    ).get() as { sessions: number; tokens: number; cost: number };
    const today = new Date().toISOString().slice(0, 10);
    const daily = this.db.prepare(
      "SELECT COALESCE(SUM(total_tokens),0) as tokens, COALESCE(SUM(cost_usd),0) as cost FROM cost_events WHERE timestamp >= ?"
    ).get(today) as { tokens: number; cost: number };
    return {
      totalSessions: total.sessions,
      totalTokens: total.tokens,
      totalCostUsd: total.cost,
      dailyTokens: daily.tokens,
      dailyCostUsd: daily.cost,
      today,
    };
  }

  // ── Budget Config ──────────────────────────────────────────────────────────

  getBudgetConfig(): BudgetConfig {
    const maxSessionTokens = this.db.prepare("SELECT value FROM budget_config WHERE key = 'maxSessionTokens'").pluck().get() as string | undefined;
    const maxDailyTokens = this.db.prepare("SELECT value FROM budget_config WHERE key = 'maxDailyTokens'").pluck().get() as string | undefined;
    const maxSessionCostUsd = this.db.prepare("SELECT value FROM budget_config WHERE key = 'maxSessionCostUsd'").pluck().get() as string | undefined;
    const maxDailyCostUsd = this.db.prepare("SELECT value FROM budget_config WHERE key = 'maxDailyCostUsd'").pluck().get() as string | undefined;
    const warningThreshold = this.db.prepare("SELECT value FROM budget_config WHERE key = 'warningThreshold'").pluck().get() as string | undefined;
    return {
      maxSessionTokens: maxSessionTokens ? Number(maxSessionTokens) : 500_000,
      maxDailyTokens: maxDailyTokens ? Number(maxDailyTokens) : 2_000_000,
      maxSessionCostUsd: maxSessionCostUsd ? Number(maxSessionCostUsd) : 1.0,
      maxDailyCostUsd: maxDailyCostUsd ? Number(maxDailyCostUsd) : 5.0,
      warningThreshold: warningThreshold ? Number(warningThreshold) : 0.8,
    };
  }

  setBudgetConfig(config: Partial<BudgetConfig>): BudgetConfig {
    const current = this.getBudgetConfig();
    const updated = { ...current, ...config };
    this.transaction(() => {
      for (const [key, value] of Object.entries(updated)) {
        this.db.prepare(`
          INSERT INTO budget_config (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(key, String(value));
      }
    });
    return updated;
  }

  // ── Work Products ──────────────────────────────────────────────────────────

  appendWorkProduct(product: WorkProduct): void {
    this.db.prepare(`
      INSERT INTO work_products (id, timestamp, session_id, agent, task, file_path, action, size, hash, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(product.id, product.timestamp, product.sessionId, product.agent, product.task, product.filePath, product.action, product.size, product.hash, product.summary);
  }

  getWorkProducts(sessionId?: string): WorkProduct[] {
    let query = "SELECT * FROM work_products";
    const params: unknown[] = [];
    if (sessionId) {
      query += " WHERE session_id = ?";
      params.push(sessionId);
    }
    query += " ORDER BY timestamp DESC LIMIT 1000";
    const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: row.id as string,
      timestamp: row.timestamp as string,
      sessionId: row.session_id as string,
      agent: row.agent as string,
      task: row.task as string,
      filePath: row.file_path as string,
      action: row.action as WorkProduct["action"],
      size: row.size as number,
      hash: row.hash as string,
      summary: row.summary as string,
    }));
  }

  clearWorkProducts(sessionId?: string): void {
    if (sessionId) {
      this.db.prepare("DELETE FROM work_products WHERE session_id = ?").run(sessionId);
    } else {
      this.db.prepare("DELETE FROM work_products").run();
    }
  }
}
