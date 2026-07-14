import { EventEmitter } from "node:events";
import { logger } from "../../logger";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { THEME } from "../theme/theme";
import { ICONS } from "../theme/icons";
import { fg, fgBold, bgFg, dim } from "../theme/colorize";
import { hexToRgb } from "../utils/color";
import { stripAnsi, truncateToWidth, truncateLines, measureWidth } from "../render/format";
import { render as renderMarkdown } from "../markdown/render";
import { setReRenderCallback } from "../markdown/highlight";
import { getGlobalFrame } from "../../animations";
import { getHostAdapter } from "../../host-adapter";
import { appMode } from "../../runtime/agent-state";

// Use runtime require to bypass static type-resolution limitations
const piAgent = require("@earendil-works/pi-coding-agent") as any;
const UserMessageComponent = piAgent.UserMessageComponent;
const AssistantMessageComponent = piAgent.AssistantMessageComponent;
const ToolExecutionComponent = piAgent.ToolExecutionComponent;
const CustomEditor = piAgent.CustomEditor;
const FooterComponent = piAgent.FooterComponent;
const DynamicBorder = piAgent.DynamicBorder;

const piTui = require("@earendil-works/pi-tui") as any;
const Container = piTui.Container;
const TUI = piTui.TUI;
const sliceByColumn = piTui.sliceByColumn;

let chatContainerStartLine = 0;
let renderedComponents: Array<{
  component: any;
  startLine: number;
  endLine: number;
}> = [];
let activeTuiInstance: any = null;

let livePatchesApplied = false;
let containerPatched = false;
let userMessagePatched = false;
let toolExecutionPatched = false;
let customEditorPatched = false;
let dynamicBorderPatched = false;
let footerComponentPatched = false;
let assistantMessagePatched = false;

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

let treeCtx: { index: number; total: number } = { index: 0, total: 0 };
let treeCtxActive = false;
let showHelpOverlay = false;

const HELP_LINES = [
  "┌─────────────────────────────────────────────┐",
  "│  Custom-PI  Keyboard Shortcuts              │",
  "├─────────────────────────────────────────────┤",
  "│  Enter         Submit message               │",
  "│  Shift+Enter   New line                     │",
  "│  ↑ / ↓         History                      │",
  "│  Tab           Toggle AGENT / PLAN mode     │",
  "│  Ctrl+C        Interrupt / Exit             │",
  "│  Ctrl+R        Toggle reasoning             │",
  "│  Ctrl+B        Swarm panel                  │",
  "│  Ctrl+H        Session history              │",
  "│  Ctrl+L        Clear screen                 │",
  "│  Escape        Abort generation             │",
  "│  ?             This help                    │",
  "├─────────────────────────────────────────────┤",
  "│  Press any key to dismiss                   │",
  "└─────────────────────────────────────────────┘"
];

const debugLog = process.env.PI_DEBUG
  ? (msg: string) => {
      try {
        fs.appendFileSync(path.join(os.homedir(), ".pi", "agent", "tui-click.log"), `[${new Date().toISOString()}] ${msg}\n`);
      } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
    }
  : () => {};

export async function locateTheme(): Promise<any> {
  return null;
}

export function getActiveSession() {
  if (!activeTuiInstance) return null;
  const footer = activeTuiInstance.children?.find((c: any) => c && c.constructor?.name === "FooterComponent");
  return footer?.session || null;
}

export function getFooterData() {
  if (!activeTuiInstance) return null;
  const footer = activeTuiInstance.children?.find((c: any) => c && c.constructor?.name === "FooterComponent");
  return footer?.footerData || null;
}

export function formatCwdForFooter(cwd: string, home?: string): string {
  if (!cwd) return "";
  if (!home) return cwd;
  const resolvedCwd = path.resolve(cwd);
  const resolvedHome = path.resolve(home);
  if (resolvedCwd === resolvedHome) return "~";
  if (resolvedCwd.startsWith(resolvedHome + path.sep)) {
    return "~" + resolvedCwd.slice(resolvedHome.length);
  }
  return cwd;
}

