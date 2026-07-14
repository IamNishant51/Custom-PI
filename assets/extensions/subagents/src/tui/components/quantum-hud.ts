import chalk from "chalk";
import os from "node:os";
import { stripAnsi, truncateToWidth, elapsed } from "../render/format";
import { getPulseColor, getSpinner, activeTrackers } from "../../animations";
import { stats as memoryStats } from "../../memory-store";
import type { Component } from "@earendil-works/pi-tui";

interface ThemeAccessor {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
}

interface SubAgentTracker {
  id: string;
  name: string;
  status: string;
  turn: number;
  maxTurns: number;
  currentTool?: string;
  startTime: number;
}

export class QuantumHUDWidget implements Component {
  private theme: ThemeAccessor | null = null;

  private cachedMem: { totalEntries: number } | null = null;
  private cachedMemTs = 0;
  private getMemStats(): { totalEntries: number } {
    const now = Date.now();
    if (this.cachedMem && now - this.cachedMemTs < 5000) return this.cachedMem;
    try {
      this.cachedMem = memoryStats();
    } catch {
      this.cachedMem = { totalEntries: 0 };
    }
    this.cachedMemTs = now;
    return this.cachedMem;
  }

  setTheme(t: ThemeAccessor) { this.theme = t; }

  dispose() {}

  invalidate() {}

  private t(color: string, text: string): string {
    return this.theme ? this.theme.fg(color, text) : text;
  }
  private bg(color: string, text: string): string {
    return this.theme ? this.theme.bg(color, text) : text;
  }
  private bold(text: string): string {
    return this.theme ? this.theme.bold(text) : text;
  }

  render(width: number): string[] {
    const w = Math.min(width, 120);
    const lines: string[] = [];

    const memPercent = Math.round((1 - os.freemem() / os.totalmem()) * 100);
    const memUsed = (os.totalmem() / 1024 / 1024 / 1024 - os.freemem() / 1024 / 1024 / 1024).toFixed(1);
    const memTotal = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const cpuLoad = os.loadavg()[0].toFixed(1);

    const trackers = Array.from(activeTrackers.values()) as SubAgentTracker[];
    const running = trackers.filter(
      t => t.status === "running" || t.status === "calling_tool" || t.status === "spawning"
    );
    const memStats = this.getMemStats();

    const pulseColor = getPulseColor();

    const title = ` \u2756 CUSTOM-PI Swarm Dashboard `;
    const cpuStr = `cpu: ${cpuLoad}`;
    const ramStr = `ram: ${memPercent}%`;
    const memStr = memStats.totalEntries > 0 ? `mem: ${memStats.totalEntries}` : "";
    const activeStr = running.length > 0 ? `active: ${running.length}` : "idle";

    const parts = [cpuStr, ramStr, memStr, activeStr].filter(Boolean);
    const statsText = parts.join(" \u2500\u2500 ");

    const headerPrefix = this.bold(this.t("accent", title));
    const headerSuffix = ` \u2500\u2500 ${statsText} `;
    const visiblePrefixLen = stripAnsi(headerPrefix).length;
    const visibleSuffixLen = stripAnsi(headerSuffix).length;
    const dashesCount = Math.max(0, w - visiblePrefixLen - visibleSuffixLen);
    const dashes = this.t("muted", "\u2500".repeat(dashesCount));

    lines.push(headerPrefix + dashes + this.t("text", headerSuffix));

    if (trackers.length > 0) {
      trackers.forEach((agent, index) => {
        const isLast = index === trackers.length - 1;
        const branchChar = isLast ? "\u2514\u2500\u2500" : "\u251c\u2500\u2500";
        const isRunning = agent.status === "running" || agent.status === "calling_tool" || agent.status === "spawning";
        const dot = isRunning
          ? chalk.hex(pulseColor)(getSpinner())
          : agent.status === "success"
            ? this.t("success", "\u2713")
            : this.t("muted", "\u25cb");
        const name = this.bold(agent.name);
        const turn = `Turn ${agent.turn}/${agent.maxTurns}`;
        let details = "";
        if (isRunning) {
          const tool = agent.currentTool ? this.t("accent", agent.currentTool) : "thinking";
          details = ` \u2500 ${tool} \u2500 ${elapsed(agent.startTime)}`;
        } else {
          details = ` \u2500 ${agent.status}`;
        }
        const lineContent = ` ${branchChar} ${dot} ${name} (${turn})${details}`;
        lines.push(truncateToWidth(lineContent, w));
      });
    } else {
      lines.push(this.t("muted", " \u2514\u2500\u2500 No active subagents spawned."));
    }

    return lines;
  }
}
