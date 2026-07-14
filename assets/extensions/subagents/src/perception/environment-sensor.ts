import { logger } from "../logger";
import fs from "node:fs";
import os from "node:os";
import cp from "node:child_process";
import { bus, Topics } from "../event-bus/event-bus";

export interface EnvironmentState {
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  cpuModel: string;
  cpuCores: number;
  cpuUsage: number;
  memoryTotalGb: number;
  memoryFreeGb: number;
  memoryUsagePercent: number;
  diskTotalGb: number;
  diskFreeGb: number;
  diskUsagePercent: number;
  uptime: number;
  loadAvg: number[];
  processes: number;
  networkInterfaces: string[];
  isLinux: boolean;
  isWSL: boolean;
  hasDocker: boolean;
  hasGit: boolean;
  hasNode: boolean;
  hasNpm: boolean;
  homeDir: string;
  tempDir: string;
  shell: string;
  timezone: string;
  locale: string;
}

export interface FileChange {
  type: "created" | "modified" | "deleted";
  path: string;
  timestamp: number;
  size?: number;
}

export interface SubProcessHealth {
  subAgents: { running: number; total: number; names: string[] };
  mcpServers: { name: string; alive: boolean; pid?: number }[];
  bridges: { email: boolean; social: boolean };
  status: "healthy" | "degraded" | "unhealthy";
}

export interface NetworkAvailability {
  lmStudio: boolean;
  ollama: boolean;
  apiEndpoints: Record<string, boolean>;
}

export interface IDEDetection {
  vscode: boolean;
  neovim: boolean;
  activeFiles?: string[];
}

export class EnvironmentSensor {
  private watchers: fs.FSWatcher[] = [];
  private recentChanges: FileChange[] = [];
  private maxRecentChanges = 1000;
  private watchPaths: string[] = [];
  private environmentState: EnvironmentState | null = null;

  // Cached static info that doesn't change during the session
  private staticInfo: {
    hostname: string;
    platform: string;
    arch: string;
    nodeVersion: string;
    cpuModel: string;
    cpuCores: number;
    memoryTotalGb: number;
    networkInterfaces: string[];
    isLinux: boolean;
    isWSL: boolean;
    hasDocker: boolean;
    hasGit: boolean;
    hasNpm: boolean;
    homeDir: string;
    tempDir: string;
    shell: string;
    timezone: string;
    locale: string;
  } | null = null;

  // Cached disk usage to avoid running df -BG continuously
  private lastDiskUsage: { totalGb: number; freeGb: number; usedPercent: number } | null = null;
  private lastDiskCheck = 0;

  constructor() {
    this.captureEnvironment();
    bus.emit(Topics.ENVIRONMENT_CHANGE, {
      action: "initialized",
      state: this.getEnvironment(),
    }, { source: "environment-sensor" });
  }

  getEnvironment(): EnvironmentState {
    if (!this.environmentState) this.captureEnvironment();
    return this.environmentState!;
  }

  refreshEnvironment(): EnvironmentState {
    this.captureEnvironment();
    return this.environmentState!;
  }

