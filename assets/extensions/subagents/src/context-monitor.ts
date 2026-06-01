import { getAllHealth } from "./mcp-catalog";
import { getCostSummary } from "./cost-tracker";
import { stats } from "./memory-store";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const WARNING_THRESHOLDS = [0.80, 0.90, 0.95];
const WARNING_COOLDOWN_MS = 60_000;
const TOOL_LOOP_WINDOW = 5;
const MAX_DECISION_TRACES = 200;

// ── Decision Trace ─────────────────────────────────────────────────────────

export interface DecisionTrace {
  id: string;
  timestamp: number;
  stepName: string;
  decisionReasoning: string;
  toolCalled: string;
  inputParams: string;
  costImpact: number;
  sessionId: string;
  agentName: string;
}

interface ToolCallRecord {
  toolName: string;
  args: string;
  timestamp: number;
}

interface WarningState {
  threshold: number;
  lastWarnedAt: number;
}

export class ContextMonitor {
  private toolCalls: ToolCallRecord[] = [];
  private warningStates: WarningState[] = WARNING_THRESHOLDS.map(t => ({ threshold: t, lastWarnedAt: 0 }));
  private fileModifications = new Set<string>();
  private currentPercent = 0;
  private decisionTraces: DecisionTrace[] = [];
  private traceIdCounter = 0;
  private listeners: Set<(trace: DecisionTrace) => void> = new Set();

  recordToolCall(toolName: string, args: any): void {
    this.toolCalls.push({
      toolName,
      args: JSON.stringify(args).slice(0, 200),
      timestamp: Date.now(),
    });
    if (this.toolCalls.length > 100) {
      this.toolCalls = this.toolCalls.slice(-50);
    }
  }

  recordDecisionTrace(
    sessionId: string,
    agentName: string,
    stepName: string,
    decisionReasoning: string,
    toolCalled: string,
    inputParams: string,
    costImpact: number,
  ): void {
    const trace: DecisionTrace = {
      id: `dt-${++this.traceIdCounter}`,
      timestamp: Date.now(),
      stepName,
      decisionReasoning: decisionReasoning.slice(0, 500),
      toolCalled,
      inputParams: inputParams.slice(0, 200),
      costImpact,
      sessionId,
      agentName,
    };
    this.decisionTraces.push(trace);
    if (this.decisionTraces.length > MAX_DECISION_TRACES) {
      this.decisionTraces = this.decisionTraces.slice(-100);
    }
    // Notify listeners
    for (const listener of this.listeners) {
      try { listener(trace); } catch {}
    }
  }

  onDecisionTrace(listener: (trace: DecisionTrace) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getDecisionTraces(since?: number): DecisionTrace[] {
    if (since) {
      return this.decisionTraces.filter(t => t.timestamp > since);
    }
    return [...this.decisionTraces];
  }

  getRecentDecisionTraces(k: number = 10): DecisionTrace[] {
    return this.decisionTraces.slice(-k);
  }

  recordFileModification(filePath: string): void {
    this.fileModifications.add(filePath);
  }

  updateContext(percent: number): void {
    this.currentPercent = percent;
  }

  getContextPercent(): number {
    return this.currentPercent;
  }

  getFilesModified(): string[] {
    return Array.from(this.fileModifications);
  }

  getFileModificationCount(): number {
    return this.fileModifications.size;
  }

  getToolLoopWarnings(): string[] {
    const warnings: string[] = [];
    if (this.toolCalls.length < TOOL_LOOP_WINDOW) return warnings;

    const recent = this.toolCalls.slice(-TOOL_LOOP_WINDOW);
    const names = recent.map(r => r.toolName);
    const uniqueNames = new Set(names);

    if (uniqueNames.size === 1 && names.length >= 3) {
      warnings.push(`Tool loop detected: "${names[0]}" called ${names.length} times in a row.`);
    }

    return warnings;
  }

  getThresholdWarnings(): string[] {
    const warnings: string[] = [];
    for (const ws of this.warningStates) {
      if (this.currentPercent >= ws.threshold * 100) {
        const now = Date.now();
        if (now - ws.lastWarnedAt > WARNING_COOLDOWN_MS) {
          ws.lastWarnedAt = now;
          warnings.push(`Context at ${Math.round(this.currentPercent)}% (threshold: ${Math.round(ws.threshold * 100)}%). Consider compacting.`);
        }
      }
    }
    return warnings;
  }

  getSummary(): string {
    const lines: string[] = [];
    lines.push(`Context: ${Math.round(this.currentPercent)}%`);
    const modCount = this.fileModifications.size;
    if (modCount > 0) lines.push(`Files modified: ${modCount}`);
    const recentTools = this.toolCalls.slice(-3).map(t => t.toolName);
    if (recentTools.length > 0) lines.push(`Recent tools: ${recentTools.join(", ")}`);
    return lines.join(" | ");
  }

  getTelemetrySnapshot(): Record<string, any> {
    const cs = getCostSummary();
    const ms = stats();
    const health = getAllHealth();
    return {
      timestamp: Date.now(),
      contextPercent: this.currentPercent,
      filesModified: this.fileModifications.size,
      totalToolCalls: this.toolCalls.length,
      decisionTraceCount: this.decisionTraces.length,
      memoryStats: {
        totalEntries: ms.totalEntries,
        byType: ms.byType,
        totalEpisodes: ms.totalEpisodes,
      },
      costSummary: {
        totalCostUsd: cs.totalCostUsd,
        dailyCostUsd: cs.dailyCostUsd,
        totalSessions: cs.totalSessions,
      },
      healthCount: health.length,
      healthyEndpoints: health.filter(h => h.healthy).length,
    };
  }

  writeTelemetrySnapshot(): void {
    try {
      const dir = path.join(os.homedir(), ".pi", "agent");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const snapshot = this.getTelemetrySnapshot();
      snapshot.recentTraces = this.getRecentDecisionTraces(5);
      const tmp = path.join(dir, "telemetry.json.tmp");
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), "utf8");
      fs.renameSync(tmp, path.join(dir, "telemetry.json"));
    } catch { /* telemetry write must never crash */ }
  }

  reset(): void {
    this.toolCalls = [];
    this.fileModifications.clear();
    this.currentPercent = 0;
    this.warningStates = WARNING_THRESHOLDS.map(t => ({ threshold: t, lastWarnedAt: 0 }));
    this.decisionTraces = [];
    this.listeners.clear();
  }
}

export const contextMonitor = new ContextMonitor();
