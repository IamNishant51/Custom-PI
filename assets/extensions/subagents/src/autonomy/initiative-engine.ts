import { bus, Topics } from "../event-bus/event-bus";
import { getDaemon, Daemon } from "../daemon/daemon";
import { environmentSensor } from "../perception/environment-sensor";
import { getGraph } from "../state-graph/property-graph";

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

  constructor() {
    this.setupListeners();
    this.registerBackgroundTasks();
  }

  private setupListeners(): void {
    bus.on(Topics.USER_FEEDBACK, (event) => {
      if (event.data.positive) this.userReceptivity = Math.min(1, this.userReceptivity + 0.05);
      if (event.data.negative) this.userReceptivity = Math.max(0, this.userReceptivity - 0.05);
    });

    bus.on(Topics.MEMORY_CONSOLIDATED, () => {
      this.evaluate("maintenance", "Memory consolidation completed. Check if pruning thresholds need adjustment.");
    });
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
    if (opp) opp.dismissed = true;
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
