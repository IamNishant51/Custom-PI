import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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
}

export class InitiativeEngine {
  private opportunities: Opportunity[] = [];
  private lastCheck: Record<string, number> = {};
  private userReceptivity = 0.5;
  private _initialized = false;
  private _listenerIds: string[] = [];

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
    this._initialized = false;
  }

  /** Persist state to disk so it survives restarts */
  private persistState(): void {
    try {
      const data = {
        opportunities: this.opportunities,
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

  /** Load state from disk */
  private loadState(): void {
    try {
      if (fs.existsSync(INITIATIVE_STATE_FILE)) {
        const raw = fs.readFileSync(INITIATIVE_STATE_FILE, "utf8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.opportunities)) this.opportunities = data.opportunities;
        if (typeof data.userReceptivity === "number") this.userReceptivity = data.userReceptivity;
        if (data.lastCheck && typeof data.lastCheck === "object") this.lastCheck = data.lastCheck;
      }
    } catch (err) {
      logger.error("[InitiativeEngine] Failed to load state", { error: String(err) });
    }
  }

  constructor() {
    // No side effects — call init() explicitly
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
  }

  private registerBackgroundTasks(): void {
    const daemon = getDaemon();
    daemon.registerTask(Daemon.createIntervalTask(
      "initiative-engine:scan",
      async () => await this.scanForOpportunities(),
      120_000
    ));
  }

  private async scanForOpportunities(): Promise<void> {
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
    const goalCount = graph.countNodes("goal");
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
  }

  evaluate(category: Opportunity["category"], description: string, impact = 0.3, urgency = 0.3): Opportunity | null {
    const score = impact * 0.4 + urgency * 0.3 + this.userReceptivity * 0.3;
    if (score < 0.3) return null;

    const existing = this.opportunities.find(o =>
      o.description === description && !o.dismissed
    );
    if (existing) return existing;

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
    };

    this.opportunities.push(opportunity);
    if (this.opportunities.length > 100) {
      this.opportunities.splice(0, this.opportunities.length - 100);
    }
    this.persistState();

    bus.emit(Topics.PROACTIVE_ACTION, {
      type: "opportunity",
      category,
      title: opportunity.title,
      confidence: score,
    }, { source: "initiative-engine" });

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
