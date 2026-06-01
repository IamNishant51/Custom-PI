import { TerminalScreen } from "./screen";
import { StylePool } from "./style-pool";
import { AnsiWriter } from "./ansi-writer";
import {
  THEME, BOX, SPACING, hexToAnsi, getResponsiveBreakpoint,
  type ThemeColors, type PulseConfig, type ResponsiveBreakpoint,
  type ConversationHeader, type ScrollIndicator, type SurfaceLevel,
} from "./types";
import { stripAnsi, measureWidth, wordWrap } from "./utils/measure-text";
import { PulseController, hexToRgb, rgbToHex } from "./app/pulse-controller";

const GUTTER = SPACING.gutter;
const GUTTER_LG = SPACING.gutterLg;
const PAD = SPACING.padding;
const PAD_SM = SPACING.paddingSm;

export class ScreenRenderer {
  screen: TerminalScreen;
  pool: StylePool;
  writer: AnsiWriter;
  theme: ThemeColors;
  pulse: PulseController;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private frameCallbacks: Array<() => void> = [];
  private running = false;
  private useTruecolor: boolean;

  breakpoint: ResponsiveBreakpoint = "normal";
  contentLeft: number = GUTTER;
  contentWidth: number = 80;

  styleCache = new Map<string, number>();

  constructor() {
    this.pool = new StylePool(true);
    this.screen = new TerminalScreen(this.pool);
    this.writer = new AnsiWriter();
    this.theme = { ...THEME };
    this.pulse = new PulseController();
    this.useTruecolor = this.detectTruecolor();
    this.pool.setTruecolor(this.useTruecolor);
    this.pool.clear();
  }

  private detectTruecolor(): boolean {
    const term = process.env.COLORTERM || "";
    if (term === "truecolor" || term === "24bit") return true;
    const colorterm = process.env.TERM || "";
    if (colorterm.includes("truecolor") || colorterm.includes("24-bit")) return true;
    return false;
  }

  /** Recompute content area dimensions based on terminal width */
  updateLayout(): void {
    const cols = this.screen.getCols();
    this.breakpoint = getResponsiveBreakpoint(cols);
    const maxContent = Math.min(cols - GUTTER_LG * 2, 120);
    this.contentLeft = Math.floor((cols - maxContent) / 2);
    this.contentWidth = maxContent;
  }

  /** Get the usable content width inside a bordered container */
  innerWidth(outerW?: number): number {
    return (outerW ?? this.contentWidth) - PAD * 2;
  }

  ansi(hex: string): number {
    const cached = this.styleCache.get(hex);
    if (cached !== undefined) return cached;
    const id = this.pool.fromHex(hex);
    this.styleCache.set(hex, id);
    return id;
  }

  style(def: { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean }): number {
    const key = JSON.stringify(def);
    const cached = this.styleCache.get(key);
    if (cached !== undefined) return cached;
    const id = this.pool.getOrCreate({
      fg: def.fg ? hexToAnsi(def.fg) : undefined,
      bg: def.bg ? hexToAnsi(def.bg) : undefined,
      bold: def.bold,
      dim: def.dim,
      italic: def.italic,
    });
    this.styleCache.set(key, id);
    return id;
  }

  truecolorStyle(fg: string, bg?: string, opts?: { bold?: boolean; dim?: boolean }): number {
    const key = `tc:${fg}:${bg ?? ""}:${opts?.bold ?? false}:${opts?.dim ?? false}`;
    const cached = this.styleCache.get(key);
    if (cached !== undefined) return cached;
    const id = this.pool.getTruecolorStyle(fg, bg, opts);
    this.styleCache.set(key, id);
    return id;
  }

  surfaceStyle(level: SurfaceLevel): number {
    const color = this.theme[level === "canvas" ? "canvas" :
      level === "surface" ? "surface" :
      level === "elevated" ? "surfaceElevated" :
      level === "overlay" ? "surfaceOverlay" : "card"];
    return this.style({ bg: color });
  }

