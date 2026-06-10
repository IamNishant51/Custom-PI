import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { bus, Topics } from "../event-bus/event-bus";
import { getDaemon, Daemon } from "../daemon/daemon";
import { logger } from "../logger";
import Database from "better-sqlite3";

type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

interface HealthCheck {
  name: string;
  check: () => Promise<HealthStatus>;
  severity: "critical" | "high" | "medium" | "low";
  recovery?: () => Promise<boolean>;
}

interface HealthReport {
  name: string;
  status: HealthStatus;
  severity: string;
  details: string;
  lastOK: number;
  lastFail: number;
  failureCount: number;
}

interface RecoveryAction {
  id: string;
  name: string;
  description: string;
  execute: () => Promise<boolean>;
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
  createdAt: number;
  completedAt?: number;
  success?: boolean;
}

export class SelfHealer {
  private healthChecks: HealthCheck[] = [];
  private healthHistory: Map<string, HealthReport> = new Map();
  private recoveryActions: RecoveryAction[] = [];
  private isHealing = false;

  private _initialized = false;
  private _listenerIds: string[] = [];

  /** Initialize: register checks, setup listeners, start background task. Safe to call multiple times. */
  init(): void {
    if (this._initialized) return;
    this._initialized = true;
    this.registerDefaultChecks();
    this.setupListeners();
    this.registerBackgroundTask();
  }

  /** Destroy: clean up listeners and state. */
  destroy(): void {
    for (const id of this._listenerIds) {
      bus.unsubscribe(id);
    }
    this._listenerIds = [];
    this.healthChecks = [];
    this.healthHistory.clear();
    this.recoveryActions = [];
    this._initialized = false;
  }

  constructor() {
    // No side effects in constructor — call init() explicitly
  }

  private registerDefaultChecks(): void {
    this.registerCheck({
      name: "sqlite-database",
      severity: "critical",
      check: async () => {
        try {
          const dbPath = path.join(os.homedir(), ".pi", "agent", "session-state.db");
          if (!fs.existsSync(dbPath)) return "degraded";
          const dbCheck = new Database(dbPath, { readonly: true });
          const result = dbCheck.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
          dbCheck.close();
          if (result.length > 0 && result[0]?.integrity_check === "ok") return "healthy";
          return "unhealthy";
        } catch (err) {
          logger.error("SQLite integrity check failed", { error: String(err) });
          return "unhealthy";
        }
      },
      recovery: async () => {
        try {
          const dbPath = path.join(os.homedir(), ".pi", "agent", "session-state.db");
          if (fs.existsSync(dbPath + "-wal")) {
            const dbRecover = new Database(dbPath);
            dbRecover.pragma("wal_checkpoint(TRUNCATE)");
            dbRecover.close();
          }
          return true;
        } catch (err) {
          logger.error("SQLite WAL recovery failed", { error: String(err) });
          return false;
        }
      },
    });

    this.registerCheck({
      name: "event-bus",
      severity: "critical",
      check: async () => {
        try {
          const { bus } = await import("../event-bus/event-bus");
          const count = bus.getEventCount();
          return count >= 0 ? "healthy" : "unhealthy";
        } catch { return "unhealthy"; }
      },
    });

    this.registerCheck({
      name: "disk-space",
      severity: "high",
      check: async () => {
        try {
          const result = execSync("df -BG ~ | tail -1", { encoding: "utf8", timeout: 3000 });
          const parts = result.trim().split(/\s+/);
          const usedPercent = parseInt(parts[4]?.replace("%", "") || "0");
          if (usedPercent > 95) return "unhealthy";
          if (usedPercent > 85) return "degraded";
          return "healthy";
        } catch { return "unknown"; }
      },
      recovery: async () => {
        try {
          const logDir = path.join(os.homedir(), ".pi", "agent");
          const archives = fs.readdirSync(logDir).filter(f => f.endsWith(".log") || f.includes("prune-log"));
          for (const f of archives) {
            const fp = path.join(logDir, f);
            if (fs.statSync(fp).size > 50 * 1024 * 1024) {
              fs.truncateSync(fp, 0);
            }
          }
          return true;
        } catch { return false; }
      },
    });

    this.registerCheck({
      name: "memory-file",
      severity: "high",
      check: async () => {
        try {
          const memFile = path.join(os.homedir(), ".pi", "agent", "memory", "semantic.json");
          if (!fs.existsSync(memFile)) return "degraded";
          const content = fs.readFileSync(memFile, "utf8");
          JSON.parse(content);
          return "healthy";
        } catch { return "unhealthy"; }
      },
    });

    this.registerCheck({
      name: "node-process",
      severity: "medium",
      check: async () => {
        const memUsage = process.memoryUsage();
        if (memUsage.heapUsed > memUsage.heapTotal * 0.9) return "degraded";
        return "healthy";
      },
    });

    this.registerCheck({
      name: "network-connectivity",
      severity: "medium",
      check: async () => {
        try {
          await fetch("https://clients3.google.com/generate_204", { signal: AbortSignal.timeout(5000) });
          return "healthy";
        } catch { return "unhealthy"; }
      },
    });
  }

