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
import { getGlobalFrame, getDotPulse, getPulseColor, getSpinner, activeTrackers, globalPulse, startGlobalAnimation, stopGlobalAnimation } from "../../animations";
import { QuantumHUDWidget } from "../components/quantum-hud";
import { getHostAdapter } from "../../host-adapter";

let chatContainerStartLine = 0;
let renderedComponents: Array<{
  component: any;
  startLine: number;
  endLine: number;
}> = [];
let activeTuiInstance: any = null;

let livePatchesApplied = false;
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

function patchUserMessage(proto: any) {
  if (userMessagePatched) return;
  userMessagePatched = true;
  debugLog("PATCHING USER MESSAGE PROTOTYPE");

  proto.render = function (this: any, width: number) {
    const markdownComponent = this.contentBox && this.contentBox.children && this.contentBox.children[0];
    if (!markdownComponent) return [];

    const contentWidth = Math.max(20, width - 8);
    const rawText = markdownComponent.content || markdownComponent.text || "";
    const mdLines = rawText
      ? renderMarkdown(rawText, { width: contentWidth })
      : markdownComponent.render(contentWidth);

    const pointerColor = (s: string) => fg(THEME.accent, s);
    const dimFn = (s: string) => fg(THEME.muted, s);

    const lines: string[] = [];
    const pointer = ICONS.userTurn + " ";
    if (mdLines.length > 0) {
      lines.push(pointerColor(pointer) + dimFn("You") + "  " + (mdLines[0] || ""));
    }
    for (let i = 1; i < mdLines.length; i++) {
      lines.push("  " + (mdLines[i] || ""));
    }
    lines[0] = OSC133_ZONE_START + lines[0];
    lines[lines.length - 1] = lines[lines.length - 1] + OSC133_ZONE_END + OSC133_ZONE_FINAL;

    return truncateLines(lines, width);
  };
}