  start(altScreen = true): void {
    this.running = true;
    const out: string[] = [];
    out.push("\x1b[?25l");
    out.push("\x1b[?2004h");
    if (altScreen) out.push("\x1b[?1049h");
    out.push("\x1b[?2026h");
    process.stdout.write(out.join(""));
    process.stdout.on("resize", () => this.handleResize());
  }

  stop(): void {
    this.running = false;
    if (this.frameTimer) {
      clearTimeout(this.frameTimer);
      this.frameTimer = null;
    }
    const out: string[] = [];
    out.push("\x1b[?2026l");
    out.push("\x1b[?2004l");
    out.push("\x1b[?1049l");
    out.push("\x1b[?25h");
    process.stdout.write(out.join(""));
  }

  private handleResize(): void {
    const { columns, rows } = process.stdout as any;
    if (columns && rows) {
      this.screen.resize(columns, rows);
      this.updateLayout();
    }
  }

  render(): void {
    const output = this.screen.flush();
    if (output) {
      process.stdout.write(output);
    }
    this.writer.flush();
  }

  requestFrame(callback: () => void): void {
    this.frameCallbacks.push(callback);
    if (!this.frameTimer) {
      this.frameTimer = setTimeout(() => this.tick(), 16);
    }
  }

  private tick(): void {
    this.frameTimer = null;
    const cbs = this.frameCallbacks;
    this.frameCallbacks = [];
    for (const cb of cbs) cb();
    this.render();
    if (this.frameCallbacks.length > 0 && !this.frameTimer) {
      this.frameTimer = setTimeout(() => this.tick(), 16);
    }
  }

  // ── New Layout Methods ──────────────────────────────────────────────────

  drawConversationHeader(y: number, opts: ConversationHeader): number {
    const cols = this.screen.getCols();
    if (y >= this.screen.getRows()) return y;

    const bgStyle = this.surfaceStyle("surface");
    const accentStyle = this.style({ fg: this.theme.accent, bold: true });
    const mutedStyle = this.style({ fg: this.theme.muted });
    const dimStyle = this.style({ fg: this.theme.dim });

    this.screen.clearLine(y, bgStyle);

    // Left: model name + session
    const modelTag = ` ${opts.modelName} `;
    this.screen.writeString(GUTTER, y, modelTag, accentStyle);

    // Center separator
    const sepX = GUTTER + measureWidth(stripAnsi(modelTag)) + 1;
    this.screen.writeString(sepX, y, "\u2502", dimStyle);

    // Session info
    const sessionText = ` ${opts.sessionId.slice(0, 12)} `;
    const sessX = sepX + 2;
    this.screen.writeString(sessX, y, sessionText, mutedStyle);

    // Context percentage bar
    const barW = 16;
    const barX = cols - barW - GUTTER - 10;
    const filled = Math.round((opts.contextPercent / 100) * barW);
    const ctxColor = opts.contextPercent > 80 ? this.theme.warning :
      opts.contextPercent > 50 ? this.theme.accent : this.theme.success;
    const ctxStyle = this.style({ fg: ctxColor });
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(barW - filled);
    this.screen.writeString(barX, y, `ctx ${bar}`, ctxStyle);

    // Message count
    const msgText = ` ${opts.messageCount} msgs `;
    this.screen.writeString(cols - GUTTER - measureWidth(stripAnsi(msgText)), y, msgText, mutedStyle);

    return y + 1;
  }

  drawScrollIndicator(y: number, opts: ScrollIndicator): number {
    const cols = this.screen.getCols();
    if (y >= this.screen.getRows()) return y;

    const bgStyle = this.surfaceStyle("canvas");
    const muteStyle = this.style({ fg: this.theme.muted, dim: true });

    this.screen.clearLine(y, bgStyle);

    if (opts.olderCount > 0) {
      const text = ` \u2191 ${opts.olderCount} older messages \u2191 `;
      const x = Math.floor((cols - measureWidth(stripAnsi(text))) / 2);
      this.screen.writeString(x, y, text, muteStyle);
    }

    return y + 1;
  }

