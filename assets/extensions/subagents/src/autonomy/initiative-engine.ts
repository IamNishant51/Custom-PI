import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { bus, Topics } from "../event-bus/event-bus";
import { getDaemon, Daemon } from "../daemon/daemon";
import { environmentSensor } from "../perception/environment-sensor";
import { getGraph } from "../state-graph/property-graph";
import { writeAtomic } from "../storage-driver";
import { logger } from "../logger";

const INITIATIVE_STATE_FILE = path.join(os.homedir(), ".pi", "agent", "initiative-state.json");

interface Opportunity {
  id: string;
  title: string;
  description: string;
  impact: number;
  urgency: number;
  confidence: number;
  category: "maintenance" | "optimization" | "security" | "learning" | "proactive";
  suggestedAction: string;
  source: string;
  createdAt: number;
  dismissed: boolean;
  relatedFiles?: string[];
  estimatedEffort?: string;
}

interface ImpactRecord {
  id: string;
  opportunityId: string;
  action: string;
  initiatedAt: number;
  completedAt?: number;
  success: boolean | null;
  compilationPassed?: boolean;
  testsPassed?: boolean;
  errorMessage?: string;
  durationMs?: number;
}

interface ScannedPullRequest {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  url: string;
}

interface ScannedBranch {
  name: string;
  lastCommitDate: string;
  ahead: number;
  behind: number;
  isStale: boolean;
}

export class InitiativeEngine {
  private opportunities: Opportunity[] = [];
  private impactRecords: ImpactRecord[] = [];
  private lastCheck: Record<string, number> = {};
  private userReceptivity = 0.5;
  private _initialized = false;
  private _listenerIds: string[] = [];
  private scanLock = false;

  init(): void {
    if (this._initialized) return;
    this._initialized = true;
    this.loadState();
    this.setupListeners();
    this.registerBackgroundTasks();
  }

  destroy(): void {
    this.persistState();
    for (const id of this._listenerIds) {
      bus.unsubscribe(id);
    }
    this._listenerIds = [];
    this.opportunities = [];
    this.impactRecords = [];
    this._initialized = false;
  }

