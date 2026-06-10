import chalk from "chalk";
import { C } from "../../tui-colors";
import { truncate } from "../render/format";
import type { Component } from "@earendil-works/pi-tui";

export class SubAgentCreatedCard implements Component {
  private result: any;

  constructor(result: any, private options: any) {
    this.result = result;
  }

  invalidate() {}

  render(width: number): string[] {
    const w = Math.min(width, 70);
    const lines: string[] = [];
    const dim = (s: string) => chalk.hex(C.dusty)(s);

    lines.push(
      chalk.hex(C.teal).bold("\u2500 \u2726 New Sub-Agent Created") +
      dim("\u2500".repeat(Math.max(0, w - 26)))
    );

    const resultText = this.result?.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || "";

    const textLines = resultText.split("\n");
    for (const line of textLines.slice(0, 5)) {
      lines.push(`  ${chalk.hex(C.cream)(truncate(line, w - 4))}`);
    }

    return lines;
  }
}