  drawBanner(startY: number): number {
    const banner = [
      "  ██████╗ ██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ███╗      ██████╗ ██╗",
      " ██╔════╝ ██║   ██║██╔════╝ ╚══██╔══╝██╔═══██╗████╗ ████║      ██╔══██╗██║",
      " ██║      ██║   ██║╚██████╗    ██║   ██║   ██║██╔████╔██║█████╗██████╔╝██║",
      " ██║      ██║   ██║ ╚═══██║    ██║   ██║   ██║██║╚██╔╝██║╚════╝██╔═══╝ ██║",
      " ╚██████╗ ╚██████╔╝██████╔╝    ██║   ╚██████╔╝██║ ╚═╝ ██║      ██║     ██║",
      "  ╚═════╝  ╚═════╝ ╚═════╝     ╚═╝    ╚═════╝ ╚═╝     ╚═╝      ╚═╝     ╚═╝",
    ];
    const cols = this.screen.getCols();
    const colors = this.theme.banner;
    const canvasStyle = this.style({ bg: this.theme.canvas });

    // Show full banner on wide, compact on narrow
    const showFull = cols >= 80;
    const displayBanner = showFull ? banner : banner.map(l => l.slice(0, Math.floor(cols * 0.6)));

    for (let i = 0; i < displayBanner.length; i++) {
      const line = displayBanner[i];
      const color = colors[i] || colors[colors.length - 1];
      const s = this.style({ fg: color });
      const y = startY + i;
      this.screen.clearLine(y, canvasStyle);
      const x = showFull ? this.contentLeft : GUTTER;
      this.screen.writeString(x, y, line, s);
    }
    return startY + displayBanner.length + SPACING.paddingSm;
  }

  drawBox(y: number, width: number, title: string, content: string[], borderColor: string, accentColor?: string): number {
    const cx = this.contentLeft;
    const bStyle = this.style({ fg: borderColor });
    const aStyle = accentColor ? this.style({ fg: accentColor }) : bStyle;
    const canvasStyle = this.style({ bg: this.theme.canvas });
    const cols = this.screen.getCols();
    const w = Math.min(width, cols - cx - GUTTER);

    const titleText = ` ${title} `;
    const titleLen = stripAnsi(titleText).length;
    const lineLen = Math.max(0, w - 2 - titleLen - 1);

    if (y >= this.screen.getRows()) return y;

    // Top border
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(cx, y, BOX.tl + BOX.h.repeat(Math.floor(lineLen / 2)), bStyle);
    this.screen.writeString(cx + Math.floor(lineLen / 2), y, titleText, aStyle);
    this.screen.writeString(cx + Math.floor(lineLen / 2) + titleLen, y, BOX.h.repeat(Math.ceil(lineLen / 2)) + BOX.tr, bStyle);

    let cy = y + 1;
    for (const line of content) {
      if (cy >= this.screen.getRows() - GUTTER) break;
      this.screen.clearLine(cy, canvasStyle);
      const clean = stripAnsi(line);
      const visibleW = measureWidth(clean);
      const pad = Math.max(0, w - 4 - visibleW);
      this.screen.writeString(cx + PAD_SM, cy, " " + line + " ".repeat(pad) + " ", bStyle);
      cy++;
    }

    // Bottom border
    if (cy < this.screen.getRows() - GUTTER) {
      this.screen.clearLine(cy, canvasStyle);
      this.screen.writeString(cx, cy, BOX.bl + BOX.h.repeat(w - 2) + BOX.br, bStyle);
      cy++;
    }

    return cy;
  }

