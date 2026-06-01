const WARNING_THRESHOLDS = [0.80, 0.90, 0.95];
const WARNING_COOLDOWN_MS = 60_000;
const TOOL_LOOP_WINDOW = 5;

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

  reset(): void {
    this.toolCalls = [];
    this.fileModifications.clear();
    this.currentPercent = 0;
    this.warningStates = WARNING_THRESHOLDS.map(t => ({ threshold: t, lastWarnedAt: 0 }));
  }
}

export const contextMonitor = new ContextMonitor();
