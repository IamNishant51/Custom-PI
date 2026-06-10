import chalk from "chalk";
import { C } from "../../tui-colors";
import { truncate, elapsed, progressBar, stripAnsi } from "../render/format";
import { getPulseColor, globalPulse, getDotPulse, activeTrackers, activeInvalidators } from "../../animations";
import type { Component } from "@earendil-works/pi-tui";

export class ParallelAgentsCallCard implements Component {
  private tasks: Array<{ agentId: string; task: string }>;
  private parentId: string;

  constructor(args: any, private ctx: any) {
    this.tasks = args.tasks || [];
    this.parentId = ctx.toolCallId;
    const key = this.parentId;
    if (!activeInvalidators.has(key)) {
      const invalidator = () => {
        let anyActive = false;
        for (const [tKey, t] of activeTrackers) {
          if (tKey.startsWith(this.parentId + ":")) {
            if (t.status === "running" || t.status === "calling_tool" || t.status === "spawning") {
              anyActive = true;
              break;
            }
          }
        }
        if (!anyActive) {
          activeInvalidators.delete(key);
        } else {
          ctx.invalidate();
        }
      };
      activeInvalidators.set(key, invalidator);
    }
  }

  invalidate() {}

  render(width: number): string[] {
    const w = Math.min(width, 100);
    const lines: string[] = [];
    const dim = (s: string) => chalk.hex(C.dusty)(s);

    const trackers: any[] = [];
    for (const [key, t] of activeTrackers) {
      if (key.startsWith(this.parentId + ":") && !key.endsWith(":ceo")) {
        trackers.push(t);
      }
    }

    const completedCount = trackers.filter(t => t.status === "complete").length;
    const errorCount = trackers.filter(t => t.status === "error").length;
    const total = this.tasks.length;
    const doneCount = completedCount + errorCount;
    const allDone = doneCount >= total && total > 0;

    if (allDone) return [];

    const pulseColor = getPulseColor();
    const pulseSymbol = globalPulse.getSymbol();
    const spinner = chalk.hex(pulseColor)(pulseSymbol);
    lines.push(
      chalk.hex(C.lavender)(`${spinner} Parallel Execution`) +
      dim(` \u00b7  ${doneCount}/${total} done`) +
      dim("\u2500".repeat(Math.max(0, w - 26 - String(doneCount).length - String(total).length)))
    );

    for (let i = 0; i < this.tasks.length; i++) {
      const isLast = i === this.tasks.length - 1;
      const prefix = isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ";
      const childPrefix = isLast ? "   " : "\u2502  ";
      const tracker = trackers.find(t => t.name === this.tasks[i].agentId) || trackers[i];
      const task = this.tasks[i];

      let icon: string, nameStyle: string, statusLine: string;
      if (!tracker || tracker.status === "spawning") {
        icon = chalk.hex(C.dusty)("\u25cc");
        nameStyle = chalk.hex(C.dusty)(task.agentId);
        statusLine = chalk.hex(C.dusty)("waiting...");
      } else if (tracker.status === "running" || tracker.status === "calling_tool") {
        icon = chalk.hex(C.teal)(getDotPulse());
        nameStyle = chalk.hex(C.cream).bold(task.agentId);
        const toolInfo = tracker.currentTool ? chalk.hex(C.lavender)(` ${tracker.currentTool}`) : "";
        statusLine = chalk.hex(C.sand)(`turn ${tracker.turn}/${tracker.maxTurns}${toolInfo}`) + dim(`  \u25f7${elapsed(tracker.startTime)}`);
      } else if (tracker.status === "complete") {
        icon = chalk.hex(C.sage)("\u2713");
        nameStyle = chalk.hex(C.sage).bold(task.agentId);
        statusLine = chalk.hex(C.sage)("done") + dim(`  ${elapsed(tracker.startTime, tracker.endTime)} \u00b7 ${tracker.toolCallCount}tools`);
      } else {
        icon = chalk.hex(C.warmRed)("\u2717");
        nameStyle = chalk.hex(C.warmRed).bold(task.agentId);
        statusLine = chalk.hex(C.coral)(tracker.error || "failed");
      }

      const taskPreview = truncate(task.task, Math.max(20, w - 40));
      lines.push(`${prefix}${icon}  ${nameStyle}  ${dim(taskPreview)}`);
      lines.push(`${childPrefix}${statusLine}`);

      if (tracker?.ceoRequest) {
        const ceo = tracker.ceoRequest;
        const cColor = ceo.status === 'requesting' || ceo.status === 'ceo_evaluating' ? C.sage : C.orange;
        const cIcon = ceo.status === 'ceo_evaluating' ? "\u25d0" : "\u25c9";
        const cLabel = ceo.status === 'requesting' ? `\u2192CEO:${ceo.toolName}`
          : ceo.status === 'ceo_evaluating' ? `CEO:${ceo.toolName}`
          : ceo.status === 'ceo_approved' ? `CEO\u2713:${ceo.toolName}`
          : `CEO\u2717:${ceo.toolName}`;
        lines.push(`${childPrefix} ${chalk.hex(cColor)(cIcon)} ${dim(cLabel)}`);
      }
    }

    const barWidth = Math.min(30, w - 30);
    const bar = progressBar(doneCount, total, barWidth);
    lines.push(`  ${chalk.hex(C.lavender)(bar)}  ${chalk.hex(C.cream)(`${doneCount}/${total} complete`)}`);

    return lines;
  }
}