  drawDivider(y: number, width: number, color: string): number {
    const cx = this.contentLeft;
    const s = this.style({ fg: color });
    const canvasStyle = this.style({ bg: this.theme.canvas });
    if (y >= this.screen.getRows()) return y;
    this.screen.clearLine(y, canvasStyle);
    const w = Math.min(width, this.contentWidth);
    this.screen.writeString(cx, y, "\u2502" + BOX.h.repeat(Math.max(0, w - 2)) + "\u2502", s);
    return y + 1;
  }

  drawMessageBubble(y: number, width: number, role: string, content: string, timestamp: string, opts?: {
    toolCalls?: number;
    duration?: string;
    agentName?: string;
    isStreaming?: boolean;
  }): number {
    const cols = this.screen.getCols();
    const cx = this.contentLeft;
    const cw = this.contentWidth;
    const isUser = role === "user";
    const borderColor = isUser ? this.theme.userBubbleBorder : this.theme.assistantBubbleBorder;
    const bStyle = this.style({ fg: borderColor });
    const headerStyle = this.style({ fg: this.theme.muted, dim: true });
    const canvasStyle = this.style({ bg: this.theme.canvas });
    const contentStyle = this.style({ fg: this.theme.ink });

    // Agent badge: ◆ for user, ▣ for assistant
    const agentIcon = isUser ? "\u25c6" : "\u25a3";
    const name = isUser ? "You" : (opts?.agentName || "Assistant");
    const metaParts: string[] = [];
    if (opts?.toolCalls !== undefined) metaParts.push(`tools: ${opts.toolCalls}`);
    if (opts?.duration) metaParts.push(opts.duration);
    if (opts?.isStreaming) metaParts.push("\u25cc streaming");
    const meta = metaParts.length > 0 ? `  \u00b7  ${metaParts.join("  \u00b7  ")}` : "";
    const headerText = `${agentIcon} ${name}${meta}  ${timestamp}`;
    const headerW = measureWidth(headerText);

    const maxContentW = Math.min(cw - PAD * 2, SPACING.maxBubbleWidth);
    const lines = wordWrap(content, maxContentW - PAD);
    let maxLineW = 0;
    for (const line of lines) {
      const lineW = measureWidth(stripAnsi(line.trimEnd()));
      if (lineW > maxLineW) maxLineW = lineW;
    }

    const bubbleW = Math.min(maxContentW, Math.max(headerW + PAD, maxLineW + PAD));
    const startX = isUser ? cx + cw - bubbleW - PAD_SM : cx + PAD_SM;

    if (y >= this.screen.getRows() - GUTTER) return y;

    // Top border
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(startX, y, "\u256d" + BOX.h.repeat(bubbleW - 2) + "\u256e", bStyle);
    y++;

    // Header line
    if (y >= this.screen.getRows() - GUTTER) return y;
    this.screen.clearLine(y, canvasStyle);
    const trimmedHeader = headerText.length > bubbleW - PAD ? headerText.slice(0, bubbleW - PAD - 2) + "\u2026" : headerText;
    this.screen.writeString(startX + PAD_SM, y, trimmedHeader, headerStyle);
    // Side borders
    this.screen.writeString(startX, y, "\u2502", bStyle);
    this.screen.writeString(startX + bubbleW - 1, y, "\u2502", bStyle);
    y++;

    // Content
    for (const line of lines) {
      if (y >= this.screen.getRows() - GUTTER) break;
      this.screen.clearLine(y, canvasStyle);
      const clean = line.trimEnd();
      const visibleLen = measureWidth(stripAnsi(clean));
      const pad = Math.max(0, bubbleW - PAD - visibleLen);
      this.screen.writeString(startX + PAD_SM, y, clean + " ".repeat(pad), contentStyle);
      this.screen.writeString(startX, y, "\u2502", bStyle);
      this.screen.writeString(startX + bubbleW - 1, y, "\u2502", bStyle);
      y++;
    }

    // Bottom border
    if (y < this.screen.getRows() - GUTTER) {
      this.screen.clearLine(y, canvasStyle);
      this.screen.writeString(startX, y, "\u2570" + BOX.h.repeat(bubbleW - 2) + "\u256f", bStyle);
      y++;
    }

    return y + 1;
  }