  watchDirectory(dirPath: string, recursive = false): void {
    if (!fs.existsSync(dirPath)) return;
    if (this.watchPaths.includes(dirPath)) return;
    if (dirPath.includes("/.cache/") || dirPath.includes("/node_modules/") || dirPath.includes("/.git/")) return;
    this.watchPaths.push(dirPath);

    try {
      const watcher = fs.watch(dirPath, { recursive }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = dirPath + (filename.startsWith("/") ? "" : "/") + filename;
        let type: FileChange["type"];
        switch (eventType) {
          case "rename":
            type = fs.existsSync(fullPath) ? "created" : "deleted";
            break;
          case "change":
            type = "modified";
            break;
          default:
            type = "modified";
        }
        let size: number | undefined;
        try { size = fs.statSync(fullPath).size; } catch { size = undefined; }
        const change: FileChange = {
          type,
          path: fullPath,
          timestamp: Date.now(),
          size,
        };
        this.recentChanges.push(change);
        if (this.recentChanges.length > this.maxRecentChanges) {
          this.recentChanges.splice(0, this.recentChanges.length - this.maxRecentChanges);
        }
        bus.emit(Topics.FILE_CHANGED, change, { source: "environment-sensor" });
      });
      this.watchers.push(watcher);
    } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
  }

  unwatchDirectory(dirPath: string): void {
    this.watchPaths = this.watchPaths.filter(p => p !== dirPath);
  }

  getRecentChanges(since?: number): FileChange[] {
    if (since) return this.recentChanges.filter(c => c.timestamp >= since);
    return this.recentChanges.slice(-100);
  }

  getGitState(dir?: string): { branch: string; dirty: boolean; ahead: number; behind: number; lastCommit: string } | null {
    try {
      const targetDir = dir || process.cwd();
      const branch = cp.execSync("git rev-parse --abbrev-ref HEAD", { cwd: targetDir, encoding: "utf8", timeout: 5000 }).trim();
      const status = cp.execSync("git status --porcelain", { cwd: targetDir, encoding: "utf8", timeout: 5000 });
      const dirty = status.trim().length > 0;
      const lastCommit = cp.execSync("git log --oneline -1", { cwd: targetDir, encoding: "utf8", timeout: 5000 }).trim();
      return { branch, dirty, ahead: 0, behind: 0, lastCommit };
    } catch {
      return null;
    }
  }

  isProcessRunning(processName: string): boolean {
    try {
      const result = cp.execSync(`pgrep -x ${processName} || true`, { encoding: "utf8", timeout: 3000 });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  getDiskUsage(path: string = "/"): { totalGb: number; freeGb: number; usedPercent: number } {
    const now = Date.now();
    // Cache disk usage for 5 minutes
    if (this.lastDiskUsage && (now - this.lastDiskCheck < 300_000)) {
      return this.lastDiskUsage;
    }
    try {
      if (os.platform() === "linux") {
        const result = cp.execSync(`df -BG ${path} | tail -1`, { encoding: "utf8", timeout: 3000 });
        const parts = result.trim().split(/\s+/);
        const total = parseInt(parts[1]?.replace("G", "") || "0");
        const used = parseInt(parts[2]?.replace("G", "") || "0");
        const free = parseInt(parts[3]?.replace("G", "") || "0");
        this.lastDiskUsage = { totalGb: total, freeGb: free, usedPercent: total > 0 ? Math.round((used / total) * 100) : 0 };
        this.lastDiskCheck = now;
        return this.lastDiskUsage;
      }
    } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
    return this.lastDiskUsage || { totalGb: 0, freeGb: 0, usedPercent: 0 };
  }

  detectEnvironmentChanges(): Partial<EnvironmentState> {
    const previous = this.environmentState;
    const current = this.captureEnvironment();
    const changes: Partial<EnvironmentState> = {};

    if (previous) {
      if (current.cpuUsage !== previous.cpuUsage) changes.cpuUsage = current.cpuUsage;
      if (current.memoryUsagePercent !== previous.memoryUsagePercent) changes.memoryUsagePercent = current.memoryUsagePercent;
      if (current.diskUsagePercent !== previous.diskUsagePercent) changes.diskUsagePercent = current.diskUsagePercent;
    }

    if (Object.keys(changes).length > 0) {
      bus.emit(Topics.ENVIRONMENT_CHANGE, changes, { source: "environment-sensor" });
    }

    this.environmentState = current;
    return changes;
  }

  private hasCommand(cmd: string, args: string[] = ["--version"]): boolean {
    try {
      const res = cp.spawnSync(cmd, args, { stdio: "ignore", timeout: 2000 });
      return res.status === 0;
    } catch {
      return false;
    }
  }

  private captureEnvironment(): EnvironmentState {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const loadAvg = os.loadavg();

    let cpuUsage = 0;
    if (cpus.length > 0) {
      const cpu = cpus[0];
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      cpuUsage = total > 0 ? Math.round((1 - idle / total) * 100) : 0;
    }

    // Lazy load and cache static environment info
    if (!this.staticInfo) {
      const hasDocker = this.hasCommand("docker");
      const hasGit = this.hasCommand("git");
      const hasNpm = this.hasCommand("npm");
      const disk = this.getDiskUsage();

      this.staticInfo = {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        cpuModel: cpus[0]?.model || "unknown",
        cpuCores: cpus.length,
        memoryTotalGb: +(totalMem / (1024 ** 3)).toFixed(1),
        networkInterfaces: Object.keys(os.networkInterfaces()).filter(k => k !== "lo"),
        isLinux: os.platform() === "linux",
        isWSL: os.platform() === "linux" && os.release().toLowerCase().includes("microsoft"),
        hasDocker,
        hasGit,
        hasNpm,
        homeDir: os.homedir(),
        tempDir: os.tmpdir(),
        shell: process.env.SHELL || os.userInfo().shell || "/bin/bash",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
      };
    }

    const disk = this.getDiskUsage();

    // Fast process count on Linux by reading /proc directly, bypassing execSync
    const processCount = (() => {
      try {
        if (os.platform() === "linux") {
          const files = fs.readdirSync("/proc");
          let count = 0;
          for (let i = 0; i < files.length; i++) {
            const name = files[i];
            if (name[0] >= "0" && name[0] <= "9") {
              count++;
            }
          }
          return count;
        }
      } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
      try {
        return parseInt(cp.execSync("ps aux --no-headers | wc -l", { encoding: "utf8", timeout: 3000 }).trim());
      } catch {
        return 0;
      }
    })();

    this.environmentState = {
      ...this.staticInfo,
      cpuUsage,
      memoryFreeGb: +(freeMem / (1024 ** 3)).toFixed(1),
      memoryUsagePercent: totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0,
      diskTotalGb: disk.totalGb,
      diskFreeGb: disk.freeGb,
      diskUsagePercent: disk.usedPercent,
      uptime: os.uptime(),
      loadAvg,
      processes: processCount,
      hasNode: true,
    };

    return this.environmentState;
  }

  checkSubProcessHealth(): SubProcessHealth {
    const subAgentNames = ["node", "tsx", "ts-node"];
    const runningNames = subAgentNames.filter(n => this.isProcessRunning(n));

    const mcpChecks = ["mcp-server", "mcp-proxy", "mcp-gateway"];
    const mcpServers = mcpChecks.map(name => {
      const pids = this.findPids(name);
      return { name, alive: pids.length > 0, pid: pids[0] };
    });

    const bridges = {
      email: this.isProcessRunning("email-bridge") || this.findPids("email").length > 0,
      social: this.isProcessRunning("social-bridge") || this.findPids("social").length > 0,
    };

    const allUp = runningNames.length === subAgentNames.length && mcpServers.every(m => m.alive) && bridges.email && bridges.social;
    const anyUp = runningNames.length > 0 || mcpServers.some(m => m.alive) || bridges.email || bridges.social;

    return {
      subAgents: { running: runningNames.length, total: subAgentNames.length, names: runningNames },
      mcpServers,
      bridges,
      status: allUp ? "healthy" : anyUp ? "degraded" : "unhealthy",
    };
  }

  getResourcePressure(): string {
    const env = this.getEnvironment();
    const max = Math.max(env.cpuUsage, env.memoryUsagePercent, env.diskUsagePercent);
    if (max >= 90) return "critical";
    if (max >= 75) return "high";
    if (max >= 60) return "moderate";
    return "low";
  }

  async checkNetworkAvailability(): Promise<NetworkAvailability> {
    const apiEndpoints: Record<string, boolean> = {};
    const configured = process.env.API_ENDPOINTS || process.env.OPENAI_BASE_URL || "";

    if (configured) {
      const urls = configured.split(",").map(u => u.trim()).filter(Boolean);
      for (const url of urls) {
        apiEndpoints[url] = await this.pingEndpoint(url);
      }
    }

    const [lmStudio, ollama] = await Promise.all([
      this.pingEndpoint("http://localhost:1234"),
      this.pingEndpoint("http://localhost:11434"),
    ]);

    return { lmStudio, ollama, apiEndpoints };
  }

  detectIDE(): IDEDetection {
    const vscode = this.hasCommand("code");
    const neovim = this.hasCommand("nvim") || this.hasCommand("vim");
    let activeFiles: string[] | undefined;

    try {
      if (os.platform() === "linux") {
        const procDirs = fs.readdirSync("/proc").filter(d => /^\d+$/.test(d));
        const files = new Set<string>();
        for (const dir of procDirs) {
          try {
            const cmdline = fs.readFileSync(`/proc/${dir}/cmdline`, "utf8");
            const parts = cmdline.split("\0");
            const exe = parts[0]?.toLowerCase() || "";
            if (exe.includes("code") || exe.includes("nvim") || exe.includes("vim")) {
              for (const part of parts.slice(1)) {
                if (/\.(ts|js|tsx|jsx|json|md|yaml|yml|py|rs|go|c|cpp|h)$/.test(part)) {
                  files.add(part);
                }
              }
            }
          } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
        }
        if (files.size > 0) activeFiles = Array.from(files);
      }
    } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }

    return { vscode, neovim, activeFiles };
  }

  private findPids(pattern: string): number[] {
    try {
      const result = cp.execSync(`pgrep -f ${pattern} || true`, { encoding: "utf8", timeout: 3000 });
      return result.trim().split("\n").filter(Boolean).map(Number);
    } catch {
      return [];
    }
  }

  private async pingEndpoint(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url, { signal: controller.signal, method: "HEAD" });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  destroy(): void {
    for (const w of this.watchers) {
      try { w.close(); } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
    }
    this.watchers = [];
    this.watchPaths = [];
  }
}

export const environmentSensor = new EnvironmentSensor();
