import { THEME } from "../theme/theme";
import { fg, fgBold, dim } from "../theme/colorize";
import { truncate, elapsed, stripAnsi, measureWidth } from "../render/format";
import { activeTrackers } from "../../animations";
import type { Component } from "@earendil-works/pi-tui";

export class SubAgentResultCard implements Component {
  private result: any;
  private expanded: boolean;

  constructor(result: any, private options: any, private ctx: any) {
    this.result = result;
    this.expanded = options.expanded;
  }

  invalidate() {}

  render(width: number): string[] {
    const w = Math.min(width, 80);
    const tracker = activeTrackers.get(this.ctx.toolCallId);
    const isError = this.result?.isError || this.ctx.isError;
    const lines: string[] = [];

    const accentClr = isError ? THEME.error : THEME.success;
    const icon = isError ? "\u2717" : "\u2713";
    const name = tracker?.name || this.ctx.args?.agentId || "agent";

    lines.push(
      fgBold(accentClr, `\u2500 ${icon} Sub-Agent: ${name}`) +
      dim("\u2500".repeat(Math.max(0, w - 16 - measureWidth(stripAnsi(name)))))
    );

    if (tracker) {
      const duration = elapsed(tracker.startTime, tracker.endTime);
      const turns = `${tracker.turn} turns`;
      const tools = `${tracker.toolCallCount} tool calls`;
      lines.push(`  ${dim(`Completed in ${duration}  \u00b7  ${turns}  \u00b7  ${tools}`)}`);
    }

    const resultText = this.result?.details?.fullResult
      || this.result?.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n")
      || "";

    if (resultText) {
      const resultLines = resultText.split("\n");
      const COLLAPSED_LINES = 8;
      const showAll = this.expanded || resultLines.length <= COLLAPSED_LINES;
      const displayLines = showAll ? resultLines : resultLines.slice(0, COLLAPSED_LINES);
      const contentColor = isError ? fg(THEME.error, "") : "";
      for (const rl of displayLines) {
        lines.push(`  ${isError ? fg(THEME.error, truncate(rl, w - 4)) : fg(THEME.ink, truncate(rl, w - 4))}`);
      }
      if (!showAll) {
        const remaining = resultLines.length - COLLAPSED_LINES;
        lines.push(`  ${fg(THEME.accent, `\u25b8 ${remaining} more lines - press e to expand`)}`);
      } else if (resultLines.length > COLLAPSED_LINES) {
        lines.push(`  ${dim(`\u25be Showing all ${resultLines.length} lines - press e to collapse`)}`);
      }
    }
    return lines;
  }
}