  drawThinkingBlock(y: number, width: number, content: string, isCollapsed: boolean, timestamp: string): number {
    const cx = this.contentLeft;
    const cw = this.contentWidth;
    const gutterX = cx + PAD_SM;

    const canvasStyle = this.style({ bg: this.theme.canvas });
    const headerStyle = this.style({ fg: this.theme.muted, dim: true });
    const accentStyle = this.style({ fg: this.theme.accent, dim: true });
    const contentStyle = this.style({ fg: this.theme.muted, italic: true });

    if (y >= this.screen.getRows() - GUTTER) return y;

    // Accent strip (left border)
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(gutterX, y, "\u2502", accentStyle);
    const chevron = isCollapsed ? "\u25b8" : "\u25be";
    const headerText = `${chevron} Reasoning  ${timestamp}`;
    this.screen.writeString(gutterX + PAD_SM, y, headerText, headerStyle);

    // Right-side expand hint
    const hint = isCollapsed ? "click to expand" : "click to collapse";
    const hintW = measureWidth(hint);
    const hintStyle = this.style({ fg: this.theme.dim, dim: true });
    this.screen.writeString(cx + cw - hintW - GUTTER, y, hint, hintStyle);

    y++;

    if (!isCollapsed && content) {
      const innerW = cw - GUTTER_LG;
      const lines = wordWrap(content, innerW);
      for (const line of lines) {
        if (y >= this.screen.getRows() - GUTTER) break;
        this.screen.clearLine(y, canvasStyle);
        this.screen.writeString(gutterX, y, "\u2502", accentStyle);
        this.screen.writeString(gutterX + PAD_SM, y, line, contentStyle);
        y++;
      }
    }
    return y;
  }

  drawInputArea(y: number, width: number, text: string, cursorPos: number, vimMode?: string): number {
    const cols = this.screen.getCols();
    const cx = this.contentLeft;
    const cw = this.contentWidth;
    const w = Math.min(cw, cols - cx - GUTTER);

    const borderStyle = this.style({ fg: this.theme.hairline });
    const inputStyle = this.style({ fg: this.theme.ink });
    const cursorStyle = this.style({ fg: this.theme.ink, bg: this.theme.accent });
    const canvasStyle = this.style({ bg: this.theme.canvas });
    const surfaceStyle = this.style({ bg: this.theme.surface });
    const modeStyle = this.style({ fg: this.theme.muted, dim: true });
    const accentStyle = this.style({ fg: this.theme.accent });

    if (y >= this.screen.getRows() - SPACING.inputAreaLines) return y;

    const inputW = w - PAD;

    // Top border
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(cx, y, "\u256d" + BOX.h.repeat(inputW) + "\u256e", borderStyle);
    y++;

    if (y >= this.screen.getRows() - SPACING.inputAreaLines) return y;

    // Input line with background
    this.screen.clearLine(y, surfaceStyle);
    this.screen.writeString(cx, y, "\u2502", borderStyle);

    const displayText = text.length > inputW - 2 ? text.slice(text.length - inputW + 4) : text;
    const visibleCursor = Math.min(cursorPos, displayText.length);
    const writeStartX = cx + PAD_SM;

    // Draw text
    for (let i = 0; i < inputW - 2 && i < displayText.length; i++) {
      const ch = displayText[i];
      if (i === visibleCursor && vimMode === "insert") {
        this.screen.writeString(writeStartX + i, y, ch, cursorStyle);
      } else {
        this.screen.writeString(writeStartX + i, y, ch, inputStyle);
      }
    }

    // Cursor at end
    if (visibleCursor >= displayText.length) {
      if (vimMode === "insert") {
        this.screen.writeString(writeStartX + displayText.length, y, " ", cursorStyle);
      } else {
        this.screen.writeString(writeStartX + displayText.length, y, "\u258c", inputStyle);
      }
    }

    this.screen.writeString(cx + cw - PAD_SM, y, "\u2502", borderStyle);
    y++;

    // Bottom border
    if (y < this.screen.getRows() - 1) {
      this.screen.clearLine(y, surfaceStyle);
      this.screen.writeString(cx, y, "\u2570" + BOX.h.repeat(inputW) + "\u256f", borderStyle);
      y++;
    }

    // Mode bar below input
    if (y < this.screen.getRows()) {
      this.screen.clearLine(y, surfaceStyle);
      if (vimMode) {
        const modeText = vimMode.toUpperCase();
        this.screen.writeString(cx + PAD_SM, y, `\u25c6 ${modeText}`, vimMode === "insert" ? accentStyle : modeStyle);
        this.screen.writeString(cx + PAD_SM + 8, y, "\u2502", this.style({ fg: this.theme.dim }));
      }
      // Right hint
      const hint = "\u2302 Ctrl+Enter send";
      this.screen.writeString(cx + cw - measureWidth(hint) - PAD_SM, y, hint, modeStyle);
      y++;
    }

    return y;
  }

