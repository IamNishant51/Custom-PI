import chalk from "chalk";
import { C } from "../../tui-colors";
import { truncate, truncateToWidth, elapsed, progressBar, stripAnsi } from "../render/format";
import { getPulseColor, getGlobalFrame, globalPulse, getDotPulse, getGlobalVerbIndex, STATUS_VERBS, activeTrackers, activeInvalidators, startGlobalAnimation, stopGlobalAnimation } from "../../animations";
import type { Component } from "@earendil-works/pi-tui";

export class SubAgentCallCard implements Component {
  private agentName: string;
  private task: string;
  private trackerId: string;

  constructor(args: any, private ctx: any) {
    this.agentName = args.agentId || "unknown";
    this.task = args.task || "";
    this.trackerId = ctx.toolCallId;
    const key = this.trackerId;
    if (!activeInvalidators.has(key)) {
      const invalidator = () => {
        const tracker = activeTrackers.get(this.trackerId);
        if (!tracker || tracker.status === "complete" || tracker.status === "error") {
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
    const w = Math.min(width, 80);
    const tracker = activeTrackers.get(this.trackerId);
    const lines: string[] = [];
    const dim = (s: string) => chalk.hex(C.dusty)(s);

    if (!tracker || tracker.status === "spawning") {
      const pulseColor = getPulseColor();
      const pulseSymbol = globalPulse.getSymbol();
      const spinner = chalk.hex(pulseColor)(pulseSymbol);
      lines.push(
        chalk.hex(C.orange).bold(`\u2500 ${spinner} Sub-Agent: ${this.agentName}`) +
        dim("\u2500".repeat(Math.max(0, w - 16 - stripAnsi(this.agentName).length)))
      );
      lines.push(`  ${dim("spawning sub-agent...")}`);
      lines.push(`  ${dim("task: ")}${chalk.hex(C.sand)(truncate(this.task, w - 16))}`);
    } else if (tracker.status === "running" || tracker.status === "calling_tool") {
      const pulseColor = getPulseColor();
      const pulseSymbol = globalPulse.getSymbol();
      const spinner = chalk.hex(pulseColor)(pulseSymbol);
      lines.push(
        chalk.hex(C.teal).bold(`\u2500 ${spinner} Sub-Agent: ${tracker.name}`) +
        dim("\u2500".repeat(Math.max(0, w - 16 - stripAnsi(tracker.name).length)))
      );
      const taskPreview = truncate(tracker.task, w - 16);
      lines.push(`  ${dim("Task: ")}${chalk.hex(C.cream)(taskPreview)}`);
      const turnInfo = chalk.hex(C.sand)(`Turn ${tracker.turn}/${tracker.maxTurns}`);
      let toolIcon = "";
      if (tracker.currentTool) {
        const toolName = tracker.currentTool;
        if (toolName.includes("read") || toolName.includes("search") || toolName.includes("grep")) toolIcon = "\u25a1";
        else if (toolName.includes("write") || toolName.includes("create") || toolName.includes("edit")) toolIcon = "\u270e";
        else if (toolName.includes("bash") || toolName.includes("run") || toolName.includes("exec")) toolIcon = "\u25b6";
        else if (toolName.includes("list") || toolName.includes("ls") || toolName.includes("glob")) toolIcon = "\u2261";
        else toolIcon = "\u25b4";
      }
      const toolInfo = tracker.currentTool
        ? dim(" \u00b7 ") + chalk.hex(C.lavender)(`${toolIcon} ${tracker.currentTool}`)
        : "";
      const timeInfo = dim(" \u00b7 ") + dim(`\u25f7 ${elapsed(tracker.startTime)}`);
      lines.push(`  ${turnInfo}${toolInfo}${timeInfo}`);

      if (tracker.toolCallCount > 0) {
        const verb = STATUS_VERBS[getGlobalVerbIndex() % STATUS_VERBS.length];
        const frameInVerb = getGlobalFrame() % 10;
        const charsToShow = Math.min(frameInVerb + 1, verb.length);
        const displayVerb = verb.slice(0, charsToShow) + (charsToShow < verb.length ? "\u2026" : "");
        const calls = dim(`${tracker.toolCallCount} tool calls`);
        lines.push(`  ${chalk.hex(C.orange).bold(displayVerb)}${chalk.hex(C.orange)("...")}  ${dim("\u00b7")}  ${calls}`);
        if (tracker.outputLines && tracker.outputLines.length > 0) {
          const recent = tracker.outputLines.slice(-2);
          for (const ol of recent) {
            lines.push(`  ${dim(truncate(ol, w - 8))}`);
          }
        }
      }

      const barColor = tracker.turn / tracker.maxTurns > 0.7 ? C.sage :
        tracker.turn / tracker.maxTurns > 0.3 ? C.teal : C.lavender;
      const dot = chalk.hex(barColor)(getDotPulse());
      const barWidth = Math.min(20, w - 20);
      const bar = progressBar(tracker.turn, tracker.maxTurns, barWidth, barColor);
      lines.push(`  ${dot} ${bar}${dim(` ${Math.round((tracker.turn / tracker.maxTurns) * 100)}%`)}`);

      if (tracker.ceoRequest) {
        const ceo = tracker.ceoRequest;
        const agentName = tracker.name || this.agentName;
        const prefix = `${agentName} `;
        const suffix = ` \u2192 CEO`;
        const pLen = stripAnsi(prefix).length;
        const sLen = stripAnsi(suffix).length;
        const dashSpace = Math.max(4, w - 8 - pLen - sLen);
        const frame = getGlobalFrame() % 48;
        const progress = frame / 48;
        let dot2: string;
        let idx: number;
        if (ceo.status === 'requesting' || ceo.status === 'ceo_evaluating') {
          idx = Math.round(progress * (dashSpace - 1));
          dot2 = chalk.hex(C.sage)("\u25c9");
        } else {
          idx = Math.round((1 - progress) * (dashSpace - 1));
          dot2 = chalk.hex(C.orange)("\u25c9");
        }
        const connLine = prefix + "\u2500".repeat(idx) + dot2 + "\u2500".repeat(Math.max(0, dashSpace - idx - 1)) + suffix;
        lines.push(`  ${dim(truncateToWidth(connLine, w - 6))}`);
        const statusColor = ceo.status === 'requesting' ? C.sage : ceo.status === 'ceo_evaluating' ? C.amber : ceo.status === 'ceo_approved' ? C.orange : C.coral;
        const statusIcon = ceo.status === 'requesting' ? "\u25c9" : ceo.status === 'ceo_evaluating' ? "\u25d0" : ceo.status === 'ceo_approved' ? "\u2713" : "\u2717";
        const statusMsg = ceo.status === 'requesting' ? `requesting "${ceo.toolName}" from CEO`
          : ceo.status === 'ceo_evaluating' ? `CEO evaluating "${ceo.toolName}"...`
          : ceo.status === 'ceo_approved' ? `"${ceo.toolName}" approved`
          : `"${ceo.toolName}" denied`;
        lines.push(`  ${chalk.hex(statusColor)(statusIcon)} ${statusMsg}`);
      }
    } else {
      return [];
    }
    return lines;
  }
}