function overlayHelp(lines: string[], width: number) {
  const overlayHeight = HELP_LINES.length;
  const overlayWidth = 47;
  const startRow = Math.max(0, Math.floor((lines.length - overlayHeight) / 2));
  const startCol = Math.max(0, Math.floor((width - overlayWidth) / 2));

  for (let r = 0; r < overlayHeight; r++) {
    const targetRow = startRow + r;
    if (targetRow >= lines.length) break;

    const originalLine = lines[targetRow];
    const overlayLine = HELP_LINES[r];
    
    const leftPart = sliceByColumn(originalLine, 0, startCol);
    const rightPart = sliceByColumn(originalLine, startCol + overlayWidth);
    lines[targetRow] = leftPart + fg(THEME.accent, overlayLine) + rightPart;
  }
}

function getPrimaryArg(toolName: string, args: any): string {
  if (!args || typeof args !== "object") return "";
  if (toolName === "bash" && args.CommandLine) return args.CommandLine;
  if (toolName === "bash" && args.command) return args.command;
  if (args.query) return args.query;
  if (args.path) return args.path;
  if (args.AbsolutePath) return args.AbsolutePath;
  if (args.TargetFile) return args.TargetFile;
  
  const values = Object.values(args);
  if (values.length > 0) {
    const val = values[0];
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  return "";
}

function findMarkdownComponent(component: any): any {
  if (!component) return null;
  if (component.constructor?.name === "Markdown" || component.constructor?.name === "Text") {
    return component;
  }
  if (component.children && component.children.length > 0) {
    for (const child of component.children) {
      const found = findMarkdownComponent(child);
      if (found) return found;
    }
  }
  return null;
}

function stripBackgroundColors(str: string): string {
  return str.replace(/\x1b\[([0-9;]*)m/g, (match, p1) => {
    const parts = p1.split(";");
    const newParts: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const val = parseInt(parts[i], 10);
      if (Number.isNaN(val)) {
        newParts.push(parts[i]);
        continue;
      }
      if ((val >= 40 && val <= 47) || (val >= 100 && val <= 107)) {
        // Skip standard background colors
        continue;
      }
      if (val === 48) {
        // Truecolor or 256 background color
        if (parts[i + 1] === "5") {
          i = Math.min(parts.length - 1, i + 2);
        } else if (parts[i + 1] === "2") {
          i = Math.min(parts.length - 1, i + 4);
        }
        continue;
      }
      newParts.push(parts[i]);
    }
    if (newParts.length === 0) return "";
    return `\x1b[${newParts.join(";")}m`;
  });
}

function patchUserMessage(proto: any) {
  if (userMessagePatched) return;
  userMessagePatched = true;
  debugLog("PATCHING USER MESSAGE PROTOTYPE");

  const originalRender = proto.render;
  proto.render = function (this: any, width: number) {
    try {
      const markdownComponent = findMarkdownComponent(this);
      if (!markdownComponent) {
        return originalRender.call(this, width);
      }

      const contentWidth = Math.max(20, width - 8);
      const rawText = markdownComponent.content || markdownComponent.text || "";
      const mdLines = rawText
        ? renderMarkdown(rawText, { width: contentWidth })
        : markdownComponent.render(contentWidth);

      if (mdLines.length === 0) return [];

      const maxLineLen = Math.max(...mdLines.map((l: string) => stripAnsi(l).length));
      const indentVal = Math.max(0, width - maxLineLen - 4);
      const indentSpaces = " ".repeat(indentVal);

      const lines: string[] = [];
      lines.push(OSC133_ZONE_START + indentSpaces + "\x1b[36m>\x1b[0m " + (mdLines[0] || ""));
      for (let i = 1; i < mdLines.length; i++) {
        lines.push(indentSpaces + "  " + (mdLines[i] || ""));
      }
      lines[lines.length - 1] = lines[lines.length - 1] + OSC133_ZONE_END + OSC133_ZONE_FINAL;

      return truncateLines(lines, width);
    } catch (err: any) {
      logger.error(`[TUI] UserMessage rendering failed: ${err.message}`);
      return originalRender.call(this, width);
    }
  };
}

function patchAssistantMessage(proto: any) {
  if (assistantMessagePatched) return;
  assistantMessagePatched = true;
  debugLog("PATCHING ASSISTANT MESSAGE PROTOTYPE");

  const originalRender = proto.render;

  proto.setHideThinkingBlock = function (this: any, val: boolean) {
    this.hideThinkingBlock = val;
  };

  proto.render = function (this: any, width: number) {
    try {
      const contentWidth = Math.max(20, width - 8);
      let lines: string[] = [];

      if (this.lastMessage && Array.isArray(this.lastMessage.content)) {
        for (const c of this.lastMessage.content) {
          if (c.type === "text" && c.text.trim()) {
            const textLines = renderMarkdown(c.text.trim(), { width: contentWidth, streaming: !!this.isStreaming });
            if (lines.length > 0) lines.push("");
            lines.push(...textLines);
          } else if (c.type === "thinking" && c.thinking.trim()) {
            const isCollapsed = this.hideThinkingBlock !== false;
            if (lines.length > 0) lines.push("");

            if (isCollapsed) {
              lines.push(`  \x1b[2m\x1b[3m▶ Reasoning  (click to expand)\x1b[0m`);
            } else {
              lines.push(`  \x1b[2m▼ Reasoning\x1b[0m`);
              const innerWidth = contentWidth - 4;
              const topBorder = `  \x1b[2m╭${"─".repeat(innerWidth)}╮\x1b[0m`;
              const bottomBorder = `  \x1b[2m╰${"─".repeat(innerWidth)}╯\x1b[0m`;
              lines.push(topBorder);
              
              const thinkingLines = renderMarkdown(c.thinking.trim(), { width: innerWidth, streaming: !!this.isStreaming });
              for (const line of thinkingLines) {
                const plainLine = stripAnsi(line);
                const padding = " ".repeat(Math.max(0, innerWidth - plainLine.length));
                lines.push(`  \x1b[2m│\x1b[0m \x1b[2m${line}${padding}\x1b[0m \x1b[2m│\x1b[0m`);
              }
              lines.push(bottomBorder);
            }
          }
        }
      } else {
        lines = originalRender.call(this, contentWidth);
      }

      if (lines.length === 0) return lines;

      const accentColor = (s: string) => fg(THEME.accent, s);
      const assistantLabel = ICONS.assistantLabel;
      const prefix = ICONS.assistantTurn + " ";

      const result: string[] = [];
      result.push("  " + accentColor(truncateToWidth(prefix + assistantLabel, width - 6)));
      result.push(""); // blank line
      for (const line of lines) {
        result.push("  " + line);
      }

      if (this.isStreaming) {
        const lastIdx = result.length - 1;
        if (lastIdx >= 0) {
          const frame = getGlobalFrame();
          const pulse = Math.sin(frame * 0.15) * 0.5 + 0.5;
          const brightness = Math.round(160 + pulse * 95);
          const cursor = `\x1b[38;2;${brightness};${brightness};${brightness}m\u2588\x1b[0m`;
          result[lastIdx] = result[lastIdx] + cursor;
        }
      }

      return result;
    } catch (err: any) {
      logger.error(`[TUI] AssistantMessage rendering failed: ${err.message}`);
      return originalRender.call(this, width);
    }
  };
}

function patchToolExecution(proto: any) {
  if (toolExecutionPatched) return;
  toolExecutionPatched = true;
  debugLog("PATCHING TOOL EXECUTION PROTOTYPE");

  const originalToolRender = proto.render;
  proto.render = function (this: any, width: number) {
    if (this.hideComponent) return [];

    if (!this.startTime) {
      this.startTime = Date.now();
    }
    if (!this.isPartial && !this.endTime) {
      this.endTime = Date.now();
    }

    const isRunning = this.isPartial;
    const isError = this.result?.isError;
    const durationMs = (this.endTime || Date.now()) - (this.startTime || Date.now());
    const durationSec = (durationMs / 1000).toFixed(1);

    let headerLine = "";
    if (isRunning) {
      const frame = getGlobalFrame();
      const spinnerChar = ICONS.spinnerDots[frame % ICONS.spinnerDots.length];
      const statusDot = `\x1b[33m${spinnerChar}\x1b[0m`;
      const primaryStr = getPrimaryArg(this.toolName, this.args);
      const argText = primaryStr ? `  \x1b[2m"${primaryStr.slice(0, 60)}"\x1b[0m` : "";
      headerLine = `  ${statusDot} \x1b[2m\x1b[37m${this.toolName}\x1b[0m${argText}`;
      return [headerLine];
    }

    if (isError) {
      const statusDot = `\x1b[31m✗\x1b[0m`;
      const errorMsg = this.result?.details?.message || this.result?.details || "failed";
      headerLine = `  ${statusDot} \x1b[2m\x1b[37m${this.toolName}\x1b[0m  \x1b[2m(${durationSec}s)\x1b[0m  \x1b[31m${errorMsg}\x1b[0m`;
      
      const contentWidth = Math.max(10, width - 8);
      let rawLines = originalToolRender.call(this, contentWidth);
      rawLines = rawLines.map((l: string) => stripBackgroundColors(l));
      rawLines = rawLines.filter((l: string) => l.trim() !== "");
      const outputLines = rawLines.slice(0, 10).map((l: string) => `  \x1b[31m│\x1b[0m  \x1b[2m${l}\x1b[0m`);
      
      return [headerLine, ...outputLines];
    }

    const statusDot = `\x1b[32m✓\x1b[0m`;
    headerLine = `  ${statusDot} \x1b[2m\x1b[37m${this.toolName}\x1b[0m  \x1b[2m(${durationSec}s)\x1b[0m`;

    const isEditTool = this.toolName === "edit" || this.toolName === "write" || this.toolName === "str_replace" || this.toolName === "file_edit";
    if (isEditTool) {
      const contentWidth = Math.max(10, width - 8);
      let rawLines = originalToolRender.call(this, contentWidth);
      rawLines = rawLines.map((l: string) => stripBackgroundColors(l));
      rawLines = rawLines.filter((l: string) => l.trim() !== "");
      
      const added = rawLines.filter((l: string) => l.trim().startsWith("+") && !l.trim().startsWith("+++")).length;
      const removed = rawLines.filter((l: string) => l.trim().startsWith("-") && !l.trim().startsWith("---")).length;
      if (added > 0 || removed > 0) {
        const diffSummary = `  \x1b[2m│\x1b[0m  \x1b[32m+${added} lines\x1b[0m  \x1b[31m-${removed} lines\x1b[0m`;
        return [headerLine, diffSummary];
      }
    }

    return [headerLine];
  };
}

function patchCustomEditor(proto: any) {
  if (customEditorPatched) return;
  customEditorPatched = true;
  debugLog("PATCHING CUSTOM EDITOR PROTOTYPE");

  proto.render = function (this: any, width: number) {
    const paddingX = this.paddingX || 0;
    const contentWidth = Math.max(1, width - paddingX * 2);
    const prefixWidth = 2;
    const contentWidthForText = Math.max(1, contentWidth - prefixWidth);
    const layoutWidth = Math.max(1, contentWidthForText - (paddingX ? 0 : 1));
    this.lastWidth = layoutWidth;

    const layoutLines = this.layoutText(layoutWidth);
    const terminalRows = this.tui.terminal.rows;
    const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));

    let cursorLineIndex = layoutLines.findIndex((line: any) => line.hasCursor);
    if (cursorLineIndex === -1) cursorLineIndex = 0;

    if (cursorLineIndex < this.scrollOffset) {
      this.scrollOffset = cursorLineIndex;
    } else if (cursorLineIndex >= this.scrollOffset + maxVisibleLines) {
      this.scrollOffset = cursorLineIndex - maxVisibleLines + 1;
    }
    const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScrollOffset));

    const visibleLines = layoutLines.slice(this.scrollOffset, this.scrollOffset + maxVisibleLines);
    const result: string[] = [];
    const leftPadding = " ".repeat(paddingX);
    const rightPadding = leftPadding;
    const dimFn = (s: string) => fg(THEME.muted, s);

    const horizontalStr = "\u2500".repeat(width);
    const horizontal = dimFn(horizontalStr);

    if (this.scrollOffset > 0) {
      const indicator = `\u2500\u2500\u2500 \u2191 ${this.scrollOffset} more `;
      const remaining = width - measureWidth(stripAnsi(indicator));
      if (remaining >= 0) {
        result.push(dimFn(indicator + "\u2500".repeat(remaining)));
      } else {
        result.push(dimFn(truncateToWidth(indicator, width)));
      }
    } else {
      result.push(horizontal);
    }

    const emitCursorMarker = this.focused && !this.autocompleteState;
    const prefixStr = "\x1b[36m>\x1b[0m ";
    const indentStr = "  ";

    const segmenter = typeof this.segment === "function"
      ? this.segment.bind(this)
      : (s: string) => [...s].map(c => ({ segment: c }));

    const adapter2 = getHostAdapter();
    const CURSOR_MARKER = adapter2.cursorMarker();
    const vw = adapter2.visibleWidth;

    const isEmpty = !this.value || this.value.length === 0;

    for (let i = 0; i < visibleLines.length; i++) {
      const layoutLine = visibleLines[i];
      let displayText = layoutLine.text;
      let lineVisibleWidth = vw(layoutLine.text);
      let cursorInPadding = false;

      if (isEmpty) {
        const marker = emitCursorMarker ? CURSOR_MARKER : "";
        const cursor = emitCursorMarker ? "\x1b[7m \x1b[0m" : "";
        displayText = "\x1b[2mMessage Custom-PI…\x1b[0m" + marker + cursor;
        lineVisibleWidth = measureWidth("Message Custom-PI…") + (emitCursorMarker ? 1 : 0);
      } else if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {
        const before = displayText.slice(0, layoutLine.cursorPos);
        const after = displayText.slice(layoutLine.cursorPos);
        const marker = emitCursorMarker ? CURSOR_MARKER : "";
        if (after.length > 0) {
          const afterGraphemes = [...segmenter(after, "grapheme")];
          const firstGrapheme = afterGraphemes[0]?.segment || "";
          const restAfter = after.slice(firstGrapheme.length);
          const cursor = `\x1b[7m${firstGrapheme}\x1b[0m`;
          displayText = before + marker + cursor + restAfter;
        } else {
          const cursor = "\x1b[7m \x1b[0m";
          displayText = before + marker + cursor;
          lineVisibleWidth = lineVisibleWidth + 1;
          if (lineVisibleWidth > contentWidthForText && paddingX > 0) {
            cursorInPadding = true;
          }
        }
      }

      const linePrefix = (i === 0 && this.scrollOffset === 0) ? prefixStr : indentStr;
      const padding = " ".repeat(Math.max(0, contentWidthForText - lineVisibleWidth));
      const lineRightPadding = cursorInPadding ? rightPadding.slice(1) : rightPadding;
      result.push(`${leftPadding}${linePrefix}${displayText}${padding}${lineRightPadding}`);
    }

    const linesBelow = layoutLines.length - (this.scrollOffset + visibleLines.length);
    if (linesBelow > 0) {
      const indicator = `\u2500\u2500\u2500 \u2193 ${linesBelow} more `;
      const remaining = width - measureWidth(stripAnsi(indicator));
      result.push(dimFn(indicator + "\u2500".repeat(Math.max(0, remaining))));
    }

    if (this.autocompleteState && this.autocompleteList) {
      const autocompleteResult = this.autocompleteList.render(contentWidthForText);
      for (const line of autocompleteResult) {
        const lineWidth = vw(line);
        const linePadding = " ".repeat(Math.max(0, contentWidthForText - lineWidth));
        result.push(`${leftPadding}${indentStr}${line}${linePadding}${rightPadding}`);
      }
    }

    return result;
  };
}