  drawAgentCard(y: number, width: number, name: string, status: string, opts?: {
    verb?: string;
    toolCalls?: string;
    outputLines?: string[];
    duration?: string;
    animate?: boolean;
  }): number {
    const cx = this.contentLeft;
    const cw = this.contentWidth;
    const w = Math.min(cw, this.screen.getCols() - cx - GUTTER);
    const isRunning = status === "running" || status === "calling_tool";
    const isSuccess = status === "success" || status === "complete";
    const isError = status === "error";
    const borderColor = isError ? this.theme.error : isSuccess ? this.theme.success : isRunning ? this.theme.agentRunning : this.theme.agentWaiting;
    const bStyle = this.style({ fg: borderColor });
    const cardBgStyle = this.style({ bg: this.theme.card });
    const nameStyle = this.style({ fg: this.theme.ink, bold: true });
    const verbStyle = this.style({ fg: this.theme.muted });
    const metaStyle = this.style({ fg: this.theme.muted, dim: true });
    const outputStyle = this.style({ fg: borderColor, dim: true });
    const canvasStyle = this.style({ bg: this.theme.canvas });

    const icon = isError ? "\u2717" : isSuccess ? "\u2713" : isRunning ? "\u25cf" : "\u25f4";
    const iconColor = isError ? this.theme.error : isSuccess ? this.theme.success : isRunning ? this.theme.agentRunning : this.theme.agentWaiting;
    const iconStyle = this.style({ fg: iconColor });

    if (y >= this.screen.getRows() - GUTTER) return y;

    // Top border with icon and name
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(cx, y, "\u256d\u2500", bStyle);
    this.screen.writeString(cx + 2, y, icon, iconStyle);
    this.screen.writeString(cx + 4, y, ` ${name} `, nameStyle);
    const dur = opts?.duration ? ` \u25f7 ${opts.duration}` : "";
    const rightStart = cx + w - dur.length - 2;
    this.screen.writeString(rightStart, y, dur, metaStyle);
    this.screen.writeString(cx + w - 1, y, "\u2500\u256e", bStyle);
    y++;

    if (y >= this.screen.getRows() - GUTTER) return y;

    // Verb + tool calls line (card surface background)
    this.screen.clearLine(y, cardBgStyle);
    this.screen.writeString(cx, y, "\u2502 ", bStyle);
    if (opts?.verb) {
      this.screen.writeString(cx + PAD, y, `${opts.verb}...`, verbStyle);
    }
    if (opts?.toolCalls) {
      const tcX = cx + w - measureWidth(stripAnsi(opts.toolCalls)) - GUTTER;
      this.screen.writeString(tcX, y, opts.toolCalls, metaStyle);
    }
    this.screen.writeString(cx + w - 1, y, " \u2502", bStyle);
    y++;

    // Divider + output lines
    if (opts?.outputLines && opts.outputLines.length > 0) {
      if (y >= this.screen.getRows() - GUTTER) return y;
      this.screen.clearLine(y, cardBgStyle);
      this.screen.writeString(cx, y, "\u2502", bStyle);
      this.screen.writeString(cx + PAD, y, "\u2500".repeat(Math.min(30, w - 8)), this.style({ fg: this.theme.dim }));
      this.screen.writeString(cx + w - 1, y, "\u2502", bStyle);
      y++;

      for (const ol of opts.outputLines.slice(-3)) {
        if (y >= this.screen.getRows() - GUTTER) break;
        this.screen.clearLine(y, cardBgStyle);
        this.screen.writeString(cx, y, "\u2502 ", bStyle);
        const trimmed = ol.length > w - 8 ? ol.slice(0, w - 12) + "\u2026" : ol;
        this.screen.writeString(cx + PAD, y, trimmed, outputStyle);
        this.screen.writeString(cx + w - 1, y, " \u2502", bStyle);
        y++;
      }
    }

    // Bottom border
    if (y < this.screen.getRows() - GUTTER) {
      this.screen.clearLine(y, canvasStyle);
      this.screen.writeString(cx, y, "\u2570" + BOX.h.repeat(w - 2) + "\u256f", bStyle);
      y++;
    }

    return y + 1;
  }

