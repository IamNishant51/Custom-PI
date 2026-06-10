import { bus, Topics } from "../event-bus/event-bus";

export type ThinkingStrategy = "cot" | "tot" | "react" | "reflexion" | "plan-execute" | "auto";
export type TaskCategory = "coding" | "research" | "debugging" | "planning" | "writing" | "analysis" | "deployment" | "configuration" | "unknown";

interface ThoughtRecord {
  id: string;
  timestamp: number;
  taskDescription: string;
  strategyUsed: ThinkingStrategy;
  alternatives: ThinkingStrategy[];
  confidence: number;
  uncertaintyRegions: string[];
  processingTimeMs: number;
  knowledgeGaps: string[];
  success: boolean;
  toolCalls: number;
  tokensUsed: number;
}

interface StrategyPerformance {
  strategy: ThinkingStrategy;
  taskCategory: TaskCategory;
  totalUses: number;
  successes: number;
  failures: number;
  averageConfidence: number;
  averageProcessingTime: number;
  averageToolCalls: number;
}

export class Metacognition {
  private thoughtHistory: ThoughtRecord[] = [];
  private strategyPerformance = new Map<string, StrategyPerformance>();
  private maxHistory = 10000;

  constructor() {
    this.setupListeners();
    this.initializeStrategyData();
  }

  private setupListeners(): void {
    bus.on(Topics.THOUGHT_RECORDED, (event) => {
      const record = event.data as ThoughtRecord;
      this.thoughtHistory.push(record);
      if (this.thoughtHistory.length > this.maxHistory) {
        this.thoughtHistory.splice(0, this.thoughtHistory.length - this.maxHistory);
      }
      this.updateStrategyPerformance(record);
    });
  }

  selectStrategy(taskDescription: string, taskCategory: TaskCategory = "unknown"): ThinkingStrategy {
    const relevantHistory = this.thoughtHistory.filter(r => {
      const cat = this.classifyTask(r.taskDescription);
      return cat === taskCategory;
    });

    if (relevantHistory.length === 0) {
      return "cot";
    }

    const performanceByStrategy = new Map<ThinkingStrategy, number[]>();
    for (const record of relevantHistory) {
      const existing = performanceByStrategy.get(record.strategyUsed) || [];
      existing.push(record.success ? 1 : 0);
      performanceByStrategy.set(record.strategyUsed, existing);
    }

    let bestStrategy: ThinkingStrategy = "cot";
    let bestScore = 0;

    for (const [strategy, outcomes] of performanceByStrategy) {
      const successRate = outcomes.reduce((a, b) => a + b, 0) / outcomes.length;
      const useCount = outcomes.length;
      const score = successRate * 0.7 + Math.min(useCount / 10, 1) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = strategy;
      }
    }

    const complexity = this.estimateComplexity(taskDescription);
    const selected = this.adjustStrategyForComplexity(bestStrategy, complexity);

    bus.emit(Topics.STRATEGY_SELECTED, {
      taskDescription: taskDescription.slice(0, 100),
      taskCategory,
      selected: selected,
      alternatives: this.getAlternatives(selected),
      reason: `Best based on ${relevantHistory.length} similar past tasks`,
    }, { source: "metacognition" });