  private persistState(): void {
    try {
      const data = {
        opportunities: this.opportunities,
        impactRecords: this.impactRecords,
        userReceptivity: this.userReceptivity,
        lastCheck: this.lastCheck,
      };
      const dir = path.dirname(INITIATIVE_STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      writeAtomic(INITIATIVE_STATE_FILE, JSON.stringify(data));
    } catch (err) {
      logger.error("[InitiativeEngine] Failed to persist state", { error: String(err) });
    }
  }

  private loadState(): void {
    try {
      if (fs.existsSync(INITIATIVE_STATE_FILE)) {
        const raw = fs.readFileSync(INITIATIVE_STATE_FILE, "utf8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.opportunities)) this.opportunities = data.opportunities;
        if (Array.isArray(data.impactRecords)) this.impactRecords = data.impactRecords;
        if (typeof data.userReceptivity === "number") this.userReceptivity = data.userReceptivity;
        if (data.lastCheck && typeof data.lastCheck === "object") this.lastCheck = data.lastCheck;
      }
    } catch (err) {
      logger.error("[InitiativeEngine] Failed to load state", { error: String(err) });
    }
  }

  constructor() {
  }

  private setupListeners(): void {
    const id1 = bus.on(Topics.USER_FEEDBACK, (event) => {
      if (event.data.positive) this.userReceptivity = Math.min(1, this.userReceptivity + 0.05);
      if (event.data.negative) this.userReceptivity = Math.max(0, this.userReceptivity - 0.05);
    });
    this._listenerIds.push(id1);

    const id2 = bus.on(Topics.MEMORY_CONSOLIDATED, () => {
      this.evaluate("maintenance", "Memory consolidation completed. Check if pruning thresholds need adjustment.");
    });
    this._listenerIds.push(id2);

    const id3 = bus.on(Topics.TOOL_ERROR, (event) => {
      if (this.isAutonomousEnabled()) {
        const tool = event.data.toolName || "unknown";
        this.evaluate("optimization", `Tool "${tool}" failed. Consider checking its configuration or dependencies.`, 0.5, 0.6);
        this.recordImpact("auto_heal_" + tool, `Auto-review triggered after ${tool} failure`, false);
      }
    });
    this._listenerIds.push(id3);
  }

  private registerBackgroundTasks(): void {
    const daemon = getDaemon();
    daemon.registerTask(Daemon.createIntervalTask(
      "initiative-engine:scan",
      async () => await this.scanForOpportunities(),
      120_000,
    ));
    daemon.registerTask(Daemon.createIntervalTask(
      "initiative-engine:pr-scan",
      async () => await this.scanOpenPRs(),
      300_000,
    ));
    daemon.registerTask(Daemon.createIntervalTask(
      "initiative-engine:todo-scan",
      async () => await this.scanTodos(),
      600_000,
    ));
    daemon.registerTask(Daemon.createIdleTask(
      "initiative-engine:proactive-suggest",
      async () => await this.suggestProactive(),
    ));
  }

  private async scanForOpportunities(): Promise<void> {
    if (this.scanLock) return;
    this.scanLock = true;
    try {
      const env = environmentSensor.getEnvironment();

      if (env.diskUsagePercent > 85) {
        this.evaluate("maintenance",
          `Disk usage is at ${env.diskUsagePercent}%. Consider archiving old sessions and logs.`,
          env.diskUsagePercent / 100, 0.7);
      }

      if (env.memoryUsagePercent > 90) {
        this.evaluate("maintenance",
          `Memory usage is at ${env.memoryUsagePercent}%. Consider closing unused processes.`,
          env.memoryUsagePercent / 100, 0.6);
      }

      const graph = getGraph();
      const incompleteGoals = graph.queryNodes({ nodeType: "goal" })
        .filter(n => n.properties.status === "planning" || n.properties.status === "executing");
      if (incompleteGoals.length > 2) {
        this.evaluate("optimization",
          `You have ${incompleteGoals.length} active goals. Would you like to review and prioritize them?`,
          0.6, 0.8);
      }

      const fileChanges = environmentSensor.getRecentChanges(Date.now() - 300_000);
      if (fileChanges.length > 10) {
        this.evaluate("proactive",
          `Noticed ${fileChanges.length} recent file changes. Would you like me to review what changed?`,
          0.5, 0.7);
      }

      const episodeCount = graph.countNodes("episode");
      if (episodeCount > 1000) {
        this.evaluate("maintenance",
          `${episodeCount} episode memories accumulated. Consider running dream consolidation.`,
          0.4, 0.6);
      }

      await this.scanStaleBranches();
      await this.scanFailingTests();
    } finally {
      this.scanLock = false;
    }
  }

  private async scanOpenPRs(): Promise<void> {
    try {
      const result = execSync("gh pr list --state open --json number,title,state,createdAt,url --limit 10 2>/dev/null || true", {
        encoding: "utf8", timeout: 10000,
      });
      if (!result.trim()) return;
      const prs: ScannedPullRequest[] = JSON.parse(result);
      const now = Date.now();
      for (const pr of prs) {
        const ageDays = (now - new Date(pr.createdAt).getTime()) / 86400000;
        if (ageDays > 7) {
          const impact = Math.min(1, ageDays / 30);
          this.evaluate("proactive",
            `PR #${pr.number} "${pr.title}" has been open for ${Math.round(ageDays)} days. Consider reviewing.`,
            impact, impact * 0.8, undefined, undefined, [`PR #${pr.number}`]);
        }
      }
    } catch {
    }
  }

  private async scanStaleBranches(): Promise<void> {
    try {
      const result = execSync("git branch -r --merged HEAD 2>/dev/null | head -20 || true", {
        encoding: "utf8", timeout: 10000,
      });
      if (!result.trim()) return;
      const branches = result.split("\n").map(b => b.trim()).filter(b => b && !b.includes("origin/HEAD") && !b.includes("origin/main") && !b.includes("origin/master"));
      if (branches.length > 5) {
        this.evaluate("maintenance",
          `Found ${branches.length} merged remote branches that can be cleaned up.`,
          0.4, 0.3, undefined, undefined, branches.slice(0, 5));
      }
    } catch {
    }
  }

  private async scanTodos(): Promise<void> {
    try {
      const result = execSync("rg -l 'TODO|FIXME|HACK|XXX|todo|fixme' --type-add 'code:*.{ts,js,tsx,jsx,mjs,mts}' -t code -g '!node_modules' -g '!dist' 2>/dev/null | head -20 || true", {
        encoding: "utf8", timeout: 15000,
      });
      if (!result.trim()) return;
      const files = result.trim().split("\n").filter(Boolean);
      if (files.length > 0) {
        this.evaluate("optimization",
          `Found ${files.length} files with TODO/FIXME comments. Top files: ${files.slice(0, 3).join(", ")}`,
          0.5, 0.4, undefined, undefined, files);
      }
    } catch {
    }
  }

  private async scanFailingTests(): Promise<void> {
    try {
      const result = execSync("npx vitest run --reporter=json 2>/dev/null || true", {
        encoding: "utf8", timeout: 60000,
      });
      if (!result.trim()) return;
      const report = JSON.parse(result);
      if (report.numFailedTests > 0) {
        this.evaluate("optimization",
          `${report.numFailedTests} test(s) failing across ${report.numFailedTestSuites} suite(s). Consider reviewing.`,
          0.7, 0.8);
      }
    } catch {
    }
  }

  async suggestProactive(): Promise<void> {
    if (!this.isAutonomousEnabled()) return;
    const pending = this.getPendingOpportunities(0.6);
    if (pending.length === 0) return;

    const top3 = pending.slice(0, 3);
    bus.emit(Topics.PROACTIVE_ACTION, {
      type: "proactive_suggestion",
      suggestions: top3.map(o => ({
        id: o.id,
        title: o.title,
        category: o.category,
        confidence: o.confidence,
        impact: o.impact,
      })),
      count: top3.length,
      source: "initiative-engine",
    }, { source: "initiative-engine" });

    if (this.isAutonomousEnabled()) {
      const top = top3[0];
      if (top && top.confidence > 0.8) {
        this.recordImpact(top.id, `Autonomously executing: ${top.title}`, true);
        top.dismissed = true;
      }
    }
  }

  evaluate(
    category: Opportunity["category"],
    description: string,
    impact = 0.3,
    urgency = 0.3,
    _relatedFiles?: string[],
    _estimatedEffort?: string,
    relatedFiles?: string[],
  ): Opportunity | null {
    const score = impact * 0.4 + urgency * 0.3 + this.userReceptivity * 0.3;
    if (score < 0.3) return null;

    const existing = this.opportunities.find(o =>
      o.description === description && !o.dismissed
    );
    if (existing) {
      existing.confidence = Math.max(existing.confidence, score);
      return existing;
    }

    const id = `opp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const opportunity: Opportunity = {
      id,
      title: this.generateTitle(category, description),
      description,
      impact,
      urgency,
      confidence: score,
      category,
      suggestedAction: description,
      source: "initiative-engine",
      createdAt: Date.now(),
      dismissed: false,
      relatedFiles,
    };

    this.opportunities.push(opportunity);
    if (this.opportunities.length > 100) {
      this.opportunities.splice(0, this.opportunities.length - 100);
    }
    this.persistState();

    bus.emit(Topics.OPPORTUNITY_DETECTED, {
      id: opportunity.id,
      type: "opportunity",
      category,
      title: opportunity.title,
      confidence: score,
      impact,
      urgency,
    }, { source: "initiative-engine" });

    if (this.isAutonomousEnabled() && score > 0.75) {
      this.recordImpact(opportunity.id, `Autonomous action triggered: ${opportunity.title}`, true);
      opportunity.dismissed = true;
    }

    return opportunity;
  }

  getPendingOpportunities(minScore = 0.4): Opportunity[] {
    return this.opportunities
      .filter(o => !o.dismissed && o.confidence >= minScore)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
  }

  dismiss(id: string): void {
    const opp = this.opportunities.find(o => o.id === id);
    if (opp) { opp.dismissed = true; this.persistState(); }
  }

  getUserReceptivity(): number {
    return this.userReceptivity;
  }

  recordImpact(opportunityId: string, action: string, success: boolean): void {
    const record: ImpactRecord = {
      id: `impact_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      opportunityId,
      action,
      initiatedAt: Date.now(),
      completedAt: success ? Date.now() : undefined,
      success,
      durationMs: success ? 0 : undefined,
    };
    this.impactRecords.push(record);
    if (this.impactRecords.length > 1000) {
      this.impactRecords.splice(0, this.impactRecords.length - 1000);
    }

    bus.emit(Topics.AUTONOMOUS_ACTION_RESULT, {
      actionId: record.id,
      action,
      success,
      opportunityId,
    }, { source: "initiative-engine" });

    this.persistState();
  }

  completeImpactRecord(id: string, success: boolean, details?: { compilationPassed?: boolean; testsPassed?: boolean; errorMessage?: string }): void {
    const record = this.impactRecords.find(r => r.id === id);
    if (record) {
      record.completedAt = Date.now();
      record.success = success;
      record.durationMs = record.completedAt - record.initiatedAt;
      if (details) {
        record.compilationPassed = details.compilationPassed;
        record.testsPassed = details.testsPassed;
        record.errorMessage = details.errorMessage;
      }
      this.persistState();
    }
  }

  getImpactStats(): { total: number; succeeded: number; failed: number; pending: number; successRate: number } {
    const total = this.impactRecords.length;
    const succeeded = this.impactRecords.filter(r => r.success === true).length;
    const failed = this.impactRecords.filter(r => r.success === false).length;
    const pending = this.impactRecords.filter(r => r.success === null).length;
    return {
      total, succeeded, failed, pending,
      successRate: total > 0 ? succeeded / total : 0,
    };
  }

  getRecentImpactRecords(hours = 24): ImpactRecord[] {
    const cutoff = Date.now() - hours * 3600000;
    return this.impactRecords.filter(r => r.initiatedAt >= cutoff);
  }

  isAutonomousEnabled(): boolean {
    return process.env.AUTONOMOUS_ENABLED === "true";
  }

  private generateTitle(category: Opportunity["category"], description: string): string {
    const prefixes: Record<string, string[]> = {
      maintenance: ["System Notice:", "Heads up:", "Maintenance:"],
      optimization: ["Optimization:", "Improvement:", "Performance:"],
      security: ["Security:", "Safety Check:", "Vulnerability:"],
      learning: ["Learning:", "Insight:", "Discovery:"],
      proactive: ["Suggestion:", "I noticed", "Opportunity:"],
    };
    const prefix = prefixes[category]?.[Math.floor(Math.random() * prefixes[category].length)] || "Notice:";
    return `${prefix} ${description.slice(0, 80)}`;
  }
}

export const initiativeEngine = new InitiativeEngine();
