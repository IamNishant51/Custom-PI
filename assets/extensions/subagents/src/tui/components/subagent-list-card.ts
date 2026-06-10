import chalk from "chalk";
import { C } from "../../tui-colors";
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
    const dim = (s: string) => chalk.hex(C.dusty)(s);

    lines.push(
      chalk.hex(C.lavender).bold("\u2500 \u2605 Available Sub-Agents") +
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
            prefix + chalk.hex(C.orange).bold(name) +
            dim(" \u2014 ") + chalk.hex(C.cream)(truncate(desc || "", w - (name || "").length - 20))
          );
          if (tools) {
            lines.push(
              childPrefix + dim("Tools: ") + chalk.hex(C.lavender)(tools) +
              (model ? dim("  \u00b7  Model: ") + chalk.hex(C.teal)(model) : "")
            );
          }
        } else {
          lines.push(prefix + chalk.hex(C.sand)(truncate(agentLines[i].replace(/^-\s*/, ""), w - 6)));
        }
      }
    }
    return lines;
  }
}
