import { runCurator, CuratorReport } from "./curator";
import { closeDb, pruneTriplets } from "./state-db";
import { memoryConsolidate as fileConsolidate } from "./memory-file-store";
import { loadMcpServers, probeMcpServer, probeProvider } from "./mcp-catalog";
import { contextMonitor } from "./context-monitor";

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
  const MAX_ITERATIONS = 2_100_000;
  let current = new Date(after);
  current.setUTCSeconds(0, 0);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    current.setUTCMinutes(current.getUTCMinutes() + 1);

    if (!cron.months.includes(current.getUTCMonth() + 1)) continue;
    const dom = current.getUTCDate();
    const dow = current.getUTCDay();
    if (cron.daysOfWeek.length === 7 && cron.daysOfMonth.length === 31) {
      // Both unrestricted — accept
    } else if (cron.daysOfWeek.length === 7) {
      // Only day-of-month restricted
      if (!cron.daysOfMonth.includes(dom)) continue;
    } else if (cron.daysOfMonth.length === 31) {
      // Only day-of-week restricted
      if (!cron.daysOfWeek.includes(dow)) continue;
    } else {
      // Both restricted — match EITHER
      if (!cron.daysOfMonth.includes(dom) && !cron.daysOfWeek.includes(dow)) continue;
    }
    if (!cron.hours.includes(current.getUTCHours())) continue;
    if (!cron.minutes.includes(current.getUTCMinutes())) continue;

    return current;
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

  // Curator job
  const curatorTimer = setInterval(async () => {
    try {
      const report = await runCurator(model, auth);
      if (onCuratorComplete) onCuratorComplete(report);
    } catch { /* silent */ }
  }, cfg.curatorIntervalMs);

  // File consolidation job
  const consolidationTimer = setInterval(async () => {
    try {
      await fileConsolidate("memory");
      await fileConsolidate("user");
    } catch { /* silent */ }
  }, cfg.consolidationIntervalMs);

  // DB cleanup / maintenance — prune stale triplets, then reopen
  const dbTimer = setInterval(() => {
    try {
      const result = pruneTriplets();
      if (result.staleDeleted > 0 || result.redundantMerged > 0) {
        // Triplet housekeeping happened
      }
    } catch { /* silent */ }
    try { closeDb(); } catch { /* silent */ }
  }, cfg.dbCleanupIntervalMs);

  // Health check job — probe enabled MCP servers and known providers
  const healthTimer = setInterval(async () => {
    try {
      const servers = loadMcpServers().filter(s => s.enabled);
      await Promise.allSettled(servers.map(s => probeMcpServer(s.id)));
      await Promise.allSettled([
        probeProvider("anthropic", process.env.ANTHROPIC_API_KEY),
        probeProvider("openai", process.env.OPENAI_API_KEY),
        probeProvider("google", process.env.GEMINI_API_KEY),
      ]);
      contextMonitor.writeTelemetrySnapshot();
      await contextMonitor.flushAutoLearn();
    } catch { /* silent */ }
  }, cfg.healthCheckIntervalMs);

  timers = [curatorTimer, consolidationTimer, dbTimer, healthTimer];
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

export function registerJob(name: string, expression: string, action: () => Promise<void>): void {
  const err = validateCron(expression);
  if (err) throw new Error(`Cron job "${name}": ${err}`);
  registeredJobs.push({ name, expression, action, enabled: true });
}

export function listJobs(): CronJob[] {
  return [...registeredJobs];
}