function patchDynamicBorder(proto: any) {
  if (dynamicBorderPatched) return;
  dynamicBorderPatched = true;
  debugLog("PATCHING DYNAMIC BORDER PROTOTYPE");
  proto.render = function (this: any, width: number) {
    return [];
  };
}

function patchFooterComponent(proto: any) {
  if (footerComponentPatched) return;
  footerComponentPatched = true;
  debugLog("PATCHING FOOTER COMPONENT PROTOTYPE");

  proto.render = function (this: any, width: number) {
    const session = this.session;
    if (!session) return [];

    const state = session.state;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;

    for (const entry of session.sessionManager.getEntries()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        totalInput += entry.message.usage.input;
        totalOutput += entry.message.usage.output;
        totalCost += entry.message.usage.cost.total;
      }
    }

    const totalTokens = totalInput + totalOutput;
    const modelName = state.model?.id || "gemma-4-e4b";

    const mode = appMode;
    const modeColour = mode === "agent" ? "\x1b[32m" : "\x1b[33m";
    const modeSymbol = mode === "agent" ? "●" : "◆";
    const modeText = mode === "agent" ? "AGENT" : "PLAN";

    const left = `${modeColour}${modeSymbol} ${modeText}\x1b[0m`;
    const mid = `\x1b[2m·\x1b[0m  \x1b[36m${modelName}\x1b[0m  \x1b[2m·  ${totalTokens.toLocaleString()} tok  ·  $${totalCost.toFixed(3)}\x1b[0m`;
    const right = `\x1b[2mTab to toggle  ·  ? for help\x1b[0m`;

    const fullLeft = `${left}  ${mid}`;
    const leftVisible = stripAnsi(fullLeft).length;
    const rightVisible = stripAnsi(right).length;
    const spaces = Math.max(1, width - leftVisible - rightVisible);

    return [fullLeft + " ".repeat(spaces) + right];
  };
}

