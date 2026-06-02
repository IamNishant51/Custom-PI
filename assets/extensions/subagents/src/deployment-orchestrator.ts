import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

function sanitizeGitSha(input: string): string {
  return input.replace(/[^a-fA-F0-9]/g, "");
}

// ── SQLite Persistence ─────────────────────────────────────────────────────

const DB_PATH = path.join(process.env.HOME || "~", ".pi", "agent", "deployments.db");
let db: InstanceType<typeof Database>;

function getDb(): InstanceType<typeof Database> {
  if (!db) {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      db = new Database(DB_PATH);
      db.pragma("journal_mode = WAL");
      db.exec(`
        CREATE TABLE IF NOT EXISTS deployments (
          id TEXT PRIMARY KEY,
          pr_url TEXT,
          branch TEXT NOT NULL,
          target TEXT NOT NULL,
          stages TEXT NOT NULL,
          current_stage INTEGER NOT NULL DEFAULT 0,
          rollback_sha TEXT,
          stable_sha TEXT,
          created_at INTEGER NOT NULL
        )
      `);
    } catch {
      // Fallback to in-memory if SQLite fails
      db = new Database(":memory:");
      db.exec(`
        CREATE TABLE IF NOT EXISTS deployments (
          id TEXT PRIMARY KEY,
          pr_url TEXT,
          branch TEXT NOT NULL,
          target TEXT NOT NULL,
          stages TEXT NOT NULL,
          current_stage INTEGER NOT NULL DEFAULT 0,
          rollback_sha TEXT,
          stable_sha TEXT,
          created_at INTEGER NOT NULL
        )
      `);
    }
  }
  return db;
}

function saveDeployment(state: DeploymentState): void {
  const d = getDb();
  d.prepare(`INSERT OR REPLACE INTO deployments (id, pr_url, branch, target, stages, current_stage, rollback_sha, stable_sha, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    state.id, state.prUrl || null, state.branch, state.target,
    JSON.stringify(state.stages), state.currentStage,
    state.rollbackSha || null, state.stableSha || null, state.createdAt
  );
}

function loadDeployments(): Map<string, DeploymentState> {
  const map = new Map<string, DeploymentState>();
  try {
    const rows = getDb().prepare(`SELECT * FROM deployments ORDER BY created_at DESC`).all() as any[];
    for (const row of rows) {
      map.set(row.id, {
        id: row.id,
        prUrl: row.pr_url || undefined,
        branch: row.branch,
        target: row.target,
        stages: JSON.parse(row.stages),
        currentStage: row.current_stage,
        rollbackSha: row.rollback_sha || undefined,
        stableSha: row.stable_sha || undefined,
        createdAt: row.created_at,
      });
    }
  } catch { /* ignore */ }
  return map;
}

// ── Pipeline Types ─────────────────────────────────────────────────────────

export type PipelineStageName =
  | "pr_created" | "build_started" | "unit_tests" | "staging_deploy"
  | "smoke_tests" | "prod_deploy" | "completed" | "failed" | "rolled_back";

export interface PipelineStage {
  name: PipelineStageName;
  status: "pending" | "running" | "passed" | "failed";
  startedAt?: number;
  completedAt?: number;
}

export interface DeploymentState {
  id: string;
  prUrl?: string;
  branch: string;
  target: string;
  stages: PipelineStage[];
  currentStage: number;
  rollbackSha?: string;
  stableSha?: string;
  createdAt: number;
}

const deployments = loadDeployments();

export function createDeployment(branch: string, target: string, stableSha?: string): DeploymentState {
  const id = `deploy_${Date.now()}`;
  const stageNames: PipelineStageName[] = ["pr_created", "build_started", "unit_tests", "staging_deploy", "smoke_tests", "prod_deploy"];
  const state: DeploymentState = {
    id, branch, target,
    stages: stageNames.map(n => ({ name: n, status: "pending" as const })),
    currentStage: 0,
    rollbackSha: stableSha,
    createdAt: Date.now(),
  };
  deployments.set(id, state);
  saveDeployment(state);
  return state;
}

export function advanceStage(id: string, status: "passed" | "failed"): DeploymentState | null {
  const state = deployments.get(id);
  if (!state) return null;
  const stage = state.stages[state.currentStage];
  if (!stage) return null;
  stage.status = status;
  stage.completedAt = Date.now();
  if (status === "failed") { saveDeployment(state); return state; }
  state.currentStage++;
  if (state.currentStage < state.stages.length) {
    state.stages[state.currentStage].status = "running";
    state.stages[state.currentStage].startedAt = Date.now();
  }
  saveDeployment(state);
  return state;
}

export function getDeployment(id: string): DeploymentState | null {
  return deployments.get(id) || null;
}

export function listDeployments(): DeploymentState[] {
  return Array.from(deployments.values());
}

export function executeRollback(deploymentId: string, workDir: string): { ok: boolean; output: string } {
  const state = deployments.get(deploymentId);
  if (!state || !state.rollbackSha) return { ok: false, output: "No rollback SHA available" };
  const safeSha = sanitizeGitSha(state.rollbackSha);
  if (safeSha.length !== 40) return { ok: false, output: "Invalid rollback SHA" };
  try {
    const stashOut = execFileSync("git", ["stash"], { cwd: workDir, encoding: "utf8", timeout: 15000 });
    const checkoutOut = execFileSync("git", ["checkout", safeSha], { cwd: workDir, encoding: "utf8", timeout: 15000 });
    state.stages.forEach(s => { if (s.status === "running") s.status = "pending"; });
    return { ok: true, output: `${stashOut.trim()}\n${checkoutOut.trim()}` };
  } catch (e: any) {
    return { ok: false, output: e.message || String(e) };
  }
}

export function runVerificationScript(scriptPath: string): { passed: boolean; output: string } {
  const resolvedPath = path.resolve(scriptPath);
  if (!fs.existsSync(resolvedPath)) return { passed: false, output: `Script not found: ${resolvedPath}` };
  try {
    const output = execFileSync("bash", [resolvedPath], { encoding: "utf8", timeout: 60000 });
    return { passed: true, output: output.trim() };
  } catch (e: any) {
    return { passed: false, output: e.message || String(e) };
  }
}
