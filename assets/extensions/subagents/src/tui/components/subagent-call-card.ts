import { THEME } from "../theme/theme";
import { fg, fgBold, dim } from "../theme/colorize";
import { truncate, truncateToWidth, elapsed, progressBar, stripAnsi, measureWidth } from "../render/format";
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

    if (!tracker || tracker.status === "spawning") {
      const pulseColor = getPulseColor();
      const pulseSymbol = globalPulse.getSymbol();
      const spinner = fg(pulseColor, pulseSymbol);
      lines.push(
        fgBold(THEME.warning, `\u2500 ${spinner} Sub-Agent: ${this.agentName}`) +
        dim("\u2500".repeat(Math.max(0, w - 16 - measureWidth(stripAnsi(this.agentName)))))
      );
      lines.push(`  ${dim("spawning sub-agent...")}`);
      lines.push(`  ${dim("task: ")}${fg(THEME.ink, truncate(this.task, w - 16))}`);
    } else if (tracker.status === "running" || tracker.status === "calling_tool") {
      const pulseColor = getPulseColor();
      const pulseSymbol = globalPulse.getSymbol();
      const spinner = fg(pulseColor, pulseSymbol);
      lines.push(
        fgBold(THEME.info, `\u2500 ${spinner} Sub-Agent: ${tracker.name}`) +
        dim("\u2500".repeat(Math.max(0, w - 16 - measureWidth(stripAnsi(tracker.name)))))
      );
      const taskPreview = truncate(tracker.task, w - 16);
      lines.push(`  ${dim("Task: ")}${fg(THEME.ink, taskPreview)}`);
      const turnInfo = fg(THEME.ink, `Turn ${tracker.turn}/${tracker.maxTurns}`);
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
        ? dim(" \u00b7 ") + fg(THEME.accent, `${toolIcon} ${tracker.currentTool}`)
        : "";
      const timeInfo = dim(" \u00b7 ") + dim(`\u25f7 ${elapsed(tracker.startTime)}`);
      lines.push(`  ${turnInfo}${toolInfo}${timeInfo}`);

      if (tracker.toolCallCount > 0) {
        const verb = STATUS_VERBS[getGlobalVerbIndex() % STATUS_VERBS.length];
        const frameInVerb = getGlobalFrame() % 10;
        const charsToShow = Math.min(frameInVerb + 1, verb.length);
        const displayVerb = verb.slice(0, charsToShow) + (charsToShow < verb.length ? "\u2026" : "");
        const calls = dim(`${tracker.toolCallCount} tool calls`);
        lines.push(`  ${fgBold(THEME.warning, displayVerb)}${fg(THEME.warning, "...")}  ${dim("\u00b7")}  ${calls}`);
        if (tracker.outputLines && tracker.outputLines.length > 0) {
          const recent = tracker.outputLines.slice(-2);
          for (const ol of recent) {
            lines.push(`  ${dim(truncate(ol, w - 8))}`);
          }
        }
      }

      const barColor = tracker.turn / tracker.maxTurns > 0.7 ? THEME.success :
        tracker.turn / tracker.maxTurns > 0.3 ? THEME.info : THEME.accent;
      const dot = fg(barColor, getDotPulse());
      const barWidth = Math.min(20, w - 20);
      const bar = progressBar(tracker.turn, tracker.maxTurns, barWidth, barColor);
      lines.push(`  ${dot} ${bar}${dim(` ${Math.round((tracker.turn / tracker.maxTurns) * 100)}%`)}`);

      if (tracker.ceoRequest) {
        const ceo = tracker.ceoRequest;
        const agentName = tracker.name || this.agentName;
        const prefix = `${agentName} `;
        const suffix = ` \u2192 CEO`;
const pLen = measureWidth(stripAnsi(prefix));
const sLen = measureWidth(stripAnsi(suffix));
        const dashSpace = Math.max(4, w - 8 - pLen - sLen);
        const frame = getGlobalFrame() % 48;
        const progress = frame / 48;
        let dot2: string;
        let idx: number;
        if (ceo.status === 'requesting' || ceo.status === 'ceo_evaluating') {
          idx = Math.round(progress * (dashSpace - 1));
          dot2 = fg(THEME.success, "\u25c9");
        } else {
          idx = Math.round((1 - progress) * (dashSpace - 1));
          dot2 = fg(THEME.warning, "\u25c9");
        }
        const connLine = prefix + "\u2500".repeat(idx) + dot2 + "\u2500".repeat(Math.max(0, dashSpace - idx - 1)) + suffix;
        lines.push(`  ${dim(truncateToWidth(connLine, w - 6))}`);
        const statusColor = ceo.status === 'requesting' ? THEME.success : ceo.status === 'ceo_evaluating' ? THEME.warning : ceo.status === 'ceo_approved' ? THEME.warning : THEME.error;
        const statusIcon = ceo.status === 'requesting' ? "\u25c9" : ceo.status === 'ceo_evaluating' ? "\u25d0" : ceo.status === 'ceo_approved' ? "\u2713" : "\u2717";
        const statusMsg = ceo.status === 'requesting' ? `requesting "${ceo.toolName}" from CEO`
          : ceo.status === 'ceo_evaluating' ? `CEO evaluating "${ceo.toolName}"...`
          : ceo.status === 'ceo_approved' ? `"${ceo.toolName}" approved`
          : `"${ceo.toolName}" denied`;
        lines.push(`  ${fg(statusColor, statusIcon)} ${statusMsg}`);
      }
    } else {
      return [];
    }
    return lines;
  }
}