function patchToolExecution(proto: any) {
  if (toolExecutionPatched) return;
  toolExecutionPatched = true;
  debugLog("PATCHING TOOL EXECUTION PROTOTYPE");

  const originalToolRender = proto.render;
  proto.render = function (this: any, width: number) {
    if (this.hideComponent) return [];

    const contentWidth = Math.max(10, width - 8);
    let rawLines = originalToolRender.call(this, contentWidth);
    rawLines = rawLines.map((l: string) => l.replace(/\x1b\[[0-9;]*48(?:;[0-9;]*)*m/g, ''));
    let prevBlank = false;
    rawLines = rawLines.filter((l: string) => {
      const isBlank = l.trim() === "";
      if (isBlank && prevBlank) return false;
      prevBlank = isBlank;
      return true;
    });
    while (rawLines.length > 0 && rawLines[0].trim() === "") rawLines.shift();
    while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === "") rawLines.pop();

    const isRunning = this.isPartial;
    const isError = this.result?.isError;

    let dotColor: string;
    let dotChar: string;
    if (isRunning) {
      const frame = getGlobalFrame();
      const hue = (frame * 3) % 360;
      dotColor = fg(THEME.accent, "");
      dotChar = "\u25cf";
    } else if (isError) {
      dotColor = fg(THEME.error, "");
      dotChar = "\u25cf";
    } else {
      dotColor = fg(THEME.success, "");
      dotChar = "\u25cf";
    }
    const statusDot = `${dotColor}${dotChar}\x1b[0m`;
    const toolNameColor = (s: string) => fg(THEME.warning, s);

    let paramSummary = "";
    if (this.args && typeof this.args === "object") {
      const params: string[] = [];
      for (const [key, val] of Object.entries(this.args)) {
        const v = typeof val === "string" ? val.slice(0, 60) : JSON.stringify(val);
        params.push(`${key}: ${v}`);
      }
      if (params.length > 0) paramSummary = "(" + params.join(", ") + ")";
    }

    const headerLine = `${statusDot} ${toolNameColor(this.toolName)}${paramSummary ? " " + paramSummary : ""}`;

    const isEditTool = this.toolName === "edit" || this.toolName === "write" || this.toolName === "str_replace" || this.toolName === "file_edit";
    const hasDiff = rawLines.some((l: string) => /^[+-]{1,3}/.test(l.trim()));

    const indent = "  ";
    let contentLines: string[];
    const contentRaw = rawLines.length > 1 ? rawLines.slice(1) : [];

    if ((isEditTool || hasDiff) && !isRunning) {
      const [canvasR, canvasG, canvasB] = hexToRgb(THEME.canvas);
      const [successR, successG, successB] = hexToRgb(THEME.success);
      const [errorR, errorG, errorB] = hexToRgb(THEME.error);
      const diffAdded = (s: string) => {
        const mr = Math.round(canvasR + (successR - canvasR) * 0.3);
        const mg = Math.round(canvasG + (successG - canvasG) * 0.3);
        const mb = Math.round(canvasB + (successB - canvasB) * 0.3);
        return `\x1b[48;2;${mr};${mg};${mb}m\x1b[38;2;${successR};${successG};${successB}m ${s} \x1b[0m`;
      };
      const diffRemoved = (s: string) => {
        const mr = Math.round(canvasR + (errorR - canvasR) * 0.3);
        const mg = Math.round(canvasG + (errorG - canvasG) * 0.3);
        const mb = Math.round(canvasB + (errorB - canvasB) * 0.3);
        return `\x1b[48;2;${mr};${mg};${mb}m\x1b[38;2;${errorR};${errorG};${errorB}m ${s} \x1b[0m`;
      };
      const dimFn2 = (s: string) => fg(THEME.muted, s);
      const bgNeutral = (s: string) => fg(THEME.textSecondary, ` ${s} `);
      contentLines = [];
      const isWriteTool = this.toolName === "write";
      let diffBlockOpen = false;
      for (const line of contentRaw) {
        const clean = line.trimEnd();
        const trimmed = clean.trim();
        if (isWriteTool) {
          contentLines.push(indent + diffAdded(clean));
        } else if (trimmed.startsWith("+++") || trimmed.startsWith("---") || trimmed.startsWith("@@")) {
          contentLines.push(indent + dimFn2(clean));
        } else if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) {
          if (!diffBlockOpen) {
            const sepLen = Math.max(3, Math.floor((width - 10) / 2));
            contentLines.push(indent + dimFn2("\u2501").repeat(sepLen) + " diff " + dimFn2("\u2501").repeat(sepLen));
            diffBlockOpen = true;
          }
          contentLines.push(indent + diffAdded(clean));
        } else if (trimmed.startsWith("-") && !trimmed.startsWith("---")) {
          if (!diffBlockOpen) {
            const sepLen = Math.max(3, Math.floor((width - 10) / 2));
            contentLines.push(indent + dimFn2("\u2501").repeat(sepLen) + " diff " + dimFn2("\u2501").repeat(sepLen));
            diffBlockOpen = true;
          }
          contentLines.push(indent + diffRemoved(clean));
        } else {
          contentLines.push(indent + bgNeutral(clean));
        }
      }
    } else {
      const bgNeutral = (s: string) => bgFg(THEME.canvas, "#b4b9c3", ` ${s} `);
      contentLines = contentRaw.map((line: string) => indent + bgNeutral(line.trimEnd()));
    }

    const allLines = [headerLine, ...contentLines];
    const adapter = getHostAdapter();
    return allLines.map((l: string) => {
      const vw = adapter.visibleWidth(l);
      if (vw > width) return truncateToWidth(l, width);
      return l;
    });
  };
}

