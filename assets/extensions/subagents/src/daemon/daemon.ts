import { PATHS } from "../config";
import { logger } from "../logger";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { bus, Topics } from "../event-bus/event-bus";
import { getSystemStore } from "../system-store";

export type DaemonState = "idle" | "active" | "sleeping" | "error" | "shutdown";
export type TaskPriority = "critical" | "high" | "normal" | "low";

interface DaemonTask {
  id: string;
  name: string;
  priority: TaskPriority;
  execute: () => Promise<void>;
  interval?: number;
  scheduledAt?: number;
  lastRun?: number;
  cronExpression?: string;
  runsOnIdle?: boolean;
  timeout?: number;
}

interface DaemonConfig {
  tickInterval: number;
  idleThreshold: number;
  maxConcurrentTasks: number;
  stateFile: string;
  autoRecovery: boolean;
}

interface DaemonStats {
  uptime: number;
  totalTicks: number;
  tasksExecuted: number;
  tasksFailed: number;
  tasksSkipped: number;
  currentState: DaemonState;
  activeTasks: number;
}

export class Daemon extends EventEmitter {
  private tasks: Map<string, DaemonTask> = new Map();
  private taskQueue: DaemonTask[] = [];
  private running = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private state: DaemonState = "idle";
  private config: DaemonConfig;
  private stats: DaemonStats;
  private lastUserActivity = Date.now();
  private idleSince: number | null = null;
  private tickCount = 0;
  private startTime = Date.now();
  private sigtermHandler: (() => void) | null = null;

  constructor(config?: Partial<DaemonConfig>) {
    super();
    this.config = {
      tickInterval: 5000,
      idleThreshold: 120_000,
      maxConcurrentTasks: 3,
      stateFile: PATHS.DAEMON_STATE,
      autoRecovery: true,
      ...config,
    };
    this.stats = {
      uptime: 0,
      totalTicks: 0,
      tasksExecuted: 0,
      tasksFailed: 0,
      tasksSkipped: 0,
      currentState: "idle",
      activeTasks: 0,
    };
  }

  start(): void {
    if (this.tickTimer) return;
    this.state = "idle";
    this.startTime = Date.now();
    this.loadState();
    bus.emit(Topics.DAEMON_TICK, { action: "start", timestamp: Date.now() }, { source: "daemon" });

    this.startAdaptiveTick();

    bus.on(Topics.MESSAGE_RECEIVED, () => { this.lastUserActivity = Date.now(); this.idleSince = null; });
    bus.on(Topics.TOOL_CALL, () => { this.lastUserActivity = Date.now(); this.idleSince = null; });
    bus.on(Topics.USER_ACTION, () => { this.lastUserActivity = Date.now(); this.idleSince = null; });

    bus.on(Topics.DAEMON_TASK, async (event) => {
      const task = event.data as DaemonTask;
      this.registerTask(task);
    });

    this.sigtermHandler = () => this.gracefulShutdown();
    process.on("SIGTERM", this.sigtermHandler);
    process.on("SIGINT", this.sigtermHandler);
  }

  stop(): void {
    this.gracefulShutdown();
  }

  private gracefulShutdown(): void {
    if (this.state === "shutdown") return;
    this.state = "shutdown";
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.saveState();
    if (this.sigtermHandler) {
      process.off("SIGTERM", this.sigtermHandler);
      process.off("SIGINT", this.sigtermHandler);
      this.sigtermHandler = null;
    }
    bus.emit(Topics.SYSTEM_SHUTDOWN, { action: "daemon_stop", uptime: this.getUptime() }, { source: "daemon" });
  }

  private startAdaptiveTick(): void {
    const tick = () => {
      this.tick();
      const isIdle = this.isIdle();
      const interval = isIdle ? 5000 : 500;
      this.tickTimer = setTimeout(tick, interval) as unknown as ReturnType<typeof setInterval>;
    };
    this.tickTimer = setTimeout(tick, this.config.tickInterval) as unknown as ReturnType<typeof setInterval>;
  }

  getHealth(): { status: string; uptime: number; state: DaemonState; tasks: { total: number; running: number; queued: number } } {
    return {
      status: this.state === "error" ? "degraded" : "healthy",
      uptime: this.getUptime(),
      state: this.state,
      tasks: {
        total: this.tasks.size,
        running: this.running.size,
        queued: this.taskQueue.length,
      },
    };
  }