  drawStatusBar(y: number, opts?: {
    vimMode?: string;
    memoryCount?: number;
    vaultCount?: number;
    cost?: string;
    tokens?: string;
    agentStatus?: string;
  }): number {
    const cols = this.screen.getCols();
    if (y >= this.screen.getRows()) return y;

    const bgStyle = this.style({ bg: this.theme.surface });
    const fgStyle = this.style({ fg: this.theme.muted });
    const dimStyle = this.style({ fg: this.theme.dim });

    this.screen.clearLine(y, bgStyle);
    let x = GUTTER;

    // Left accent block
    const blockStyle = this.style({ fg: this.theme.accent, bold: true });
    this.screen.writeString(x, y, "\u2502", dimStyle);
    x += 2;

    // Vim mode
    if (opts?.vimMode) {
      const modeColor = opts.vimMode === "insert" ? this.theme.accent : this.theme.muted;
      const ms = this.style({ fg: modeColor, bold: true });
      this.screen.writeString(x, y, ` ${opts.vimMode.toUpperCase()} `, ms);
      x += measureWidth(stripAnsi(` ${opts.vimMode.toUpperCase()} `)) + 1;
      this.screen.writeString(x, y, "\u2502", dimStyle);
      x += 2;
    }

    // Agent status
    if (opts?.agentStatus) {
      this.screen.writeString(x, y, opts.agentStatus, fgStyle);
      x += measureWidth(stripAnsi(opts.agentStatus)) + 2;
      this.screen.writeString(x, y, "\u2502", dimStyle);
      x += 2;
    }

    // Memory & vault
    const storage: string[] = [];
    if (opts?.memoryCount !== undefined) storage.push(`mem:${opts.memoryCount}`);
    if (opts?.vaultCount !== undefined) storage.push(`vault:${opts.vaultCount}`);
    if (storage.length > 0) {
      this.screen.writeString(x, y, storage.join("  \u00b7  "), fgStyle);
      x += measureWidth(stripAnsi(storage.join("  \u00b7  "))) + 2;
      this.screen.writeString(x, y, "\u2502", dimStyle);
      x += 2;
    }

    // Cost
    if (opts?.cost) {
      this.screen.writeString(x, y, opts.cost, fgStyle);
      x += measureWidth(stripAnsi(opts.cost)) + 2;
    }

    // Right: terminal size
    const sizeStr = ` ${cols}x${this.screen.getRows()} `;
    this.screen.writeString(cols - measureWidth(sizeStr) - GUTTER, y, sizeStr, dimStyle);

    return y + 1;
  }

  // ── Pulse Animation Drawing ──────────────────────────────────────────────