function patchAssistantMessage(proto: any) {
  if (assistantMessagePatched) return;
  assistantMessagePatched = true;
  debugLog("PATCHING ASSISTANT MESSAGE PROTOTYPE");

  const originalRender = proto.render;
  proto.render = function (this: any, width: number) {
    const contentWidth = Math.max(20, width - 8);
    const rawText = this.content || this.text || "";

    let lines: string[];
    if (rawText) {
      lines = renderMarkdown(rawText, { width: contentWidth, streaming: !!this.isStreaming });
    } else {
      lines = originalRender.call(this, contentWidth);
    }

    if (lines.length === 0) return lines;

    const accentColor = (s: string) => fg(THEME.accent, s);
    const dimFn = (s: string) => fg(THEME.muted, s);

    const assistantLabel = ICONS.assistantLabel;
    const prefix = ICONS.assistantTurn + " ";

    const result: string[] = [];
    result.push(accentColor(truncateToWidth(prefix + assistantLabel, width - 4)));
    for (const line of lines) {
      result.push(line);
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
    const pointerColor = (s: string) => fg(THEME.accent, s);
    const prefixStr = pointerColor("\u276f ");
    const indentStr = "  ";

    const segmenter = typeof this.segment === "function"
      ? this.segment.bind(this)
      : (s: string) => [...s].map(c => ({ segment: c }));

    const adapter2 = getHostAdapter();
    const CURSOR_MARKER = adapter2.cursorMarker();
    const vw = adapter2.visibleWidth;

    for (let i = 0; i < visibleLines.length; i++) {
      const layoutLine = visibleLines[i];
      let displayText = layoutLine.text;
      let lineVisibleWidth = vw(layoutLine.text);
      let cursorInPadding = false;

      if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {
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

function patchFooterComponent(child: any) {
  if (footerComponentPatched) return;
  if (!child.footerData) return;
  footerComponentPatched = true;
  debugLog("PATCHING FOOTER COMPONENT PROVIDER");

  if (child.footerData.extensionStatuses instanceof Map) {
    for (const [key, val] of child.footerData.extensionStatuses.entries()) {
      if (val === "Dashboard active" || (typeof val === "string" && val.includes("Dashboard active"))) {
        child.footerData.extensionStatuses.delete(key);
      }
    }
  }

  const footerDataProto = Object.getPrototypeOf(child.footerData);
  const originalSetExtensionStatus = footerDataProto.setExtensionStatus;
  footerDataProto.setExtensionStatus = function (this: any, key: string, text: string) {
    if (text === "Dashboard active" || (text && text.includes("Dashboard active"))) {
      return originalSetExtensionStatus.call(this, key, "");
    }
    return originalSetExtensionStatus.call(this, key, text);
  };

  const proto = Object.getPrototypeOf(child);
  if (proto && typeof proto.render === "function") {
    const originalFooterRender = proto.render;
    proto.render = function (this: any, width: number) {
      const lines = originalFooterRender.call(this, width);
      return lines.filter((l: string) => {
        const plain = l.replace(/\x1b\[[0-9;]*m/g, "").trim();
        return plain !== "Dashboard active" && !plain.includes("Dashboard active");
      });
    };
  }
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

export function applyLivePatches(tui: any, themeInstance: any) {
  if (livePatchesApplied) return;
  livePatchesApplied = true;
  debugLog("APPLYING LIVE ESM PATCHES");

  const TuiPrototype = Object.getPrototypeOf(tui);
  const ContainerPrototype = Object.getPrototypeOf(TuiPrototype);

  const originalTuiRender = TuiPrototype.render;
  TuiPrototype.render = function (this: any, width: number) {
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
    return lines.filter((l: string) => {
      const plain = l.replace(/\x1b\[[0-9;]*m/g, "").trim();
      return plain !== "Dashboard active" && !plain.includes("Dashboard active");
    });
  };

  const originalTuiStart = TuiPrototype.start;
  TuiPrototype.start = function (this: any) {
    activeTuiInstance = this;
    originalTuiStart.call(this);

    let originalEmit: typeof process.stdin.emit | null = null;

    if (!(process.stdin as any)._customPiPatched) {
      originalEmit = process.stdin.emit;
      (process.stdin as any)._originalEmit = originalEmit;
      (process.stdin as any)._customPiPatched = true;

      process.stdin.emit = function (this: any, event: string, data: any, ...args: any[]) {
        if (event === "data") {
          const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
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

  const originalTuiStop = TuiPrototype.stop;
  TuiPrototype.stop = function (this: any) {
    if ((process.stdin as any)._originalEmit) {
      process.stdin.emit = (process.stdin as any)._originalEmit;
      delete (process.stdin as any)._originalEmit;
      delete (process.stdin as any)._customPiPatched;
    }
    activeTuiInstance = null;
    originalTuiStop.call(this);
  };

  const originalContainerRender = ContainerPrototype.render;
  ContainerPrototype.render = function (this: any, width: number) {
    if (this.children) {
      for (const child of this.children) {
        if (!child) continue;
        const className = child.constructor?.name;
        if (className === "UserMessageComponent") {
          patchUserMessage(Object.getPrototypeOf(child));
        } else if (className === "AssistantMessageComponent") {
          patchAssistantMessage(Object.getPrototypeOf(child));
        } else if (className === "ToolExecutionComponent") {
          patchToolExecution(Object.getPrototypeOf(child));
        } else if (className === "CustomEditor") {
          patchCustomEditor(Object.getPrototypeOf(child));
        } else if (className === "DynamicBorder") {
          patchDynamicBorder(Object.getPrototypeOf(child));
        } else if (className === "FooterComponent") {
          patchFooterComponent(child);
        }
      }
    }

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