function handleTerminalMouseClick(col: number, row: number) {
  debugLog(`CLICK AT col=${col}, row=${row}`);
  if (!activeTuiInstance) return;

  const viewportTop = activeTuiInstance.previousViewportTop || 0;
  const lineIndex = viewportTop + row - 1;

  const clicked = renderedComponents.find(rc => {
    const absStart = chatContainerStartLine + rc.startLine;
    const absEnd = chatContainerStartLine + rc.endLine;
    return lineIndex >= absStart && lineIndex < absEnd;
  });

  if (!clicked) return;

  if (clicked.component.constructor?.name === "UserMessageComponent") {
    const idx = renderedComponents.indexOf(clicked);
    const nextRc = renderedComponents.slice(idx + 1).find(rc => rc.component.constructor?.name === "AssistantMessageComponent");
    if (nextRc) {
      const assistant = nextRc.component;
      assistant.setHideThinkingBlock(!assistant.hideThinkingBlock);
      activeTuiInstance.requestRender();
    }
  } else if (clicked.component.constructor?.name === "AssistantMessageComponent") {
    const assistant = clicked.component;
    assistant.setHideThinkingBlock(!assistant.hideThinkingBlock);
    activeTuiInstance.requestRender();
  }
}

export function applyContainerPatch(containerProto: any): void {
  if (containerPatched) return;
  containerPatched = true;

  const originalContainerRender = containerProto.render;
  containerProto.render = function (this: any, width: number) {
    const isChatContainer = this.children && this.children.some((child: any) =>
      child.constructor?.name === "UserMessageComponent" || child.constructor?.name === "AssistantMessageComponent"
    );

    if (isChatContainer) {
      const renderable = this.children.filter((c: any) =>
        c && (c.constructor?.name === "UserMessageComponent" ||
              c.constructor?.name === "AssistantMessageComponent" ||
              c.constructor?.name === "ToolExecutionComponent")
      );
      treeCtx = { index: 0, total: renderable.length };
      treeCtxActive = renderable.length > 0;

      renderedComponents = [];
      const lines: string[] = [];
      let prevWasRenderable = false;
      for (const child of this.children) {
        if (!child) continue;
        const startLine = lines.length;
        const childLines = child.render(width);
        const endLine = startLine + childLines.length;

        if (prevWasRenderable) lines.push("");

        const offsetStart = prevWasRenderable ? startLine + 1 : startLine;
        const offsetEnd = offsetStart + childLines.length;

        if (child.constructor?.name === "UserMessageComponent" || child.constructor?.name === "AssistantMessageComponent") {
          renderedComponents.push({ component: child, startLine: offsetStart, endLine: offsetEnd });
        }

        if (renderable.includes(child)) {
          treeCtx.index++;
          prevWasRenderable = true;
        } else {
          prevWasRenderable = false;
        }

        for (const line of childLines) {
          lines.push(line);
        }
      }

      treeCtxActive = false;
      return lines;
    }

    return originalContainerRender.call(this, width);
  };
}