    return selected;
  }

  recordThought(record: Omit<ThoughtRecord, "id" | "timestamp">): string {
    const id = `thought_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const full: ThoughtRecord = { id, timestamp: Date.now(), ...record };

    this.thoughtHistory.push(full);
    if (this.thoughtHistory.length > this.maxHistory) {
      this.thoughtHistory.splice(0, this.thoughtHistory.length - this.maxHistory);
    }

    this.updateStrategyPerformance(full);
    return id;
  }

  assessConfidence(taskDescription: string, partialResult?: string): number {
    const similarTasks = this.thoughtHistory
      .filter(r => this.taskSimilarity(r.taskDescription, taskDescription) > 0.3)
      .slice(0, 10);

    if (similarTasks.length === 0) return 0.5;

    const successRate = similarTasks.filter(r => r.success).length / similarTasks.length;
    const confidenceFromHistory = successRate;

    let confidenceFromResult = 0.5;
    if (partialResult) {
      const errorSignals = ["error", "fail", "exception", "undefined", "null", "cannot", "not found"];
      const hasErrors = errorSignals.some(s => partialResult.toLowerCase().includes(s));
      confidenceFromResult = hasErrors ? 0.3 : 0.7;
    }

    const confidence = confidenceFromHistory * 0.6 + confidenceFromResult * 0.4;

    bus.emit(Topics.CONFIDENCE_ASSESSED, {
      taskDescription: taskDescription.slice(0, 100),
      confidence: Math.round(confidence * 100) / 100,
      basedOn: similarTasks.length,
      successRate: Math.round(successRate * 100) / 100,
    }, { source: "metacognition" });

    return Math.round(confidence * 100) / 100;
  }

  identifyKnowledgeGaps(taskDescription: string): string[] {
    const gaps: string[] = [];

    if (taskDescription.includes("Docker") || taskDescription.includes("Kubernetes")) {
      if (this.thoughtHistory.filter(r => r.taskDescription.includes("Docker")).length < 3) {
        gaps.push("Container orchestration experience is limited");
      }
    }

    if (taskDescription.includes("security") || taskDescription.includes("auth")) {
      if (this.thoughtHistory.filter(r => r.taskDescription.includes("security")).length < 2) {
        gaps.push("Security domain knowledge may be limited");
      }
    }

    const techStack = this.detectTechStack(taskDescription);
    for (const tech of techStack) {
      const relatedTasks = this.thoughtHistory.filter(r => r.taskDescription.includes(tech));
      if (relatedTasks.filter(r => r.success).length < 2) {
        gaps.push(`Limited verified experience with ${tech}`);
      }
    }

    return gaps;
  }

  getStrategyStats(strategy?: ThinkingStrategy): StrategyPerformance[] {
    const all = Array.from(this.strategyPerformance.values());
    if (strategy) return all.filter(s => s.strategy === strategy);
    return all;
  }

  getOverallStats(): {
    totalThoughts: number;
    overallSuccessRate: number;
    averageConfidence: number;
    averageProcessingTime: number;
    bestStrategy: { strategy: ThinkingStrategy; successRate: number };
  } {
    if (this.thoughtHistory.length === 0) {
      return { totalThoughts: 0, overallSuccessRate: 0, averageConfidence: 0, averageProcessingTime: 0, bestStrategy: { strategy: "cot", successRate: 0 } };
    }

    const successes = this.thoughtHistory.filter(r => r.success).length;
    const avgConfidence = this.thoughtHistory.reduce((s, r) => s + r.confidence, 0) / this.thoughtHistory.length;
    const avgTime = this.thoughtHistory.reduce((s, r) => s + r.processingTimeMs, 0) / this.thoughtHistory.length;

    const byStrategy = new Map<ThinkingStrategy, { successes: number; total: number }>();
    for (const r of this.thoughtHistory) {
      const existing = byStrategy.get(r.strategyUsed) || { successes: 0, total: 0 };
      existing.total++;
      if (r.success) existing.successes++;
      byStrategy.set(r.strategyUsed, existing);
    }

    let bestStrategy: ThinkingStrategy = "cot";
    let bestRate = 0;
    for (const [strategy, stats] of byStrategy) {
      const rate = stats.successes / stats.total;
      if (rate > bestRate && stats.total >= 3) {
        bestRate = rate;
        bestStrategy = strategy;
      }
    }

    return {
      totalThoughts: this.thoughtHistory.length,
      overallSuccessRate: Math.round((successes / this.thoughtHistory.length) * 100) / 100,
      averageConfidence: Math.round(avgConfidence * 100) / 100,
      averageProcessingTime: Math.round(avgTime),
      bestStrategy: { strategy: bestStrategy, successRate: Math.round(bestRate * 100) / 100 },
    };
  }

  private classifyTask(description: string): TaskCategory {
    const lower = description.toLowerCase();
    if (lower.includes("write") || lower.includes("code") || lower.includes("implement") || lower.includes("function")) return "coding";
    if (lower.includes("search") || lower.includes("research") || lower.includes("find") || lower.includes("learn")) return "research";
    if (lower.includes("debug") || lower.includes("fix") || lower.includes("error") || lower.includes("bug")) return "debugging";
    if (lower.includes("plan") || lower.includes("design") || lower.includes("architect") || lower.includes("strategy")) return "planning";
    if (lower.includes("deploy") || lower.includes("release") || lower.includes("publish")) return "deployment";
    if (lower.includes("config") || lower.includes("setup") || lower.includes("install")) return "configuration";
    return "unknown";
  }

  private estimateComplexity(taskDescription: string): number {
    const length = taskDescription.length;
    const techTerms = taskDescription.split(/\s+/).filter(t => /[A-Z]/.test(t)).length;
    const questions = (taskDescription.match(/\?/g) || []).length;
    return Math.min(10, Math.ceil((length / 100) + techTerms * 0.5 + questions * 2));
  }

  private adjustStrategyForComplexity(strategy: ThinkingStrategy, complexity: number): ThinkingStrategy {
    if (complexity >= 8 && strategy !== "tot") return "tot";
    if (complexity >= 5 && strategy === "auto") return "cot";
    return strategy;
  }

  private getAlternatives(strategy: ThinkingStrategy): ThinkingStrategy[] {
    const all: ThinkingStrategy[] = ["cot", "tot", "react", "reflexion", "plan-execute"];
    return all.filter(s => s !== strategy);
  }

  private taskSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/));
    const tokensB = b.toLowerCase().split(/\s+/);
    const intersection = tokensB.filter(t => tokensA.has(t)).length;
    const union = tokensA.size + tokensB.length - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private detectTechStack(description: string): string[] {
    const techs = ["React", "Vue", "Angular", "Node", "Python", "Docker", "Kubernetes", "AWS", "GCP", "Azure", "TypeScript", "JavaScript", "Go", "Rust", "PostgreSQL", "MongoDB", "Redis", "GraphQL", "REST"];
    return techs.filter(t => description.includes(t));
  }

  private updateStrategyPerformance(record: ThoughtRecord): void {
    const cat = this.classifyTask(record.taskDescription);
    const key = `${record.strategyUsed}:${cat}`;
    const existing = this.strategyPerformance.get(key);

    if (existing) {
      existing.totalUses++;
      if (record.success) existing.successes++;
      else existing.failures++;
      existing.averageConfidence = (existing.averageConfidence * (existing.totalUses - 1) + record.confidence) / existing.totalUses;
      existing.averageProcessingTime = (existing.averageProcessingTime * (existing.totalUses - 1) + record.processingTimeMs) / existing.totalUses;
      existing.averageToolCalls = (existing.averageToolCalls * (existing.totalUses - 1) + record.toolCalls) / existing.totalUses;
    } else {
      this.strategyPerformance.set(key, {
        strategy: record.strategyUsed,
        taskCategory: cat,
        totalUses: 1,
        successes: record.success ? 1 : 0,
        failures: record.success ? 0 : 1,
        averageConfidence: record.confidence,
        averageProcessingTime: record.processingTimeMs,
        averageToolCalls: record.toolCalls,
      });
    }
  }

  private initializeStrategyData(): void {
    const strategies: ThinkingStrategy[] = ["cot", "tot", "react", "reflexion", "plan-execute", "auto"];
    const categories: TaskCategory[] = ["coding", "research", "debugging", "planning", "writing", "analysis", "deployment", "configuration", "unknown"];
    for (const s of strategies) {
      for (const c of categories) {
        const key = `${s}:${c}`;
        if (!this.strategyPerformance.has(key)) {
          this.strategyPerformance.set(key, {
            strategy: s,
            taskCategory: c,
            totalUses: 0,
            successes: 0,
            failures: 0,
            averageConfidence: 0.5,
            averageProcessingTime: 0,
            averageToolCalls: 0,
          });
        }
      }
    }
  }
}

export const metacognition = new Metacognition();
