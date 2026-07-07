import { runCurator, CuratorReport } from "./curator";
import { closeDb, pruneTriplets } from "./state-db";
import { memoryConsolidate as fileConsolidate } from "./memory-file-store";
import { loadMcpServers, probeMcpServer, probeProvider } from "./mcp-catalog";
import { contextMonitor } from "./context-monitor";
import { ValidationError } from "./errors";
import { rotateIfNeeded, totalLogSize } from "./log-rotation";
import { logger } from "./logger";
import path from "node:path";
import os from "node:os";

// ── Cron Parser (zero-dependency) ──────────────────────────────────────────

export interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

function parseField(field: string, min: number, max: number): number[] {
  if (field === "*") {
    return Array.from({ length: max - min + 1 }, (_, i) => i + min);
  }
  const results = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
    if (stepMatch) {
      const [, range, stepStr] = stepMatch;
      const step = parseInt(stepStr, 10);
      let start: number, end: number;
      if (range === "*") { start = min; end = max; }
      else if (range.includes("-")) {
        const [s, e] = range.split("-").map(Number);
        start = s; end = e;
      } else {
        start = parseInt(range, 10); end = max;
      }
      for (let v = start; v <= end; v += step) results.add(v);
    } else if (part.includes("-")) {
      const [s, e] = part.split("-").map(Number);
      for (let v = s; v <= e; v++) results.add(v);
    } else if (part === "*") {
      for (let v = min; v <= max; v++) results.add(v);
    } else {
      results.add(parseInt(part, 10));
    }
  }
  return Array.from(results).filter(v => v >= min && v <= max).sort((a, b) => a - b);
}

export function parseCron(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  try {
    const result: ParsedCron = {
      minutes: parseField(parts[0], 0, 59),
      hours: parseField(parts[1], 0, 23),
      daysOfMonth: parseField(parts[2], 1, 31),
      months: parseField(parts[3], 1, 12),
      daysOfWeek: parseField(parts[4], 0, 6),
    };
    if (result.minutes.length === 0 && result.hours.length === 0) return null;
    return result;
  } catch {
    return null;
  }
}

export function validateCron(expression: string): string | null {
  const parsed = parseCron(expression);
  if (!parsed) return "Invalid cron expression. Use 5-field format: minute hour day month weekday";
  if (parsed.minutes.length === 0) return "No valid minutes in cron expression";
  if (parsed.hours.length === 0) return "No valid hours in cron expression";
  return null;
}

