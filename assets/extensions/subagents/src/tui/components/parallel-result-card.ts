import { THEME } from "../theme/theme";
import { fg, fgBold, dim } from "../theme/colorize";
import { truncate, elapsed } from "../render/format";
import { activeTrackers } from "../../animations";
import type { Component } from "@earendil-works/pi-tui";

export class ParallelAgentsResultCard implements Component {
  private result: any;
  private expanded: boolean;

  constructor(result: any, private options: any, private ctx: any) {
    this.result = result;
    this.expanded = options.expanded;
  }

  invalidate() {}

  render(width: number): string[] {
    const w = Math.min(width, 100);
    const lines: string[] = [];

    const trackers: any[] = [];
    for (const [key, t] of activeTrackers) {
      if (key.startsWith(this.ctx.toolCallId + ":") && !key.endsWith(":ceo")) {
        trackers.push(t);
      }
    }

    const successCount = trackers.filter(t => t.status === "complete").length;
    const errorCount = trackers.filter(t => t.status === "error").length;
    const total = trackers.length || 1;
    const allSuccess = errorCount === 0;

    const accentClr = allSuccess ? THEME.success : THEME.warning;
    const icon = allSuccess ? "\u2714" : "\u25b2";

    lines.push(
      fgBold(accentClr, `\u2500 ${icon} Parallel Results \u2014 ${successCount}/${total} succeeded`) +
      dim("\u2500".repeat(Math.max(0, w - 24 - String(successCount).length - String(total).length)))
    );

    const totalTime = trackers.length > 0
      ? elapsed(
          Math.min(...trackers.map(t => t.startTime)),
          Math.max(...trackers.map(t => t.endTime || Date.now()))
        )
      : "0s";
    const totalToolCalls = trackers.reduce((sum, t) => sum + t.toolCallCount, 0);

    lines.push(
      `  ${dim(`${totalTime} total \u00b7 ${totalToolCalls} tool calls`)}` +
      (errorCount > 0 ? fg(THEME.error, ` \u00b7 ${errorCount} failed`) : "")
    );

    for (const tracker of trackers) {
      const statusIcon = tracker.status === "complete"
        ? fg(THEME.success, "\u2713")
        : fg(THEME.error, "\u25b2");
      const name = fgBold(THEME.ink, tracker.name);
      const time = dim(elapsed(tracker.startTime, tracker.endTime));
      lines.push(`  ${statusIcon}  ${name}  ${time}`);

      if (tracker.result) {
        const resultLines = tracker.result.split("\n").slice(0, 8);
        for (const rl of resultLines) {
          lines.push(`    ${fg(THEME.ink, truncate(rl, w - 8))}`);
        }
        if (tracker.result.split("\n").length > 8) {
          lines.push(`    ${dim("... more lines")}`);
        }
      } else if (tracker.error) {
        lines.push(`    ${fg(THEME.error, truncate(tracker.error, w - 8))}`);
      }
    }

    return lines;
  }
}
