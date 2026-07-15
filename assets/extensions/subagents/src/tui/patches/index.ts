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
import { getGlobalFrame, getSpinner, STATUS_VERBS, getGlobalVerbIndex } from "../../animations";
import { getHostAdapter } from "../../host-adapter";
import { appMode } from "../../runtime/agent-state";
import * as piCodingAgentTyped from "@earendil-works/pi-coding-agent";
import * as piTuiTyped from "@earendil-works/pi-tui";

// Runtime references — typed as any to allow accessing runtime-only exports
const piAgent = piCodingAgentTyped as any;
const piTuiMod = piTuiTyped as any;

const UserMessageComponent = piAgent.UserMessageComponent;
const AssistantMessageComponent = piAgent.AssistantMessageComponent;
const ToolExecutionComponent = piAgent.ToolExecutionComponent;
const CustomEditor = piAgent.CustomEditor;
const FooterComponent = piAgent.FooterComponent;
const DynamicBorder = piAgent.DynamicBorder;

const Container = piTuiMod.Container;
const TUI = piTuiMod.TUI;
const sliceByColumn = piTuiMod.sliceByColumn;



let chatContainerStartLine = 0;
let renderedComponents: Array<{
  component: any;
  startLine: number;
  endLine: number;
  reasoningToggleLines: number[];
  renderedLines: string[];
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
      if ((val >= 40 && val <= 47) || (val >= 100 && val <= 107) || val === 49 || val === 109) {
        // Skip standard background colors and bg resets
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

  proto.render = function (this: any, width: number) {
    try {
      const rawText: string = this.text || "";
      if (!rawText.trim()) return [];

      const contentWidth = Math.max(20, width - 4);
      const mdLines = renderMarkdown(rawText.trim(), { width: contentWidth });
      if (mdLines.length === 0) return [];

      const lines: string[] = [];
      lines.push(OSC133_ZONE_START + fg(THEME.info, ">") + " " + (mdLines[0] || ""));
      for (let i = 1; i < mdLines.length; i++) {
        lines.push("  " + (mdLines[i] || ""));
      }
      lines[lines.length - 1] = lines[lines.length - 1] + OSC133_ZONE_END + OSC133_ZONE_FINAL;

      return truncateLines(lines, width);
    } catch (err: any) {
      logger.error(`[TUI] UserMessage rendering failed: ${err.message}`);
      return [];
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
      const contentWidth = Math.max(20, width - 4);
      let lines: string[] = [];
      this._thinkingToggleLineIndices = [];

      if (this.lastMessage && Array.isArray(this.lastMessage.content)) {
        for (const c of this.lastMessage.content) {
          if (c.type === "text" && c.text.trim()) {
            const textLines = renderMarkdown(c.text.trim(), { width: contentWidth - 2, streaming: !!this.isStreaming });
            if (lines.length > 0) lines.push("");
            lines.push(...textLines);
          } else if (c.type === "thinking" && c.thinking.trim()) {
            const isCollapsed = this.hideThinkingBlock !== false;
            if (lines.length > 0) lines.push("");

            this._thinkingToggleLineIndices.push(lines.length);
            if (isCollapsed) {
              lines.push(dim("\u25b6 Reasoning  (click to expand)"));
            } else {
              lines.push(dim("\u25bc Reasoning"));
              const thinkingLines = renderMarkdown(c.thinking.trim(), { width: contentWidth - 2, streaming: !!this.isStreaming });
              for (const line of thinkingLines) {
                lines.push(dim(line));
              }
            }
          }
        }
      } else {
        lines = originalRender.call(this, contentWidth);
      }

      if (lines.length === 0) return lines;

      const result: string[] = [];
      result.push("● " + (lines[0] || ""));
      for (let i = 1; i < lines.length; i++) {
        result.push("  " + lines[i]);
      }

      if (this.isStreaming) {
        const lastIdx = result.length - 1;
        if (lastIdx >= 0) {
          const spinner = getSpinner();
          result[lastIdx] = result[lastIdx] + " " + dim(spinner);
        }
      }

      return result;
    } catch (err: any) {
      logger.error(`[TUI] AssistantMessage rendering failed: ${err.message}`);
      return originalRender.call(this, width);
    }
  };
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  list_dir: "List",
  view_file: "Read",
  run_command: "Bash",
  write_to_file: "Write",
  replace_file_content: "Update",
  multi_replace_file_content: "Update",
  grep_search: "Search",
  search_web: "WebSearch",
  read_url_content: "Fetch",
  generate_image: "Image",
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Update",
  str_replace: "Update",
};

function toPascalCase(name: string): string {
  return name.split(/[_\s-]+/).map(w => w[0].toUpperCase() + w.slice(1)).join("");
}

function getDisplayToolName(rawName: string): string {
  return TOOL_DISPLAY_NAMES[rawName] ?? toPascalCase(rawName);
}

function formatArgInParens(toolName: string, args: any): string {
  const primary = getPrimaryArg(toolName, args);
  if (!primary) return "";
  const cleanPath = primary.replace(/^\/home\/[^/]+\/Desktop\/pi-custom-pack\//, "");
  const truncated = cleanPath.length > 60 ? "…" + cleanPath.slice(-57) : cleanPath;
  return dim(`(${truncated})`);
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

    const displayName = getDisplayToolName(this.toolName);
    const argsStr = formatArgInParens(this.toolName, this.args);

    let finalLines: string[] = [];

    if (isRunning) {
      const spinner = getSpinner();
      finalLines = [fg(THEME.info, spinner) + " " + fgBold(THEME.ink, displayName) + argsStr];
    } else if (isError) {
      const dot = fg(THEME.error, "\u25cf");
      const errorMsg = this.result?.details?.message || this.result?.details || "failed";
      const headerLine = `${dot} ${fgBold(THEME.ink, displayName)}${argsStr} ${dim(`(${durationSec}s)`)}`;
      const errorLine = `  ${fg(THEME.error, "\u2514")} ${fg(THEME.error, errorMsg)}`;
      
      const contentWidth = Math.max(10, width - 8);
      let rawLines = originalToolRender.call(this, contentWidth);
      rawLines = rawLines.map((l: string) => stripBackgroundColors(l));
      rawLines = rawLines.filter((l: string) => l.trim() !== "");
      const outputLines = rawLines.slice(0, 10).map((l: string) => `    ${fg(THEME.error, "\u2502")}  ${dim(l)}`);
      
      finalLines = [headerLine, errorLine, ...outputLines];
    } else {
      const dot = fg(THEME.success, "\u25cf");
      const headerLine = `${dot} ${fgBold(THEME.ink, displayName)}${argsStr} ${dim(`(${durationSec}s)`)}`;

      const contentWidth = Math.max(10, width - 8);
      let rawLines = originalToolRender.call(this, contentWidth);
      rawLines = rawLines.map((l: string) => stripBackgroundColors(l));
      rawLines = rawLines.filter((l: string) => l.trim() !== "");

      let firstLine = rawLines[0] || "";
      const cleanFirstLine = firstLine.replace(/^(Read|Updated|Listed)\s+.*?\s+with\s+/, "$1 ");
      const resultSummary = cleanFirstLine ? cleanFirstLine : "Completed";

      const resultLine = `  ${dim("\u2514")} ${resultSummary} ${dim("(ctrl+r to expand)")}`;

      const isEditTool = this.toolName === "edit" || this.toolName === "write" || this.toolName === "str_replace" || this.toolName === "file_edit" || this.toolName === "replace_file_content" || this.toolName === "multi_replace_file_content";
      
      if (isEditTool && rawLines.length > 0) {
        const diffLines = rawLines.filter((l: string) => {
          const plain = stripAnsi(l).trim();
          return plain.startsWith("+") || plain.startsWith("-") || /^\d+\s/.test(plain);
        });
        
        if (diffLines.length > 0) {
          const outputLines = diffLines.slice(0, 15).map((l: string) => {
            const plain = stripAnsi(l);
            if (plain.startsWith("+") && !plain.startsWith("+++")) {
              return `    ${fg(THEME.success, l)}`;
            } else if (plain.startsWith("-") && !plain.startsWith("---")) {
              return `    ${fg(THEME.error, l)}`;
            } else {
              return `    ${dim(l)}`;
            }
          });
          finalLines = [headerLine, resultLine, ...outputLines];
        } else {
          finalLines = [headerLine, resultLine];
        }
      } else {
        finalLines = [headerLine, resultLine];
      }
    }

    return truncateLines(finalLines, width);
  };
}

function patchCustomEditor(proto: any) {
  if (customEditorPatched) return;
  customEditorPatched = true;
  debugLog("PATCHING CUSTOM EDITOR PROTOTYPE");

  proto.render = function (this: any, width: number) {
    const boxWidth = Math.max(10, width - 2);
    // Fixed border overhead per content line:
    // ' '(1) + '│ '(2) + prefix(2) + ' │'(2) + ' '(1) = 8 chars
    // So contentWidth = width - 8
    const contentWidthForText = Math.max(10, width - 8);
    this.lastWidth = contentWidthForText;

    const layoutLines = this.layoutText(contentWidthForText);
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
    const dimFn = (s: string) => fg(THEME.muted, s);

    // Top border
    let topBorder = "";
    if (this.scrollOffset > 0) {
      const label = ` ↑ ${this.scrollOffset} more `;
      const lineLen = boxWidth - 2 - label.length;
      const leftBar = Math.max(0, Math.floor(lineLen / 2));
      const rightBar = Math.max(0, lineLen - leftBar);
      topBorder = " " + dimFn("┌" + "─".repeat(leftBar) + label + "─".repeat(rightBar) + "┐") + " ";
    } else {
      topBorder = " " + dimFn("┌" + "─".repeat(boxWidth - 2) + "┐") + " ";
    }
    result.push(topBorder);

    const emitCursorMarker = this.focused && !this.autocompleteState;
    const prefixStr = fg(THEME.info, ">") + " ";
    const indentStr = "  ";

    const segmenter = typeof this.segment === "function"
      ? this.segment.bind(this)
      : (s: string) => [...s].map(c => ({ segment: c }));

    const adapter2 = getHostAdapter();
    const CURSOR_MARKER = adapter2.cursorMarker();
    const vw = adapter2.visibleWidth;

    const isEmpty = this.isEditorEmpty();

    for (let i = 0; i < visibleLines.length; i++) {
      const layoutLine = visibleLines[i];
      let displayText = layoutLine.text;
      let lineVisibleWidth = vw(layoutLine.text);

      if (isEmpty) {
        const marker = emitCursorMarker ? CURSOR_MARKER : "";
        const cursor = emitCursorMarker ? "\x1b[7m \x1b[0m" : "";
        displayText = dim("Message Custom-PI\u2026") + marker + cursor;
        lineVisibleWidth = measureWidth("Message Custom-PI…") + (emitCursorMarker ? 1 : 0);
      } else if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {
        const before = displayText.slice(0, layoutLine.cursorPos);
        const after = displayText.slice(layoutLine.cursorPos);
        const marker = emitCursorMarker ? CURSOR_MARKER : "";
        if (after.length > 0) {
          const afterGraphemes = [...segmenter(after, "grapheme")];
          const firstGrapheme = afterGraphemes[0]?.segment || "";
          const restAfter = after.slice(firstGrapheme.length);
          const cursor = `\x1b[7m${firstGrapheme}\x1b[0m`; // inverse video — keep as-is, single char only
          displayText = before + marker + cursor + restAfter;
        } else {
          const cursor = "\x1b[7m \x1b[0m";
          displayText = before + marker + cursor;
          lineVisibleWidth = lineVisibleWidth + 1;
        }
      }

      const linePrefix = (i === 0 && this.scrollOffset === 0) ? prefixStr : indentStr;
      const padding = " ".repeat(Math.max(0, contentWidthForText - lineVisibleWidth));
      
      // Constructed line: " │ " + prefix + text + padding + " │ "
      result.push(" " + dimFn("│ ") + linePrefix + displayText + padding + dimFn(" │") + " ");
    }

    // Bottom border
    const linesBelow = layoutLines.length - (this.scrollOffset + visibleLines.length);
    let bottomBorder = "";
    if (linesBelow > 0) {
      const label = ` ↓ ${linesBelow} more `;
      const lineLen = boxWidth - 2 - label.length;
      const leftBar = Math.max(0, Math.floor(lineLen / 2));
      const rightBar = Math.max(0, lineLen - leftBar);
      bottomBorder = " " + dimFn("└" + "─".repeat(leftBar) + label + "─".repeat(rightBar) + "┘") + " ";
    } else {
      bottomBorder = " " + dimFn("└" + "─".repeat(boxWidth - 2) + "┘") + " ";
    }
    result.push(bottomBorder);

    if (this.autocompleteState && this.autocompleteList) {
      // autocomplete lines use indentStr (2 chars) not linePrefix, same overhead applies
      const autocompleteResult = this.autocompleteList.render(contentWidthForText);
      for (const line of autocompleteResult) {
        const lineWidth = vw(line);
        const linePadding = " ".repeat(Math.max(0, contentWidthForText - lineWidth));
        const autoLine = " " + dimFn("│ ") + indentStr + line + linePadding + dimFn(" │") + " ";
        result.push(truncateToWidth(autoLine, width));
      }
      result.push(bottomBorder); // Re-add bottom border under autocomplete
    }

    // Safety net: hard-truncate any line that still exceeds terminal width
    return truncateLines(result, width);
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

    const runningTool = activeTuiInstance?.children?.find((c: any) =>
      c && c.constructor?.name === "ToolExecutionComponent" && c.isPartial
    );
    const isAssistantRunning = activeTuiInstance?.children?.some((c: any) =>
      c && c.constructor?.name === "AssistantMessageComponent" && c.isStreaming
    );
    const isRunning = runningTool || isAssistantRunning;

    let left = "";
    if (isRunning) {
      const spinner = getSpinner();
      const verb = STATUS_VERBS[getGlobalVerbIndex() % STATUS_VERBS.length];
      const charsToShow = Math.min((getGlobalFrame() % 10) + 1, verb.length);
      const displayVerb = verb.slice(0, charsToShow) + (charsToShow < verb.length ? "…" : "");
      const action = runningTool ? `${getDisplayToolName(runningTool.toolName)}…` : displayVerb;
      let elapsedStr = "";
      if (runningTool && runningTool.startTime) {
        const secs = Math.floor((Date.now() - runningTool.startTime) / 1000);
        elapsedStr = `${secs}s · `;
      }
      left = `${fg(THEME.info, spinner)} ${fgBold(THEME.ink, action)} ${dim(`(${elapsedStr}↓ ${totalTokens.toLocaleString()} tok · esc to interrupt)`)}`;
    } else {
      const symbol = fg(THEME.success, "\u25cf");
      left = `${symbol} ${dim(`${modelName} · ${totalTokens.toLocaleString()} tok · $${totalCost.toFixed(3)}`)}`;
    }

    const right = dim("Tab to toggle  \u00b7  ? for help");

    const leftVisible = measureWidth(left);
    const rightVisible = measureWidth(right);
    const spaces = Math.max(1, width - leftVisible - rightVisible);

    const line = left + " ".repeat(spaces) + right;
    return truncateLines([line], width);
  };
}

function handleTerminalMouseClick(col: number, row: number) {
  const logFile = path.join(os.homedir(), ".pi", "agent", "mouse-debug.log");
  const log = (msg: string) => {
    try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, "utf8"); } catch {}
  };

  log(`CLICK AT col=${col}, row=${row}`);
  if (!activeTuiInstance) {
    log("No active TUI instance");
    return;
  }

  const lineIndex = row - 1;
  log(`lineIndex=${lineIndex}, chatContainerStartLine=${chatContainerStartLine}`);

  const clicked = renderedComponents.find(rc => {
    const absStart = chatContainerStartLine + rc.startLine;
    const absEnd = chatContainerStartLine + rc.endLine;
    return lineIndex >= absStart && lineIndex < absEnd;
  });

  if (!clicked) {
    log("No component matched click line");
    return;
  }

  log(`Matched component: ${clicked.component.constructor?.name}`);

  if (clicked.component.constructor?.name !== "AssistantMessageComponent") {
    log("Not an AssistantMessage — ignoring");
    return;
  }

  const relativeLine = lineIndex - chatContainerStartLine - clicked.startLine;
  if (!clicked.reasoningToggleLines.includes(relativeLine)) {
    log(`Clicked line ${relativeLine} is not a reasoning toggle line (toggles at ${JSON.stringify(clicked.reasoningToggleLines)})`);
    return;
  }

  const assistant = clicked.component;
  assistant.setHideThinkingBlock(!assistant.hideThinkingBlock);
  log(`Toggled AssistantMessage hideThinkingBlock to ${assistant.hideThinkingBlock}`);
  activeTuiInstance.requestRender();
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
      let prevWasMessageOrTool = false;
      let prevType: string | null = null;

      for (const child of this.children) {
        if (!child) continue;
        const childLines = child.render(width);
        if (childLines.length === 0) continue;

        const currentType = child.constructor?.name;
        const isMessageOrTool = currentType === "UserMessageComponent" ||
                               currentType === "AssistantMessageComponent" ||
                               currentType === "ToolExecutionComponent";

        if (prevWasMessageOrTool && isMessageOrTool) {
          // Do not put blank lines between consecutive ToolExecutionComponents
          if (prevType === "ToolExecutionComponent" && currentType === "ToolExecutionComponent") {
            // No blank line
          } else {
            lines.push("");
          }
        }

        const startLine = lines.length;
        const endLine = startLine + childLines.length;

        if (currentType === "UserMessageComponent" || currentType === "AssistantMessageComponent") {
          const reasoningToggleLines = (child._thinkingToggleLineIndices && Array.isArray(child._thinkingToggleLineIndices))
            ? [...child._thinkingToggleLineIndices]
            : [];
          renderedComponents.push({ component: child, startLine, endLine, reasoningToggleLines, renderedLines: childLines });
        }

        if (renderable.includes(child)) {
          treeCtx.index++;
        }

        prevWasMessageOrTool = isMessageOrTool;
        prevType = currentType;

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

    const lines = originalTuiRender.call(this, width);
    const cleaned = lines.map(stripBackgroundColors);
    const filtered = cleaned.map((l: string) => {
      const plain = l.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (plain === "Dashboard active" || plain.includes("Dashboard active")) return "";
      return l;
    });

    // Compute chatContainerStartLine by finding the first rendered component
    // in the filtered output. This avoids the stale-pass vs. filtered mismatch.
    chatContainerStartLine = 0;
    if (renderedComponents.length > 0) {
      const firstComp = renderedComponents[0];
      if (firstComp.renderedLines.length > 0) {
        const target = stripAnsi(firstComp.renderedLines[0]).trim();
        for (let i = 0; i < filtered.length; i++) {
          if (stripAnsi(filtered[i]).trim() === target) {
            chatContainerStartLine = i - firstComp.startLine;
            break;
          }
        }
      }
    }

    if (showHelpOverlay) {
      overlayHelp(filtered, width);
    }

    return filtered;
  };

  const originalTuiStart = proto.start;
  proto.start = function (this: any) {
    activeTuiInstance = this;
    originalTuiStart.call(this);
    // Re-enable mouse tracking after TUI init (may reset terminal modes)
    process.stdout.write("\x1b[?1000h\x1b[?1006h");
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

let mouseBuffer = "";

function processMouseChunk(raw: string) {
  const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const button = parseInt(m[1], 10);
    const col = parseInt(m[2], 10);
    const row = parseInt(m[3], 10);
    const isRelease = m[4] === "m";
    if (!isRelease && button === 0 && col >= 0 && row >= 0) {
      handleTerminalMouseClick(col, row);
    }
  }
}

