import { logger } from "../logger";
import { bus, Topics } from "../event-bus/event-bus";
import { getGraph } from "../state-graph/property-graph";

interface Milestone {
  id: string;
  name: string;
  description: string;
  targetDate: number;
  status: "planned" | "in_progress" | "completed" | "delayed" | "cancelled";
  dependencies: string[];
  deliverables: string[];
  risk: "low" | "medium" | "high";
  completedAt?: number;
  progress: number;
}

interface LongTermGoal {
  id: string;
  title: string;
  description: string;
  horizon: "quarter" | "half-year" | "year" | "multi-year";
  milestones: Milestone[];
  status: "active" | "paused" | "completed" | "abandoned";
  createdAt: number;
  updatedAt: number;
  priority: number;
  tags: string[];
}

interface RiskForecast {
  milestoneId: string;
  risk: string;
  probability: number;
  impact: number;
  mitigation: string;
  warningDate: number;
}

export class LongTermPlanner {
  private goals: Map<string, LongTermGoal> = new Map();
  private forecasts: RiskForecast[] = [];

  createGoal(title: string, description: string, horizon: LongTermGoal["horizon"], priority = 5): LongTermGoal {
    const id = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const goal: LongTermGoal = {
      id, title, description, horizon, milestones: [],
      status: "active", createdAt: Date.now(), updatedAt: Date.now(),
      priority, tags: [],
    };
    this.goals.set(id, goal);

    const horizonMs = this.getHorizonMs(horizon);
    const milestoneCount = horizon === "quarter" ? 3 : horizon === "half-year" ? 6 : 12;
    for (let i = 0; i < milestoneCount; i++) {
      const intervalMs = horizonMs / milestoneCount;
      goal.milestones.push({
        id: `ms_${id}_${i}`,
        name: `Milestone ${i + 1}: ${title} Phase ${i + 1}`,
        description: `Phase ${i + 1} of ${milestoneCount}`,
        targetDate: Date.now() + intervalMs * (i + 1),
        status: "planned",
        dependencies: i > 0 ? [`ms_${id}_${i - 1}`] : [],
        deliverables: [],
        risk: "medium",
        progress: 0,
      });
    }

    this.persistGoal(goal);

    bus.emit(Topics.PLAN_CREATED, {
      goalId: id,
      title,
      horizon,
      milestoneCount,
      priority,
    }, { source: "long-term-planner" });

    return goal;
  }

  getGoal(id: string): LongTermGoal | undefined {
    return this.goals.get(id);
  }

  getAllGoals(status?: LongTermGoal["status"]): LongTermGoal[] {
    const all = Array.from(this.goals.values());
    if (status) return all.filter(g => g.status === status);
    return all.sort((a, b) => b.priority - a.priority);
  }