  private setupListeners(): void {
    const id1 = bus.on(Topics.SYSTEM_ERROR, (event) => {
      const error = event.data;
      this.handleError(error.source, error.error || error.message);
    });
    this._listenerIds.push(id1);

    const id2 = bus.on(Topics.TOOL_ERROR, (event) => {
      if (event.data.error?.includes("database") || event.data.error?.includes("SQLITE")) {
        this.triggerRecovery("sqlite-database");
      }
    });
    this._listenerIds.push(id2);
  }

  private registerBackgroundTask(): void {
    const daemon = getDaemon();
    daemon.registerTask(Daemon.createIntervalTask(
      "self-healer:health-check",
      async () => { await this.runAllChecks(); },
      300_000
    ));
  }

  registerCheck(check: HealthCheck): void {
    this.healthChecks.push(check);
  }

  async runAllChecks(): Promise<HealthReport[]> {
    const reports: HealthReport[] = [];

    for (const check of this.healthChecks) {
      try {
        const status = await check.check();
        const now = Date.now();
        const report: HealthReport = {
          name: check.name,
          status,
          severity: check.severity,
          details: `Health check returned: ${status}`,
          lastOK: status === "healthy" ? now : this.healthHistory.get(check.name)?.lastOK || now,
          lastFail: status !== "healthy" ? now : this.healthHistory.get(check.name)?.lastFail || 0,
          failureCount: status !== "healthy" ? (this.healthHistory.get(check.name)?.failureCount || 0) + 1 : 0,
        };

        this.healthHistory.set(check.name, report);
        reports.push(report);

        if (status !== "healthy") {
          bus.emit(Topics.HEALTH_ALERT, {
            component: check.name,
            status,
            severity: check.severity,
            failureCount: report.failureCount,
          }, { source: "self-healer" });

          if (report.failureCount >= 3 && check.recovery) {
            await this.autoHeal(check.name);
          }
        } else {
          const prev = this.healthHistory.get(check.name);
          if (prev && prev.status !== "healthy") {
            bus.emit(Topics.HEALTH_RECOVER, { component: check.name }, { source: "self-healer" });
          }
        }
      } catch (err) {
        reports.push({
          name: check.name,
          status: "unknown",
          severity: check.severity,
          details: `Check failed: ${err instanceof Error ? err.message : String(err)}`,
          lastOK: 0, lastFail: Date.now(), failureCount: 1,
        });
      }
    }

    return reports;
  }

  getHealthStatus(): { overall: HealthStatus; checks: HealthReport[] } {
    const checks = Array.from(this.healthHistory.values());
    const hasUnhealthy = checks.some(c => c.status === "unhealthy");
    const hasDegraded = checks.some(c => c.status === "degraded");
    return {
      overall: hasUnhealthy ? "unhealthy" : hasDegraded ? "degraded" : "healthy",
      checks,
    };
  }

  getRecoveryActions(): RecoveryAction[] {
    return this.recoveryActions.filter(a => !a.completedAt);
  }

  private async autoHeal(component: string): Promise<void> {
    if (this.isHealing) return;
    this.isHealing = true;

    const check = this.healthChecks.find(c => c.name === component);
    if (!check?.recovery) { this.isHealing = false; return; }

    try {
      const success = await check.recovery();
      const actionId = `recover_${Date.now()}`;
      this.recoveryActions.push({
        id: actionId,
        name: `Auto-heal: ${component}`,
        description: `Automatic recovery attempted for ${component}`,
        execute: async () => success,
        risk: "low",
        requiresApproval: false,
        createdAt: Date.now(),
        completedAt: Date.now(),
        success,
      });

      if (success) {
        bus.emit(Topics.SYSTEM_WARNING, {
          source: "self-healer",
          message: `Auto-recovered ${component} successfully`,
        }, { source: "self-healer" });
      } else {
        bus.emit(Topics.SYSTEM_ERROR, {
          source: "self-healer",
          error: `Failed to auto-recover ${component}. Manual intervention required.`,
        }, { source: "self-healer" });
      }
    } catch (err) {
      bus.emit(Topics.SYSTEM_ERROR, {
        source: "self-healer",
        error: `Auto-recovery of ${component} threw: ${err instanceof Error ? err.message : String(err)}`,
      }, { source: "self-healer" });
    }

    this.isHealing = false;
  }

  public handleError(source: string, error: string): void {
    const name = `error_${source}`;
    const report: HealthReport = {
      name,
      status: "unhealthy",
      severity: "medium",
      details: error.slice(0, 500),
      lastOK: this.healthHistory.get(name)?.lastOK || Date.now(),
      lastFail: Date.now(),
      failureCount: (this.healthHistory.get(name)?.failureCount || 0) + 1,
    };
    this.healthHistory.set(name, report);

    if (report.failureCount >= 3) {
      this.autoHeal(name);
    }
  }

  private async triggerRecovery(component: string): Promise<void> {
    const check = this.healthChecks.find(c => c.name === component);
    if (check?.recovery) await check.recovery();
  }
}

export const selfHealer = new SelfHealer();
