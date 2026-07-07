import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { bus, Topics } from "../event-bus/event-bus";
import { getDaemon, Daemon } from "../daemon/daemon";
import { writeAtomic } from "../storage-driver";
import { logger } from "../logger";

import { PATHS } from "../config";

const SECURITY_STATE_FILE = PATHS.SECURITY_STATE;

interface SecurityFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  type: "secret_leak" | "dependency_vuln" | "unsafe_code" | "misconfiguration" | "permission_issue" | "outdated_dep";
  file?: string;
  line?: number;
  description: string;
  recommendation: string;
  createdAt: number;
  resolved: boolean;
  resolvedAt?: number;
}

interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: SecurityFinding["severity"];
}

export class SecurityAutopilot {
  private findings: SecurityFinding[] = [];
  private secretPatterns: SecretPattern[] = [];
  private scannedFiles = new Set<string>();
  private _initialized = false;
  private _listenerIds: string[] = [];

  init(): void {
    if (this._initialized) return;
    this._initialized = true;
    this.initializePatterns();
    this.loadState();
    this.setupListeners();
    this.registerBackgroundTask();
  }

  destroy(): void {
    this.persistState();
    for (const id of this._listenerIds) {
      bus.unsubscribe(id);
    }
    this._listenerIds = [];
    this.findings = [];
    this.scannedFiles.clear();
    this._initialized = false;
  }

  constructor() {
    // No side effects — call init() explicitly
  }

