import { THEME } from "../theme/theme";
import { fg, fgBold, dim } from "../theme/colorize";
import { truncate } from "../render/format";
import type { Component } from "@earendil-works/pi-tui";

export class SubAgentListCard implements Component {
  private result: any;

  constructor(result: any, private options: any) {
    this.result = result;
  }

  invalidate() {}

  render(width: number): string[] {
    const w = Math.min(width, 80);
    const lines: string[] = [];

    lines.push(
      fgBold(THEME.accent, "\u2500 \u2605 Available Sub-Agents") +
      dim("\u2500".repeat(Math.max(0, w - 24)))
    );

    const resultText = this.result?.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || "";

    if (!resultText || resultText.includes("No sub-agents")) {
      lines.push(dim("  No sub-agents configured yet."));
      lines.push(dim("  Use create_subagent to define one."));
    } else {
      const agentLines = resultText.split("\n").filter((l: string) => l.trim());
      const total = agentLines.length;
      for (let i = 0; i < total; i++) {
        const isLast = i === total - 1;
        const prefix = isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ";
        const childPrefix = isLast ? "   " : "\u2502  ";
        const match = agentLines[i].match(/\*\*(.+?)\*\*:\s*(.+?)(?:\s*\(Model:\s*(.+?),\s*Tools:\s*(.+?)\))?$/);
        if (match) {
          const [, name, desc, model, tools] = match;
          lines.push(
            prefix + fgBold(THEME.warning, name) +
            dim(" \u2014 ") + fg(THEME.ink, truncate(desc || "", w - (name || "").length - 20))
          );
          if (tools) {
            lines.push(
              childPrefix + dim("Tools: ") + fg(THEME.accent, tools) +
              (model ? dim("  \u00b7  Model: ") + fg(THEME.info, model) : "")
            );
          }
        } else {
          lines.push(prefix + fg(THEME.ink, truncate(agentLines[i].replace(/^-\s*/, ""), w - 6)));
        }
      }
    }
    return lines;
  }
}
