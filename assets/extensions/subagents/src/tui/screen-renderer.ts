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

  /** Streaming dot animation frame — cycles 0-3 */
  private streamDot(frame: number): string {
    const dots = ["\u25cc", "\u25cd", "\u25ce", "\u25cd"];
    return dots[frame % dots.length];
  }

  drawMessageBubble(y: number, width: number, role: string, content: string, timestamp: string, opts?: {
    toolCalls?: number;
    duration?: string;
    agentName?: string;
    isStreaming?: boolean;
    animFrame?: number;
    modelName?: string;
    agentColor?: string;
  }): number {
    const cols = this.screen.getCols();
    const cx = this.contentLeft;
    const cw = this.contentWidth;
    const isUser = role === "user";

    // Color scheme
    const badgeColor = opts?.agentColor || (isUser ? this.theme.accent : this.theme.info);
    const borderColor = isUser ? this.theme.userBubbleBorder : this.theme.assistantBubbleBorder;
    const bgColor = isUser ? this.theme.userBubble : this.theme.card;

    const canvasBg = this.style({ bg: this.theme.canvas });
    const bStyle = this.style({ fg: borderColor });
    const badgeStyle = this.style({ fg: badgeColor, bold: true });
    const headerStyle = this.style({ fg: this.theme.muted, dim: true });
    const contentStyle = this.style({ fg: this.theme.ink });
    const bubbleBg = this.style({ bg: bgColor });

    // Identity bar: badge symbol + role name + optional model tag
    const badgeSym = isUser ? "\u25c6" : "\u25a3";
    const name = isUser ? "You" : (opts?.agentName || "Assistant");
    const modelTag = (!isUser && opts?.modelName) ? ` \u2502 ${opts.modelName}` : "";

    // Meta info (right side of header)
    const metaParts: string[] = [];
    if (opts?.toolCalls !== undefined) metaParts.push(`tools:${opts.toolCalls}`);
    if (opts?.duration) metaParts.push(opts.duration);
    if (opts?.isStreaming) metaParts.push(this.streamDot(opts?.animFrame ?? 0));
    const metaStr = metaParts.length > 0 ? `  \u00b7  ${metaParts.join("  \u00b7  ")}` : "";

    const identityStr = `${badgeSym} ${name}${modelTag}`;
    const identityW = measureWidth(stripAnsi(identityStr));

    // Content wrap
    const maxContentW = Math.min(cw - PAD * 2, SPACING.maxBubbleWidth);
    const innerWrapW = Math.max(16, maxContentW - PAD);
    const lines = wordWrap(content, innerWrapW);
    let maxLineW = 0;
    for (const line of lines) {
      const lineW = measureWidth(stripAnsi(line.trimEnd()));
      if (lineW > maxLineW) maxLineW = lineW;
    }

    // Header line width
    const headerTotalW = identityW + measureWidth(stripAnsi(metaStr)) + measureWidth(timestamp) + 4;
    const bubbleW = Math.min(maxContentW, Math.max(headerTotalW + PAD, maxLineW + PAD + 4));
    const startX = isUser ? cx + cw - bubbleW - PAD_SM : cx + PAD_SM;

    if (y >= this.screen.getRows() - GUTTER) return y;

    // ── Top border ──
    this.screen.clearLine(y, canvasBg);
    this.screen.writeString(startX, y, "\u256d" + BOX.h.repeat(bubbleW - 2) + "\u256e", bStyle);
    y++;

    // ── Identity bar (badge + name + model + meta + timestamp) ──
    if (y >= this.screen.getRows() - GUTTER) return y;
    this.screen.clearLine(y, bubbleBg);

    // Badge + name (colored)
    this.screen.writeString(startX + PAD_SM, y, badgeSym, badgeStyle);
    this.screen.writeString(startX + PAD_SM + 2, y, name, badgeStyle);
    if (modelTag) {
      this.screen.writeString(startX + PAD_SM + 2 + measureWidth(name) + 1, y, modelTag, headerStyle);
    }

    // Meta + timestamp (right-aligned)
    const rightContent = metaStr ? `${metaStr}  ${timestamp}` : timestamp;
    const rightW = measureWidth(stripAnsi(rightContent));
    const rightX = startX + bubbleW - PAD_SM - rightW;
    if (rightX > startX + PAD_SM + identityW + 2) {
      this.screen.writeString(rightX, y, rightContent, headerStyle);
    }

    // Side borders
    this.screen.writeString(startX, y, "\u2502", bStyle);
    this.screen.writeString(startX + bubbleW - 1, y, "\u2502", bStyle);
    y++;

    // ── Content lines ──
    for (const line of lines) {
      if (y >= this.screen.getRows() - GUTTER) break;
      this.screen.clearLine(y, bubbleBg);
      const clean = line.trimEnd();
      const visibleLen = measureWidth(stripAnsi(clean));
      const pad = Math.max(0, bubbleW - PAD - visibleLen);
      this.screen.writeString(startX + PAD_SM, y, clean + " ".repeat(pad), contentStyle);
      this.screen.writeString(startX, y, "\u2502", bStyle);
      this.screen.writeString(startX + bubbleW - 1, y, "\u2502", bStyle);
      y++;
    }

    // ── Bottom border ──
    if (y < this.screen.getRows() - GUTTER) {
      this.screen.clearLine(y, canvasBg);
      this.screen.writeString(startX, y, "\u2570" + BOX.h.repeat(bubbleW - 2) + "\u256f", bStyle);
      y++;
    }

    return y + 1;
  }

  drawThinkingBlock(y: number, width: number, content: string, isCollapsed: boolean, timestamp: string, opts?: {
    animFrame?: number;
  }): number {
    const cx = this.contentLeft;
    const cw = this.contentWidth;
    const gutterX = cx + PAD_SM;

    const canvasStyle = this.style({ bg: this.theme.canvas });
    const headerStyle = this.style({ fg: this.theme.muted, dim: true });
    const contentStyle = this.style({ fg: this.theme.muted, italic: true });

    // Shimmer animated accent color
    const frame = opts?.animFrame ?? 0;
    const shimmerPhase = Math.sin(frame * 0.08) * 0.3 + 0.7;
    const accentR = Math.round(0xff * shimmerPhase);
    const accentG = Math.round(0x7a * shimmerPhase);
    const accentB = Math.round(0x17 * shimmerPhase);
    const accentHex = `#${accentR.toString(16).padStart(2, "0")}${accentG.toString(16).padStart(2, "0")}${accentB.toString(16).padStart(2, "0")}`;
    let accentStyle: number;
    if (this.useTruecolor) {
      accentStyle = this.pool.getTruecolorStyle(accentHex);
    } else {
      accentStyle = this.style({ fg: accentHex });
    }

    if (y >= this.screen.getRows() - GUTTER) return y;

    // Accent strip (left border) with shimmer
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(gutterX, y, "\u258c", accentStyle);
    const chevron = isCollapsed ? "\u25b8" : "\u25be";
    const headerText = `${chevron} Reasoning  ${timestamp}`;
    this.screen.writeString(gutterX + PAD_SM, y, headerText, headerStyle);

    // Collapse hint (right-aligned)
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
        this.screen.writeString(gutterX, y, "\u258c", accentStyle);
        this.screen.writeString(gutterX + PAD_SM, y, line, contentStyle);
        y++;
      }
    }
    return y;
  }

  /** Detect entity type at a given position in text */
  private entityAt(text: string, pos: number): { type: "at" | "slash" | "shell" | null; start: number; end: number } {
    if (pos < 0 || pos >= text.length) return { type: null, start: pos, end: pos };
    // Check for @mention
    const atMatch = text.slice(0, pos + 1).match(/(?:^|\s)(@\w*)$/);
    if (atMatch) return { type: "at", start: pos - atMatch[1].length + 1, end: pos };
    // Check for /command
    const slashMatch = text.slice(0, pos + 1).match(/(?:^|\s)(\/\w*)$/);
    if (slashMatch) return { type: "slash", start: pos - slashMatch[1].length + 1, end: pos };
    // Check for !shell
    if (text.charAt(0) === "!") return { type: "shell", start: 0, end: text.indexOf(" ") > 0 ? text.indexOf(" ") - 1 : text.length - 1 };
    return { type: null, start: pos, end: pos };
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
    const elevatedStyle = this.style({ bg: this.theme.surfaceElevated });
    const modeStyle = this.style({ fg: this.theme.muted, dim: true });
    const accentStyle = this.style({ fg: this.theme.accent });
    const atStyle = this.style({ fg: this.theme.info });
    const slashStyle = this.style({ fg: this.theme.warning });
    const shellStyle = this.style({ fg: this.theme.error });

    if (y >= this.screen.getRows() - SPACING.inputAreaLines) return y;

    const inputW = w - PAD;
    const maxVisibleChars = inputW - 2;

    // Split text into lines for multi-line display
    const lines = text.split("\n");
    const visibleLines = lines.slice(-3); // max 3 visible lines
    const totalLines = visibleLines.length;

    // Top border
    this.screen.clearLine(y, elevatedStyle);
    this.screen.writeString(cx, y, "\u256d" + BOX.h.repeat(inputW) + "\u256e", borderStyle);
    y++;

    // Figure out which visual line and x-position the cursor is on
    let cursorLine = 0;
    let cursorLineOffset = 0;
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i].length + 1; // +1 for newline
      if (charCount + lineLen > cursorPos) {
        cursorLine = i;
        cursorLineOffset = cursorPos - charCount;
        break;
      }
      charCount += lineLen;
    }
    // Adjust for visible lines (show bottom-most)
    const lineOffset = Math.max(0, lines.length - 3);
    const visCursorLine = cursorLine - lineOffset;

    // Draw visible input lines
    for (let li = 0; li < visibleLines.length; li++) {
      if (y >= this.screen.getRows() - SPACING.inputAreaLines) break;
      this.screen.clearLine(y, elevatedStyle);
      this.screen.writeString(cx, y, "\u2502", borderStyle);

      const lineText = visibleLines[li];
      const displayText = lineText.length > maxVisibleChars
        ? lineText.slice(lineText.length - maxVisibleChars)
        : lineText;
      const startOffset = lineText.length > maxVisibleChars ? lineText.length - maxVisibleChars : 0;

      const writeStartX = cx + PAD_SM;

      // Draw each character with entity highlighting
      for (let i = 0; i < displayText.length && i < maxVisibleChars; i++) {
        const globalI = startOffset + i;
        const ch = displayText[i];
        const isCursor = li === visCursorLine && globalI === cursorLineOffset;

        // Determine styling based on entity type
        const entity = this.entityAt(text, globalI);
        let charStyle = inputStyle;
        if (entity.type === "at" && globalI >= entity.start && globalI <= entity.end) {
          charStyle = atStyle;
        } else if (entity.type === "slash" && globalI >= entity.start && globalI <= entity.end) {
          charStyle = slashStyle;
        } else if (entity.type === "shell") {
          charStyle = shellStyle;
        }

        if (isCursor && vimMode === "insert") {
          this.screen.writeString(writeStartX + i, y, ch, cursorStyle);
        } else {
          this.screen.writeString(writeStartX + i, y, ch, charStyle);
        }
      }

      // Cursor on this line at end
      if (li === visCursorLine && cursorLineOffset >= lineText.length) {
        if (vimMode === "insert") {
          this.screen.writeString(writeStartX + lineText.length - startOffset, y, " ", cursorStyle);
        } else {
          this.screen.writeString(writeStartX + lineText.length - startOffset, y, "\u258c", inputStyle);
        }
      }

      // If no text and this is the active line, show cursor
      if (lineText.length === 0 && li === visCursorLine) {
        if (vimMode === "insert") {
          this.screen.writeString(writeStartX, y, " ", cursorStyle);
        } else {
          this.screen.writeString(writeStartX, y, "\u258c", inputStyle);
        }
      }

      this.screen.writeString(cx + inputW + 1, y, "\u2502", borderStyle);
      y++;
    }

    // Fill remaining input lines if fewer than 3
    for (let li = visibleLines.length; li < 3; li++) {
      if (y >= this.screen.getRows() - 1) break;
      this.screen.clearLine(y, elevatedStyle);
      this.screen.writeString(cx, y, "\u2502", borderStyle);
      this.screen.writeString(cx + inputW + 1, y, "\u2502", borderStyle);
      y++;
    }

    // Bottom border
    if (y < this.screen.getRows() - 1) {
      this.screen.clearLine(y, elevatedStyle);
      this.screen.writeString(cx, y, "\u2570" + BOX.h.repeat(inputW) + "\u256f", borderStyle);
      y++;
    }

    // Mode bar below input
    if (y < this.screen.getRows()) {
      this.screen.clearLine(y, this.surfaceStyle("surface"));
      if (vimMode) {
        const modeText = vimMode.toUpperCase();
        this.screen.writeString(cx + PAD_SM, y, `\u25c6 ${modeText}`, vimMode === "insert" ? accentStyle : modeStyle);
        this.screen.writeString(cx + PAD_SM + 8, y, "\u2502", this.style({ fg: this.theme.dim }));
      }

      // Line count indicator (multi-line)
      if (lines.length > 1) {
        const lineCount = `${lines.length} lines`;
        const lcStyle = this.style({ fg: this.theme.textSecondary });
        this.screen.writeString(cx + PAD_SM + 12, y, lineCount, lcStyle);
        this.screen.writeString(cx + PAD_SM + 12 + measureWidth(lineCount) + 1, y, "\u2502", this.style({ fg: this.theme.dim }));
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
