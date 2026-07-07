import { logger } from "../logger";
import { bus, Topics } from "../event-bus/event-bus";
import { getDaemon, Daemon } from "../daemon/daemon";
import { getGraph } from "../state-graph/property-graph";

interface LearningExample {
  id: string;
  input: string;
  output: string;
  context: string;
  success: boolean;
  userFeedback?: string;
  correctedOutput?: string;
  pattern: string;
  timestamp: number;
  tags: string[];
}

interface LearnedPattern {
  id: string;
  pattern: string;
  category: string;
  examples: LearningExample[];
  confidence: number;
  firstLearned: number;
  lastReinforced: number;
  generalizationCount: number;
  successRate: number;
}

export class ContinuousLearning {
  private examples: LearningExample[] = [];
  private patterns: Map<string, LearnedPattern> = new Map();

  constructor() {
    this.setupListeners();
    this.registerBackgroundTask();
    this.loadState();
  }

  private setupListeners(): void {
    bus.on(Topics.USER_FEEDBACK, (event) => {
      const feedback = event.data;
      if (feedback.correction && feedback.originalOutput) {
        this.learnFromCorrection({
          input: feedback.input || "",
          output: feedback.originalOutput,
          context: feedback.context || "general",
          success: false,
          userFeedback: feedback.correction,
          correctedOutput: feedback.correctedOutput,
          tags: feedback.tags || ["correction"],
        });
      }
    });

    bus.on(Topics.TOOL_RESULT, (event) => {
      const data = event.data;
      if (data.success !== undefined) {
        this.learnFromToolCall({
          input: data.toolName || "unknown_tool",
          output: data.result || "",
          context: data.task || "",
          success: data.success,
          tags: ["tool", data.toolName || "unknown"],
        });
      }
    });

    bus.on(Topics.DEPLOYMENT_COMPLETE, () => {
      this.reinforcePattern("deployment");
    });

    bus.on(Topics.DEPLOYMENT_FAIL, () => {
      this.weakenPattern("deployment");
    });
  }

  private registerBackgroundTask(): void {
    const daemon = getDaemon();
    daemon.registerTask(Daemon.createIntervalTask(
      "continuous-learning:consolidate",
      async () => await this.consolidatePatterns(),
      3600000
    ));
  }

  learnFromCorrection(example: Omit<LearningExample, "id" | "timestamp" | "pattern">): string {
    const id = `learn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const pattern = this.extractPattern(example.input, example.output);
    const entry: LearningExample = { ...example, id, timestamp: Date.now(), pattern };
    this.examples.push(entry);
    if (this.examples.length > 10000) this.examples.splice(0, 1000);

    this.updatePattern(pattern, entry, example.success, example.correctedOutput !== undefined);
    this.persistState();

    return id;
  }

  learnFromToolCall(example: Omit<LearningExample, "id" | "timestamp" | "pattern">): string {
    const id = `learn_tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const pattern = `tool:${example.input}`;
    const entry: LearningExample = { ...example, id, timestamp: Date.now(), pattern };
    this.examples.push(entry);

    this.updatePattern(pattern, entry, example.success, false);
    this.persistState();

    return id;
  }

  getAdvice(input: string, context: string): { suggestion?: string; confidence: number; sourcePattern?: string } {
    const inputPattern = this.extractPattern(input, "");

    const relevantPatterns = Array.from(this.patterns.values())
      .filter(p => {
        if (p.category === context) return true;
        const inputTokens = new Set(inputPattern.toLowerCase().split(/\s+/));
        const patternTokens = p.pattern.toLowerCase().split(/\s+/);
        const overlap = patternTokens.filter(t => inputTokens.has(t)).length;
        return overlap > 0 && p.confidence > 0.3;
      })
      .sort((a, b) => b.confidence - a.confidence);

    if (relevantPatterns.length === 0) return { confidence: 0 };

    const best = relevantPatterns[0];
    const bestExample = best.examples
      .filter(e => e.success)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (bestExample) {
      return {
        suggestion: bestExample.correctedOutput || bestExample.output,
        confidence: best.confidence,
        sourcePattern: best.pattern,
      };
    }

    return { confidence: Math.max(0.1, best.confidence * 0.5), sourcePattern: best.pattern };
  }