export function nextCronTick(cron: ParsedCron, after: Date): Date | null {
  const current = new Date(after);
  current.setUTCSeconds(0, 0);

  const tryTime = (candidate: Date): boolean => {
    if (!cron.months.includes(candidate.getUTCMonth() + 1)) return false;
    const dom = candidate.getUTCDate();
    const dow = candidate.getUTCDay();
    if (cron.daysOfWeek.length === 7 && cron.daysOfMonth.length === 31) {
      // Both unrestricted — accept
    } else if (cron.daysOfWeek.length === 7) {
      if (!cron.daysOfMonth.includes(dom)) return false;
    } else if (cron.daysOfMonth.length === 31) {
      if (!cron.daysOfWeek.includes(dow)) return false;
    } else {
      if (!cron.daysOfMonth.includes(dom) && !cron.daysOfWeek.includes(dow)) return false;
    }
    if (!cron.hours.includes(candidate.getUTCHours())) return false;
    if (!cron.minutes.includes(candidate.getUTCMinutes())) return false;
    return true;
  };

  // Pre-compute next candidate via date math
  // Start with next minute
  current.setUTCMinutes(current.getUTCMinutes() + 1, 0, 0);

  // Try next few hours/minutes using pre-computed fields
  const sortedMinutes = cron.minutes;
  const sortedHours = cron.hours;

  // Check the rest of current hour
  const currentMin = current.getUTCMinutes();
  const nextMin = sortedMinutes.find(m => m >= currentMin);
  if (nextMin !== undefined) {
    current.setUTCMinutes(nextMin, 0, 0);
    if (tryTime(current)) return current;
    current.setUTCMinutes(nextMin + 1, 0, 0);
  }

  // Check remaining hours today
  const currentHour = current.getUTCHours();
  for (let hi = 0; hi < sortedHours.length; hi++) {
    const h = sortedHours[hi];
    if (h < currentHour) continue;
    if (h > currentHour) {
      current.setUTCHours(h, sortedMinutes[0], 0, 0);
      if (tryTime(current)) return current;
    }
    if (h === currentHour) {
      for (const m of sortedMinutes) {
        if (m >= current.getUTCMinutes()) {
          current.setUTCMinutes(m, 0, 0);
          if (tryTime(current)) return current;
        }
      }
    }
  }

  // Try next 365 days
  for (let dayOffset = 1; dayOffset <= 365; dayOffset++) {
    const candidate = new Date(after);
    candidate.setUTCDate(candidate.getUTCDate() + dayOffset);
    candidate.setUTCHours(sortedHours[0], sortedMinutes[0], 0, 0);

    // Check all hour:minute combos for this day
    for (const h of sortedHours) {
      for (const m of sortedMinutes) {
        candidate.setUTCHours(h, m, 0, 0);
        if (tryTime(candidate)) return candidate;
      }
    }
  }

  return null;
}

export function nextCronTickFromExpression(expression: string, after?: Date): Date | null {
  const parsed = parseCron(expression);
  if (!parsed) return null;
  return nextCronTick(parsed, after || new Date());
}

// ── Scheduled Jobs ─────────────────────────────────────────────────────────

export interface CronJob {
  name: string;
  expression: string;
  action: () => Promise<void>;
  enabled: boolean;
}

export interface CronConfig {
  curatorIntervalMs: number;
  consolidationIntervalMs: number;
  dbCleanupIntervalMs: number;
  healthCheckIntervalMs: number;
  customJobs: CronJob[];
}

const DEFAULT_CONFIG: CronConfig = {
  curatorIntervalMs: 6 * 60 * 60 * 1000,
  consolidationIntervalMs: 1 * 60 * 60 * 1000,
  dbCleanupIntervalMs: 24 * 60 * 60 * 1000,
  healthCheckIntervalMs: 5 * 60 * 1000,
  customJobs: [],
};

let timers: ReturnType<typeof setInterval>[] = [];
let isRunning = false;
let registeredJobs: CronJob[] = [];

// ── Exponential Backoff ─────────────────────────────────────────────────────

interface BackoffEntry {
  attempt: number;
  nextRetryAt: number;
}

const backoffState = new Map<string, BackoffEntry>();

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 1_728_000_000; // 20 days
const BACKOFF_MULTIPLIER = 2;

function computeBackoff(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

function recordFailure(key: string): void {
  const entry = backoffState.get(key) || { attempt: 0, nextRetryAt: 0 };
  entry.attempt++;
  entry.nextRetryAt = Date.now() + computeBackoff(entry.attempt);
  backoffState.set(key, entry);
}

function recordSuccess(key: string): void {
  backoffState.delete(key);
}

function shouldSkip(key: string): boolean {
  const entry = backoffState.get(key);
  if (!entry) return false;
  return Date.now() < entry.nextRetryAt;
}

function withBackoff<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (shouldSkip(key)) return Promise.resolve(undefined);
  return fn().then(
    (result) => { recordSuccess(key); return result; },
    (err) => { recordFailure(key); throw err; },
  );
}

// ── Log Rotation ────────────────────────────────────────────────────────────

import { PATHS } from "./config";

const LOG_DIR = PATHS.LOGS;