function enableMouseTracking() {
  if ((process.stdin as any)._customPiPatched) return;

  process.stdout.write("\x1b[?1000h\x1b[?1006h");
  (process.stdin as any)._customPiPatched = true;

  const originalEmit = process.stdin.emit;
  (process.stdin as any)._originalEmit = originalEmit;

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

      // Process mouse events in the emit patch (catches every data event, no pause/resume gaps)
      // Use buffer to handle split SGR sequences across data chunks
      mouseBuffer = (mouseBuffer + raw).slice(-64);
      processMouseChunk(mouseBuffer);
    }
    const emit = (process.stdin as any)._originalEmit;
    if (emit) return emit.call(this, event, data, ...args);
    return EventEmitter.prototype.emit.call(this, event, data, ...args);
  };
}

export function applyLivePatches(tui: any, themeInstance: any) {
  // Prototype patching is now applied statically at startup via setImmediate.
  // This function is kept for compatibility.
}

setImmediate(() => {
  try {
    // Patch Theme.prototype.bg to disable all background colors
    // Use dynamic import() since pi-coding-agent is ESM-only (require() fails)
    import("@earendil-works/pi-coding-agent").then((piMod: any) => {
      try {
        // The theme singleton is at globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")]
        // We patch the Theme class's bg() method via the global theme instance
        const themeKey = Symbol.for("@earendil-works/pi-coding-agent:theme");
        const themeInstance = (globalThis as any)[themeKey];
        if (themeInstance && themeInstance.constructor) {
          themeInstance.constructor.prototype.bg = function(this: any, _color: string, text: string) {
            return text; // Return text without any background ANSI codes
          };
          logger.info("[TUI] Theme.bg patched successfully — all background colors disabled");
        }
      } catch (e: any) {
        logger.warn(`[TUI] Theme.bg patch failed: ${e.message}`);
      }
    }).catch((e: any) => {
      logger.warn(`[TUI] Dynamic import for theme patch failed: ${e.message}`);
    });

    applyContainerPatch(Container.prototype);
    patchUserMessage(UserMessageComponent.prototype);
    patchAssistantMessage(AssistantMessageComponent.prototype);
    patchToolExecution(ToolExecutionComponent.prototype);
    patchCustomEditor(CustomEditor.prototype);
    patchFooterComponent(FooterComponent.prototype);
    patchDynamicBorder(DynamicBorder.prototype);
    patchTui(TUI.prototype);

    // Enable mouse tracking NOW (TUI.prototype.start may have already been called)
    enableMouseTracking();

    logger.info("[TUI] All prototype patches applied successfully");
  } catch (e: any) {
    logger.warn(`Failed to apply static TUI patches: ${e.message}`);
  }
});