  getStats(): { totalExamples: number; totalPatterns: number; highConfidencePatterns: number; correctionRate: number } {
    const corrections = this.examples.filter(e => e.userFeedback).length;
    return {
      totalExamples: this.examples.length,
      totalPatterns: this.patterns.size,
      highConfidencePatterns: Array.from(this.patterns.values()).filter(p => p.confidence > 0.7).length,
      correctionRate: this.examples.length > 0 ? corrections / this.examples.length : 0,
    };
  }

  getPatterns(minConfidence = 0.5): LearnedPattern[] {
    return Array.from(this.patterns.values())
      .filter(p => p.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  private updatePattern(pattern: string, example: LearningExample, success: boolean, correction: boolean): void {
    const existing = this.patterns.get(pattern);
    if (existing) {
      existing.examples.push(example);
      existing.lastReinforced = Date.now();
      existing.generalizationCount++;

      const recentSuccesses = existing.examples.filter(e => e.timestamp > Date.now() - 86400000 && e.success).length;
      const recentTotal = existing.examples.filter(e => e.timestamp > Date.now() - 86400000).length;
      existing.successRate = recentTotal > 0 ? recentSuccesses / recentTotal : existing.successRate;

      if (correction) {
        existing.confidence = Math.min(1, existing.confidence + 0.1);
      } else if (success) {
        existing.confidence = Math.min(1, existing.confidence + 0.05);
      } else {
        existing.confidence = Math.max(0, existing.confidence - 0.1);
      }
    } else {
      this.patterns.set(pattern, {
        id: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pattern,
        category: example.tags[0] || example.context,
        examples: [example],
        confidence: success ? 0.4 : 0.1,
        firstLearned: Date.now(),
        lastReinforced: Date.now(),
        generalizationCount: 1,
        successRate: success ? 1 : 0,
      });
    }
  }

  private reinforcePattern(category: string): void {
    for (const [key, pattern] of this.patterns) {
      if (pattern.category === category || key.includes(category)) {
        pattern.confidence = Math.min(1, pattern.confidence + 0.02);
        pattern.lastReinforced = Date.now();
      }
    }
  }

  private weakenPattern(category: string): void {
    for (const [key, pattern] of this.patterns) {
      if (pattern.category === category || key.includes(category)) {
        pattern.confidence = Math.max(0, pattern.confidence - 0.05);
      }
    }
  }

  private async consolidatePatterns(): Promise<void> {
    const hour = 3600000;
    const oldPatterns = Array.from(this.patterns.entries())
      .filter(([_, p]) => p.confidence < 0.1 && (Date.now() - p.lastReinforced) > 7 * 24 * hour);

    for (const [key] of oldPatterns) {
      this.patterns.delete(key);
    }

    const lowExamples = this.examples.filter(e => !e.success && (Date.now() - e.timestamp) > 30 * 24 * hour);
    for (const example of lowExamples) {
      const idx = this.examples.indexOf(example);
      if (idx > -1) this.examples.splice(idx, 1);
    }

    this.persistState();
  }

  private extractPattern(input: string, output: string): string {
    const inputLower = input.toLowerCase().replace(/[0-9]+/g, "NUM").replace(/['"`]/g, "").slice(0, 100);
    const outputLower = output.toLowerCase().replace(/[0-9]+/g, "NUM").replace(/['"`]/g, "").slice(0, 50);
    return `${inputLower}:${outputLower}`;
  }

  private persistState(): void {
    try {
      const graph = getGraph();
      graph.addNode("custom", "Learning Patterns", {
        patternCount: this.patterns.size,
        exampleCount: this.examples.length,
        highConfidenceCount: Array.from(this.patterns.values()).filter(p => p.confidence > 0.7).length,
      }, { id: "learning_state" });
    } catch { logger.warn("empty catch block") }
  }

  private loadState(): void {
    try {
      const graph = getGraph();
      const node = graph.getNode("learning_state");
      if (node) {
        this.patterns.clear();
        this.examples.length = 0;
      }
    } catch { logger.warn("empty catch block") }
  }
}

export const continuousLearning = new ContinuousLearning();