  registerTask(task: DaemonTask): void {
    this.tasks.set(task.id, task);
    if (task.priority === "critical" || task.priority === "high") {
      this.taskQueue.push(task);
    }
    this.saveState();
  }

  unregisterTask(id: string): boolean {
    const removed = this.tasks.delete(id);
    this.taskQueue = this.taskQueue.filter(t => t.id !== id);
    this.running.delete(id);
    return removed;
  }

  reportUserActivity(): void {
    this.lastUserActivity = Date.now();
    this.idleSince = null;
  }

  isIdle(): boolean {
    return Date.now() - this.lastUserActivity > this.config.idleThreshold;
  }

  getIdleDuration(): number {
    return Date.now() - this.lastUserActivity;
  }

  getState(): DaemonState {
    return this.state;
  }

  getStats(): DaemonStats {
    return {
      ...this.stats,
      uptime: this.getUptime(),
      activeTasks: this.running.size,
      currentState: this.state,
    };
  }

  getTasks(): DaemonTask[] {
    return Array.from(this.tasks.values());
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }

  private async tick(): Promise<void> {
    this.tickCount++;
    this.stats.totalTicks = this.tickCount;
    this.stats.uptime = this.getUptime();

    if (this.isIdle()) {
      if (this.state !== "active") {
        this.state = "active";
        this.idleSince = this.idleSince || Date.now();
        bus.emit(Topics.DAEMON_IDLE, { idleDuration: this.getIdleDuration() }, { source: "daemon" });
      }
      this.runBackgroundTasks();
    } else {
      this.state = "idle";
      this.idleSince = null;
    }

    this.processScheduledTasks();
    this.saveState();
  }