function patchTui(proto: any) {
  const originalTuiRender = proto.render;
  proto.render = function (this: any, width: number) {
    activeTuiInstance = this;

    let offset = 0;
    for (const child of this.children) {
      if (!child) continue;
      const isChat = child.children && child.children.some((c: any) =>
        c.constructor?.name === "UserMessageComponent" || c.children?.some((cc: any) => cc.constructor?.name === "UserMessageComponent")
      );
      if (isChat) {
        chatContainerStartLine = offset;
        break;
      }
      const childLines = child.render(width);
      offset += childLines.length;
    }

    const lines = originalTuiRender.call(this, width);
    const filtered = lines.filter((l: string) => {
      const plain = l.replace(/\x1b\[[0-9;]*m/g, "").trim();
      return plain !== "Dashboard active" && !plain.includes("Dashboard active");
    });

    if (showHelpOverlay) {
      overlayHelp(filtered, width);
    }

    return filtered;
  };

  const originalTuiStart = proto.start;
  proto.start = function (this: any) {
    activeTuiInstance = this;
    originalTuiStart.call(this);

    // Enable SGR mouse tracking explicitly
    process.stdout.write("\x1b[?1000h\x1b[?1006h");

    let originalEmit: typeof process.stdin.emit | null = null;

    if (!(process.stdin as any)._customPiPatched) {
      originalEmit = process.stdin.emit;
      (process.stdin as any)._originalEmit = originalEmit;
      (process.stdin as any)._customPiPatched = true;

      process.stdin.emit = function (this: any, event: string, data: any, ...args: any[]) {
        if (event === "data") {
          const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);

          if (showHelpOverlay) {
            showHelpOverlay = false;
            if (activeTuiInstance) activeTuiInstance.requestRender();
            return true;
          }

          if (raw === "\x12") {
            const lastAssistant = [...renderedComponents]
              .reverse()
              .find(rc => rc.component.constructor?.name === "AssistantMessageComponent");
            if (lastAssistant) {
              const assistant = lastAssistant.component;
              assistant.setHideThinkingBlock(!assistant.hideThinkingBlock);
              if (activeTuiInstance) activeTuiInstance.requestRender();
            }
            return true;
          }

          if (raw === "?") {
            const editor = activeTuiInstance?.children?.find((c: any) => c && c.constructor?.name === "CustomEditor");
            if (editor && (!editor.value || editor.value.trim() === "")) {
              showHelpOverlay = true;
              if (activeTuiInstance) activeTuiInstance.requestRender();
              return true;
            }
          }

          const mouseMatch = raw.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
          if (mouseMatch) {
            const button = parseInt(mouseMatch[1], 10);
            const col = parseInt(mouseMatch[2], 10);
            const row = parseInt(mouseMatch[3], 10);
            const isRelease = mouseMatch[4] === "m";
            if (!isRelease && button === 0 && col >= 0 && row >= 0) {
              handleTerminalMouseClick(col, row);
            }
            return true;
          }
        }
        const emit = (process.stdin as any)._originalEmit;
        if (emit) return emit.call(this, event, data, ...args);
        return EventEmitter.prototype.emit.call(this, event, data, ...args);
      };
    }
  };

  const originalTuiStop = proto.stop;
  proto.stop = function (this: any) {
    // Disable SGR mouse tracking explicitly
    process.stdout.write("\x1b[?1000l\x1b[?1006l");

    if ((process.stdin as any)._originalEmit) {
      process.stdin.emit = (process.stdin as any)._originalEmit;
      delete (process.stdin as any)._originalEmit;
      delete (process.stdin as any)._customPiPatched;
    }
    activeTuiInstance = null;
    originalTuiStop.call(this);
  };
}

export function applyLivePatches(tui: any, themeInstance: any) {
  // Prototype patching is now applied statically at startup via setImmediate.
  // This function is kept for compatibility.
}

setImmediate(() => {
  try {
    applyContainerPatch(Container.prototype);
    patchUserMessage(UserMessageComponent.prototype);
    patchAssistantMessage(AssistantMessageComponent.prototype);
    patchToolExecution(ToolExecutionComponent.prototype);
    patchCustomEditor(CustomEditor.prototype);
    patchFooterComponent(FooterComponent.prototype);
    patchDynamicBorder(DynamicBorder.prototype);
    patchTui(TUI.prototype);
  } catch (e: any) {
    logger.warn(`Failed to apply static TUI patches: ${e.message}`);
  }
});