  updateMilestone(goalId: string, milestoneId: string, updates: Partial<Milestone>): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;
    const ms = goal.milestones.find(m => m.id === milestoneId);
    if (!ms) return;
    Object.assign(ms, updates);
    goal.updatedAt = Date.now();
    this.persistGoal(goal);
    bus.emit(Topics.PLAN_UPDATED, { goalId, milestoneId, status: ms.status, progress: ms.progress }, { source: "long-term-planner" });
  }

  forecastRisks(goalId: string): RiskForecast[] {
    const goal = this.goals.get(goalId);
    if (!goal) return [];
    this.forecasts = [];

    for (const ms of goal.milestones) {
      if (ms.status === "completed") continue;
      const timeRemaining = ms.targetDate - Date.now();
      if (timeRemaining < 0) {
        this.forecasts.push({
          milestoneId: ms.id,
          risk: `Milestone "${ms.name}" is past its target date`,
          probability: 0.9,
          impact: 0.7,
          mitigation: "Reassess scope, adjust timeline, or add resources",
          warningDate: Date.now(),
        });
      } else if (timeRemaining < 7 * 86400000 && ms.progress < 0.5) {
        this.forecasts.push({
          milestoneId: ms.id,
          risk: `Milestone "${ms.name}" has < 1 week left but only ${Math.round(ms.progress * 100)}% complete`,
          probability: 0.7,
          impact: 0.6,
          mitigation: "Focus on critical path items, consider reducing scope",
          warningDate: Date.now(),
        });
      }

      for (const depId of ms.dependencies) {
        const dep = goal.milestones.find(m => m.id === depId);
        if (dep && dep.status !== "completed" && ms.status === "planned") {
          this.forecasts.push({
            milestoneId: ms.id,
            risk: `Depends on incomplete milestone "${dep.name}"`,
            probability: 0.5,
            impact: 0.5,
            mitigation: `Complete "${dep.name}" first or parallelize work`,
            warningDate: Date.now(),
          });
        }
      }
    }

    return this.forecasts;
  }

  getRoadmap(goalId: string): string {
    const goal = this.goals.get(goalId);
    if (!goal) return "Goal not found";

    const now = Date.now();
    const lines: string[] = [
      `# ${goal.title}`,
      `**Horizon:** ${goal.horizon} | **Priority:** ${goal.priority} | **Status:** ${goal.status}`,
      `**Created:** ${new Date(goal.createdAt).toLocaleDateString()}`,
      ``,
      `## Milestones`,
    ];

    for (const ms of goal.milestones.sort((a, b) => a.targetDate - b.targetDate)) {
      const statusIcon = ms.status === "completed" ? "[x]" : ms.status === "in_progress" ? "[~]" : "[ ]";
      const timeLeft = ms.targetDate - now;
      const timeStr = timeLeft > 0
        ? `${Math.round(timeLeft / 86400000)} days left`
        : `${Math.round(-timeLeft / 86400000)} days overdue`;
      const progressBar = this.renderProgressBar(ms.progress);
      lines.push(`- ${statusIcon} **${ms.name}** (${timeStr})`);
      lines.push(`  ${progressBar} ${Math.round(ms.progress * 100)}%`);
      if (ms.deliverables.length > 0) lines.push(`  Deliverables: ${ms.deliverables.join(", ")}`);
    }

    return lines.join("\n");
  }

  getStrategicAdvice(): string[] {
    const advice: string[] = [];
    const activeGoals = this.getAllGoals("active");

    for (const goal of activeGoals) {
      const risks = this.forecastRisks(goal.id);
      const highRisks = risks.filter(r => r.probability * r.impact > 0.3);
      if (highRisks.length >= 2) {
        advice.push(`Goal "${goal.title}" has ${highRisks.length} significant risks requiring attention`);
      }
      const overdue = goal.milestones.filter(m => m.targetDate < Date.now() && m.status !== "completed");
      if (overdue.length > 0) {
        advice.push(`Goal "${goal.title}" has ${overdue.length} overdue milestones`);
      }
    }

    const completedGoals = this.getAllGoals("completed").length;
    if (completedGoals > 0) {
      advice.push(`You've completed ${completedGoals} long-term goals. Review what worked.`);
    }

    return advice;
  }

  private getHorizonMs(horizon: LongTermGoal["horizon"]): number {
    switch (horizon) {
      case "quarter": return 90 * 86400000;
      case "half-year": return 180 * 86400000;
      case "year": return 365 * 86400000;
      case "multi-year": return 730 * 86400000;
    }
  }

  private renderProgressBar(progress: number, width = 10): string {
    const filled = Math.round(progress * width);
    const empty = width - filled;
    return "█".repeat(filled) + "░".repeat(empty);
  }

  private persistGoal(goal: LongTermGoal): void {
    try {
      const graph = getGraph();
      const nodeId = graph.addNode("goal", goal.title, {
        goalId: goal.id,
        horizon: goal.horizon,
        status: goal.status,
        priority: goal.priority,
        milestones: goal.milestones.length,
        completed: goal.milestones.filter(m => m.status === "completed").length,
      });
      for (const ms of goal.milestones) {
        graph.addNode("task", ms.name, {
          milestoneId: ms.id,
          status: ms.status,
          targetDate: ms.targetDate,
          progress: ms.progress,
        });
        graph.addEdge(nodeId, ms.id, "contains");
      }
    } catch { logger.warn("empty catch block") }
  }
}

export const longTermPlanner = new LongTermPlanner();