  private async runBackgroundTasks(): Promise<void> {
    const idleTasks = Array.from(this.tasks.values())
      .filter(t => t.runsOnIdle && !this.running.has(t.id))
      .sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority));

    for (const task of idleTasks) {
      if (this.running.size >= this.config.maxConcurrentTasks) break;
      this.executeTask(task);
    }
  }

  private async processScheduledTasks(): Promise<void> {
    const now = Date.now();
    const dueTasks = Array.from(this.tasks.values())
      .filter(t => {
        if (this.running.has(t.id)) return false;
        if (!t.interval && !t.scheduledAt) return false;
        if (t.interval && t.lastRun) {
          return now - t.lastRun >= t.interval;
        }
        if (t.interval && !t.lastRun) return true;
        if (t.scheduledAt) return now >= t.scheduledAt;
        return false;
      })
      .sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority));

    for (const task of dueTasks) {
      if (this.running.size >= this.config.maxConcurrentTasks) {
        this.stats.tasksSkipped++;
        break;
      }
      this.executeTask(task);
    }
  }

  private async executeTask(task: DaemonTask): Promise<void> {
    if (this.running.has(task.id)) return;
    this.running.add(task.id);

    try {
      const timeout = task.timeout || 30_000;
      const result = task.execute();
      await Promise.race([
        result,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Task ${task.name} timed out after ${timeout}ms`)), timeout)),
      ]);
      task.lastRun = Date.now();
      this.stats.tasksExecuted++;
      bus.emit(Topics.DAEMON_TICK, { taskId: task.id, taskName: task.name, status: "completed" }, { source: "daemon" });
    } catch (err: any) {
      this.stats.tasksFailed++;
      bus.emit(Topics.SYSTEM_ERROR, { source: "daemon", task: task.name, error: err.message }, { source: "daemon" });
    } finally {
      this.running.delete(task.id);
    }
  }

  private priorityWeight(priority: TaskPriority): number {
    switch (priority) {
      case "critical": return 100;
      case "high": return 50;
      case "normal": return 10;
      case "low": return 1;
    }
  }

  private saveState(): void {
    try {
      const store = getSystemStore();
      const tasksData = Array.from(this.tasks.values()).map(t => ({
        id: t.id,
        name: t.name,
        priority: t.priority,
        interval: t.interval,
        scheduledAt: t.scheduledAt,
        lastRun: t.lastRun,
        runsOnIdle: t.runsOnIdle,
        timeout: t.timeout,
      }));
      store.kvSet("daemon", "tasks", JSON.stringify(tasksData));
      store.kvSet("daemon", "stats", JSON.stringify(this.stats));
      store.kvSet("daemon", "lastUserActivity", String(this.lastUserActivity));
      store.kvSet("daemon", "startTime", String(this.startTime));
    } catch (err) {
      console.error("[Daemon] Failed to save state:", err);
    }
  }

  private loadState(): void {
    try {
      const store = getSystemStore();
      const tasksRaw = store.kvGet("daemon", "tasks");
      if (tasksRaw) {
        const tasks: Array<{
          id: string; name: string; priority: TaskPriority;
          interval?: number; scheduledAt?: number; lastRun?: number;
          runsOnIdle?: boolean; timeout?: number;
        }> = JSON.parse(tasksRaw);
        for (const t of tasks) {
          if (!this.tasks.has(t.id)) {
            this.tasks.set(t.id, {
              id: t.id,
              name: t.name || t.id,
              priority: t.priority || "normal",
              execute: async () => {},
              interval: t.interval,
              scheduledAt: t.scheduledAt,
              lastRun: t.lastRun,
              runsOnIdle: t.runsOnIdle,
              timeout: t.timeout,
            });
          }
        }
      }
      const statsRaw = store.kvGet("daemon", "stats");
      if (statsRaw) {
        this.stats = { ...this.stats, ...JSON.parse(statsRaw), uptime: this.getUptime() };
      }
      const lastActivity = store.kvGet("daemon", "lastUserActivity");
      if (lastActivity) this.lastUserActivity = Number(lastActivity);
      const savedStart = store.kvGet("daemon", "startTime");
      if (savedStart) this.startTime = Number(savedStart);
    } catch (err) {
      console.error("[Daemon] Failed to load state from SQLite:", err);
      try {
        if (!fs.existsSync(this.config.stateFile)) return;
        const data = JSON.parse(fs.readFileSync(this.config.stateFile, "utf8"));
        if (data.tasks && Array.isArray(data.tasks)) {
          for (const t of data.tasks) {
            if (!this.tasks.has(t.id)) {
              this.tasks.set(t.id, {
                id: t.id,
                name: t.name || t.id,
                priority: t.priority || "normal",
                execute: async () => {},
                interval: t.interval,
                scheduledAt: t.scheduledAt,
                lastRun: t.lastRun,
                runsOnIdle: t.runsOnIdle,
              });
            }
          }
        }
        if (data.stats) {
          this.stats = { ...this.stats, ...data.stats, uptime: this.getUptime() };
        }
        if (data.lastUserActivity) this.lastUserActivity = data.lastUserActivity;

        // Migrate JSON state to SQLite
        try {
          this.saveState();
          const store = getSystemStore();
          store.kvSet("daemon", "_migrated", "1");
        } catch { /* non-critical migration */ }
      } catch { logger.warn("empty catch block") }
    }
  }

  static createIdleTask(name: string, fn: () => Promise<void>, priority: TaskPriority = "low"): DaemonTask {
    return {
      id: `idle_${name.toLowerCase().replace(/\s+/g, "_")}`,
      name,
      priority,
      execute: fn,
      runsOnIdle: true,
    };
  }

  static createIntervalTask(name: string, fn: () => Promise<void>, intervalMs: number, priority: TaskPriority = "normal"): DaemonTask {
    return {
      id: `int_${name.toLowerCase().replace(/\s+/g, "_")}`,
      name,
      priority,
      execute: fn,
      interval: intervalMs,
    };
  }

  static createScheduledTask(name: string, fn: () => Promise<void>, timestamp: number, priority: TaskPriority = "normal"): DaemonTask {
    return {
      id: `sched_${name.toLowerCase().replace(/\s+/g, "_")}`,
      name,
      priority,
      execute: fn,
      scheduledAt: timestamp,
    };
  }
}

let _daemon: Daemon | null = null;
export function getDaemon(config?: Partial<DaemonConfig>): Daemon {
  if (!_daemon) _daemon = new Daemon(config);
  return _daemon;
}

export function startDaemon(config?: Partial<DaemonConfig>): Daemon {
  const d = getDaemon(config);
  d.start();
  return d;
}

export function stopDaemon(): void {
  if (_daemon) { _daemon.stop(); _daemon = null; }
}