  private persistState(): void {
    try {
      const data = {
        findings: this.findings.map(f => ({ ...f })),
        scannedFiles: Array.from(this.scannedFiles),
      };
      const dir = path.dirname(SECURITY_STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      writeAtomic(SECURITY_STATE_FILE, JSON.stringify(data));
    } catch (err) {
      logger.error("[SecurityAutopilot] Failed to persist state", { error: String(err) });
    }
  }

  private loadState(): void {
    try {
      if (fs.existsSync(SECURITY_STATE_FILE)) {
        const raw = fs.readFileSync(SECURITY_STATE_FILE, "utf8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.findings)) this.findings = data.findings;
        if (Array.isArray(data.scannedFiles)) this.scannedFiles = new Set(data.scannedFiles);
      }
    } catch (err) {
      logger.error("[SecurityAutopilot] Failed to load state", { error: String(err) });
    }
  }

  private initializePatterns(): void {
    this.secretPatterns = [
      { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/, severity: "critical" },
      { name: "AWS Secret Key", pattern: /aws(.{0,20})?(?<![A-Za-z0-9+\/=])[A-Za-z0-9\/+=]{40}(?![A-Za-z0-9+\/=])/i, severity: "critical" },
      { name: "GitHub Token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/, severity: "critical" },
      { name: "GitHub Fine-Grained", pattern: /github_pat_[A-Za-z0-9_]{82,}/, severity: "critical" },
      { name: "NPM Token", pattern: /npm_[A-Za-z0-9]{36,}/, severity: "high" },
      { name: "Discord Bot Token", pattern: /[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27}/, severity: "critical" },
      { name: "Slack Token", pattern: /xox[baprs]-[A-Za-z0-9]{10,}/, severity: "high" },
      { name: "Private Key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, severity: "critical" },
      { name: "JWT Token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, severity: "high" },
      { name: "Generic API Key", pattern: /(api[_-]?key|apikey|secret|token|password).{0,10}['\"]?[A-Za-z0-9_\-]{16,}['\"]?/i, severity: "high" },
      { name: "Connection String", pattern: /(mongodb|postgresql|mysql|redis):\/\/[^\s]+/, severity: "critical" },
      { name: "Heroku API Key", pattern: /[hH][eE][rR][oO][kK][uU].{0,30}[A-Za-z0-9\-]{20,}/, severity: "high" },
    ];
  }

  private setupListeners(): void {
    const id = bus.on(Topics.FILE_CHANGED, (event) => {
      const change = event.data;
      if (change.type === "created" || change.type === "modified") {
        if (this.shouldScan(change.path)) {
          this.scanFile(change.path);
        }
      }
    });
    this._listenerIds.push(id);
  }

  private registerBackgroundTask(): void {
    const daemon = getDaemon();
    daemon.registerTask(Daemon.createIntervalTask(
      "security-autopilot:scan",
      async () => await this.scheduledScan(),
      3600000
    ));
  }

  private shouldScan(filePath: string): boolean {
    const resolvedPath = path.resolve(filePath);
    const homePi = path.resolve(os.homedir(), ".pi");
    if (resolvedPath.startsWith(homePi)) return false;

    const skipDirs = ["node_modules", ".git", "dist", "build", ".next", "coverage", ".vault", "venv", "__pycache__"];
    const skipExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".pdf", ".mp4", ".mp3"];
    const skipFiles = [".env.example", "package-lock.json", "yarn.lock"];

    const base = path.basename(filePath);
    const ext = path.extname(filePath);

    if (skipFiles.includes(base)) return false;
    if (skipExts.includes(ext)) return false;
    if (skipDirs.some(d => filePath.includes(`/${d}/`) || filePath.includes(`\\${d}\\`))) return false;
    if (/\.tmp(\.\d+)?$/.test(base) || /\.bak(\.\d+)?$/.test(base) || base.includes(".tmp.") || base.includes(".bak.")) return false;
    try {
      if (fs.statSync(filePath).size > 1 * 1024 * 1024) return false;
    } catch { return false; }

    return true;
  }

  scanFile(filePath: string): SecurityFinding[] {
    const fileFindings: SecurityFinding[] = [];
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");

      for (const pattern of this.secretPatterns) {
        for (let i = 0; i < lines.length; i++) {
          if (pattern.pattern.test(lines[i])) {
            const finding: SecurityFinding = {
              id: `sec_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
              severity: pattern.severity,
              type: "secret_leak",
              file: filePath,
              line: i + 1,
              description: `Potential ${pattern.name} found`,
              recommendation: `Remove this secret from the codebase. Store it in the encrypted vault instead. Consider rotating the key if it was previously exposed.`,
              createdAt: Date.now(),
              resolved: false,
            };
            fileFindings.push(finding);
            break;
          }
        }
      }
    } catch (err) {
      logger.error(`Security scan failed for ${filePath}`, { error: String(err) });
    }

    for (const finding of fileFindings) {
      const existing = this.findings.find(f => f.file === finding.file && f.line === finding.line && f.type === finding.type);
      if (!existing) {
        this.findings.push(finding);
      }
    }

    this.persistState();

    return fileFindings;
  }

  getFindings(options?: { severity?: SecurityFinding["severity"][]; type?: SecurityFinding["type"]; unresolved?: boolean; limit?: number }): SecurityFinding[] {
    let results = this.findings;

    if (options?.severity?.length) results = results.filter(f => options.severity!.includes(f.severity));
    if (options?.type) results = results.filter(f => f.type === options.type);
    if (options?.unresolved) results = results.filter(f => !f.resolved);

    return results.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
      return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
    }).slice(0, options?.limit || 50);
  }

  getUnresolvedFindings(): SecurityFinding[] {
    return this.getFindings({ unresolved: true });
  }

  getCriticalFindings(): SecurityFinding[] {
    return this.getFindings({ severity: ["critical", "high"], unresolved: true });
  }

  resolveFinding(id: string): void {
    const finding = this.findings.find(f => f.id === id);
    if (finding) {
      finding.resolved = true;
      finding.resolvedAt = Date.now();
      this.persistState();
    }
  }

  async scanVaultForKeyExposure(): Promise<SecurityFinding[]> {
    const vaultDir = path.join(os.homedir(), ".pi", "agent", ".vault");
    const vaultFindings: SecurityFinding[] = [];

    try {
      if (fs.existsSync(vaultDir)) {
        const files = fs.readdirSync(vaultDir);
        for (const file of files) {
          if (file.startsWith("master.")) {
            vaultFindings.push({
              id: `sec_${Date.now()}_vault`,
              severity: "medium",
              type: "misconfiguration",
              file: path.join(vaultDir, file),
              description: "Vault key file detected - ensure .vault is in .gitignore",
              recommendation: "Verify .gitignore includes .vault/ and the vault directory is not in version control.",
              createdAt: Date.now(),
              resolved: false,
            });
          }
        }
      }
    } catch (err) {
      logger.error("Vault exposure scan failed", { error: String(err) });
    }

    return vaultFindings;
  }

  getSecurityScore(): { score: number; total: number; critical: number; high: number; medium: number; low: number; resolved: number } {
    const total = this.findings.length;
    const unresolved = this.findings.filter(f => !f.resolved);
    const critical = unresolved.filter(f => f.severity === "critical").length;
    const high = unresolved.filter(f => f.severity === "high").length;
    const medium = unresolved.filter(f => f.severity === "medium").length;
    const low = unresolved.filter(f => f.severity === "low").length;
    const resolved = this.findings.filter(f => f.resolved).length;

    const severityWeights = { critical: 40, high: 10, medium: 3, low: 1 };
    const penalty = critical * severityWeights.critical + high * severityWeights.high + medium * severityWeights.medium + low * severityWeights.low;
    const score = Math.max(0, Math.min(100, 100 - penalty));

    return { score, total, critical, high, medium, low, resolved };
  }

  private async scheduledScan(): Promise<void> {
    try {
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, ".pi", "agent");
      if (fs.existsSync(configDir)) {
        this.scanDirectory(configDir);
      }
      this.scanVaultForKeyExposure();
      bus.emit(Topics.SELF_AUDIT, {
        type: "security_scan",
        findings: this.getUnresolvedFindings().length,
        score: this.getSecurityScore().score,
      }, { source: "security-autopilot" });
    } catch (err) {
      logger.error("Scheduled security scan failed", { error: String(err) });
    }
  }

  private scanDirectory(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!["node_modules", ".git"].includes(entry.name)) {
            this.scanDirectory(fullPath);
          }
        } else if (entry.isFile() && this.shouldScan(fullPath)) {
          if (!this.scannedFiles.has(fullPath)) {
            this.scannedFiles.add(fullPath);
            this.scanFile(fullPath);
          }
        }
      }
    } catch (err) {
      logger.error(`Directory scan failed for ${dir}`, { error: String(err) });
    }
  }
}

export const securityAutopilot = new SecurityAutopilot();
