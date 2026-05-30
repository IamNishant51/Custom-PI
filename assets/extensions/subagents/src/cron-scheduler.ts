import { runCurator, CuratorReport } from "./curator";
import { closeDb } from "./state-db";
import { memoryConsolidate as fileConsolidate, getMemoryStats } from "./memory-file-store";

export interface CronConfig {
  curatorIntervalMs: number;
  consolidationIntervalMs: number;
  dbCleanupIntervalMs: number;
}

const DEFAULT_CONFIG: CronConfig = {
  curatorIntervalMs: 6 * 60 * 60 * 1000,   // Every 6 hours
  consolidationIntervalMs: 1 * 60 * 60 * 1000, // Every 1 hour
  dbCleanupIntervalMs: 24 * 60 * 60 * 1000,    // Every 24 hours
};

let timers: ReturnType<typeof setInterval>[] = [];
let isRunning = false;

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

  // Curator job
  const curatorTimer = setInterval(async () => {
    try {
      const report = await runCurator(model, auth);
      if (onCuratorComplete) onCuratorComplete(report);
    } catch {
      // Silent fail
    }
  }, cfg.curatorIntervalMs);

  // File consolidation job
  const consolidationTimer = setInterval(async () => {
    try {
      await fileConsolidate("memory");
      await fileConsolidate("user");
    } catch {
      // Silent fail
    }
  }, cfg.consolidationIntervalMs);

  // DB cleanup / maintenance
  const dbTimer = setInterval(() => {
    try {
      closeDb();
      // Re-open will happen on next access
    } catch {
      // Silent fail
    }
  }, cfg.dbCleanupIntervalMs);

  timers = [curatorTimer, consolidationTimer, dbTimer];
}

export function stopCronJobs(): void {
  for (const t of timers) {
    clearInterval(t);
  }
  timers = [];
  isRunning = false;
}

export function isCronRunning(): boolean {
  return isRunning;
}