  drawPulseSymbol(x: number, y: number, elapsed?: number): number {
    const state = this.pulse.getState(elapsed);
    const symbol = this.pulse.getSymbol();
    const canvasStyle = this.style({ bg: this.theme.canvas });

    if (y >= this.screen.getRows()) return y;

    if (this.useTruecolor) {
      const tcStyle = this.pool.getTruecolorStyle(state.color);
      this.screen.writeString(x, y, symbol, tcStyle);
    } else {
      const fallback = this.style({ fg: state.color });
      this.screen.writeString(x, y, symbol, fallback);
    }
    return y;
  }

  drawPulseInStatusBar(y: number, label: string, elapsed?: number): number {
    const cols = this.screen.getCols();
    if (y >= this.screen.getRows()) return y;

    const bgStyle = this.style({ bg: this.theme.surface });
    const state = this.pulse.getState(elapsed);
    const symbol = this.pulse.getSymbol();

    this.screen.clearLine(y, bgStyle);

    // Pulse icon + label on the left
    if (this.useTruecolor) {
      const tcStyle = this.pool.getTruecolorStyle(state.color);
      this.screen.writeString(GUTTER, y, ` ${symbol} ${label} `, tcStyle);
    } else {
      const pulseStyle = this.style({ fg: state.color, bold: true });
      this.screen.writeString(GUTTER, y, ` ${symbol} ${label} `, pulseStyle);
    }

    // Terminal size on the right
    const sizeStr = ` ${cols}x${this.screen.getRows()} `;
    this.screen.writeString(cols - measureWidth(sizeStr) - GUTTER, y, sizeStr, this.style({ fg: this.theme.dim }));

    return y + 1;
  }

  drawPulseBannerLine(y: number, elapsed?: number): number {
    const cols = this.screen.getCols();
    if (y >= this.screen.getRows()) return y;

    const state = this.pulse.getState(elapsed);
    const canvasStyle = this.style({ bg: this.theme.canvas });

    // Use the pulse symbol pattern instead of raw ∞ repeats
    const symbol = this.pulse.getSymbol();
    const pattern = `${symbol} `;
    const repeatCount = Math.floor((cols - GUTTER_LG) / measureWidth(pattern));
    const fullLine = pattern.repeat(repeatCount);

    this.screen.clearLine(y, canvasStyle);

    if (this.useTruecolor) {
      const tcStyle = this.pool.getTruecolorStyle(state.color);
      this.screen.writeString(GUTTER, y, fullLine, tcStyle);
    } else {
      const pulseStyle = this.style({ fg: state.color, dim: true });
      this.screen.writeString(GUTTER, y, fullLine, pulseStyle);
    }
    return y + 1;
  }

  drawPulseBorderBox(y: number, width: number, title: string, elapsed?: number): { y: number; pulseStyle: number } {
    const cx = this.contentLeft;
    const cols = this.screen.getCols();
    const w = Math.min(width, cols - cx - GUTTER);
    const state = this.pulse.getState(elapsed);
    const symbol = this.pulse.getSymbol();
    const canvasStyle = this.style({ bg: this.theme.canvas });

    const borderStyle = this.useTruecolor
      ? this.pool.getTruecolorStyle(state.color)
      : this.style({ fg: state.color });

    const titleText = ` ${symbol} ${title} `;
    const lineLen = Math.max(0, w - 2 - stripAnsi(titleText).length - 1);

    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(cx, y, BOX.tl + BOX.h.repeat(Math.floor(lineLen / 2)), borderStyle);
    this.screen.writeString(cx + Math.floor(lineLen / 2), y, titleText, borderStyle);
    this.screen.writeString(cx + Math.floor(lineLen / 2) + stripAnsi(titleText).length, y, BOX.h.repeat(Math.ceil(lineLen / 2)) + BOX.tr, borderStyle);

    return { y: y + 1, pulseStyle: borderStyle };
  }
}