async function rotateLogFiles(): Promise<void> {
  await rotateIfNeeded(path.join(LOG_DIR, "session.log"));
  await rotateIfNeeded(path.join(LOG_DIR, "agent.log"));
  await rotateIfNeeded(path.join(LOG_DIR, "costs.jsonl"));
}

export interface CuratorCallback {
  (report: CuratorReport): void;
}

export function startCronJobs(
  model: any,
  auth: { apiKey?: string; headers?: Record<string, string> },
  config: Partial<CronConfig> = {},
  onCuratorComplete?: CuratorCallback,
): void {
  if (isRunning) return;
  isRunning = true;

  const cfg = { ...DEFAULT_CONFIG, ...config };
  registeredJobs = cfg.customJobs;

  // Curator job — with exponential backoff
  const curatorTimer = setInterval(async () => {
    await withBackoff("curator", async () => {
      const report = await runCurator(model, auth);
      if (onCuratorComplete) onCuratorComplete(report);
    });
  }, cfg.curatorIntervalMs);

  // File consolidation job — with exponential backoff
  const consolidationTimer = setInterval(async () => {
    await withBackoff("consolidation", async () => {
      await fileConsolidate("memory");
      await fileConsolidate("user");
    });
  }, cfg.consolidationIntervalMs);

  // DB cleanup / maintenance — prune stale triplets, then reopen
  const dbTimer = setInterval(() => {
    withBackoff("db-cleanup", async () => {
      const result = pruneTriplets();
      if (result.staleDeleted > 0 || result.redundantMerged > 0) {
        // Triplet housekeeping happened
      }
      closeDb();
      return result;
    });
  }, cfg.dbCleanupIntervalMs);

  // Health check job — probe enabled MCP servers and known providers
  const healthTimer = setInterval(async () => {
    await withBackoff("health-check", async () => {
      const servers = loadMcpServers().filter(s => s.enabled);
      await Promise.allSettled(servers.map(s => probeMcpServer(s.id)));
      await Promise.allSettled([
        probeProvider("anthropic", process.env.ANTHROPIC_API_KEY),
        probeProvider("openai", process.env.OPENAI_API_KEY),
        probeProvider("google", process.env.GEMINI_API_KEY),
      ]);
      contextMonitor.writeTelemetrySnapshot();
      await contextMonitor.flushAutoLearn();
    });
  }, cfg.healthCheckIntervalMs);

  // Log rotation job
  const logRotationTimer = setInterval(async () => {
    await withBackoff("log-rotation", async () => {
      await rotateLogFiles();
    });
  }, 24 * 60 * 60 * 1000); // once per day

  timers = [curatorTimer, consolidationTimer, dbTimer, healthTimer, logRotationTimer];

  // Schedule any custom cron jobs registered before start
  for (const job of registeredJobs) {
    if (job.enabled) scheduleCustomJob(job);
  }
}

export function stopCronJobs(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
  isRunning = false;
  registeredJobs = [];
}

export function isCronRunning(): boolean {
  return isRunning;
}

function scheduleCustomJob(job: CronJob): void {
  const parsed = parseCron(job.expression);
  if (!parsed) return;

  // Use setInterval with real-time check to avoid clock jump issues
  const timer = setInterval(async () => {
    const now = new Date();
    const tick = nextCronTick(parsed, new Date(now.getTime() - 60000));
    if (tick && Math.abs(tick.getTime() - now.getTime()) < 120000) {
      try { await job.action(); } catch { logger.warn("Custom cron job failed", { name: job.name }); }
    }
  }, 60_000);
  timers.push(timer as any);
}

export function registerJob(name: string, expression: string, action: () => Promise<void>): void {
  const err = validateCron(expression);
  if (err) throw new ValidationError(`Cron job "${name}": ${err}`);
  const job: CronJob = { name, expression, action, enabled: true };
  registeredJobs.push(job);
  if (isRunning) scheduleCustomJob(job);
}

export function listJobs(): CronJob[] {
  return [...registeredJobs];
}
