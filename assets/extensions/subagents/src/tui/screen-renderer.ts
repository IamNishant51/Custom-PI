import { TerminalScreen } from "./screen";
import { StylePool } from "./style-pool";
import { AnsiWriter } from "./ansi-writer";
import { THEME, BOX, hexToAnsi, type ThemeColors, type PulseConfig } from "./types";
import { stripAnsi, measureWidth, wordWrap } from "./utils/measure-text";
import { PulseController, hexToRgb, rgbToHex } from "./app/pulse-controller";

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

  drawBanner(startY: number): number {
    const banner = [
      "  ██████╗ ██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ███╗      ██████╗ ██╗",
      " ██╔════╝ ██║   ██║██╔════╝ ╚══██╔══╝██╔═══██╗████╗ ████║      ██╔══██╗██║",
      " ██║      ██║   ██║╚██████╗    ██║   ██║   ██║██╔████╔██║█████╗██████╔╝██║",
      " ██║      ██║   ██║ ╚═══██║    ██║   ██║   ██║██║╚██╔╝██║╚════╝██╔═══╝ ██║",
      " ╚██████╗ ╚██████╔╝██████╔╝    ██║   ╚██████╔╝██║ ╚═╝ ██║      ██║     ██║",
      "  ╚═════╝  ╚═════╝ ╚═════╝     ╚═╝    ╚═════╝ ╚═╝     ╚═╝      ╚═╝     ╚═╝",
    ];
    const colors = this.theme.banner;
    const canvasStyle = this.style({ bg: this.theme.canvas });
    for (let i = 0; i < banner.length; i++) {
      const line = banner[i];
      const color = colors[i] || colors[colors.length - 1];
      const s = this.style({ fg: color });
      const y = startY + i;
      this.screen.clearLine(y, canvasStyle);
      this.screen.writeString(2, y, line, s);
    }
    return startY + banner.length + 1;
  }

  drawBox(y: number, width: number, title: string, content: string[], borderColor: string, accentColor?: string): number {
    const bStyle = this.style({ fg: borderColor });
    const aStyle = accentColor ? this.style({ fg: accentColor }) : bStyle;
    const canvasStyle = this.style({ bg: this.theme.canvas });
    const cols = this.screen.getCols();
    const w = Math.min(width, cols - 4);

    const titleText = ` ${title} `;
    const titleLen = stripAnsi(titleText).length;
    const lineLen = Math.max(0, w - 2 - titleLen - 1);

    // Top border
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(1, y, BOX.tl + BOX.h.repeat(Math.floor(lineLen / 2)), bStyle);
    this.screen.writeString(1 + Math.floor(lineLen / 2), y, titleText, aStyle);
    this.screen.writeString(1 + Math.floor(lineLen / 2) + titleLen, y, BOX.h.repeat(Math.ceil(lineLen / 2)) + BOX.tr, bStyle);

    let cy = y + 1;
    for (const line of content) {
      if (cy >= this.screen.getRows() - 2) break;
      this.screen.clearLine(cy, canvasStyle);
      const clean = stripAnsi(line);
      const visibleW = measureWidth(clean);
      const pad = Math.max(0, w - 4 - visibleW);
      this.screen.writeString(2, cy, " " + line + " ".repeat(pad) + " ", bStyle);
      cy++;
    }

    // Bottom border
    if (cy < this.screen.getRows() - 2) {
      this.screen.clearLine(cy, canvasStyle);
      this.screen.writeString(1, cy, BOX.bl + BOX.h.repeat(w - 2) + BOX.br, bStyle);
      cy++;
    }

    return cy;
  }

  drawDivider(y: number, width: number, color: string): number {
    const s = this.style({ fg: color });
    const canvasStyle = this.style({ bg: this.theme.canvas });
    if (y >= this.screen.getRows()) return y;
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(1, y, BOX.ltee + BOX.h.repeat(Math.max(0, width - 2)) + BOX.rtee, s);
    return y + 1;
  }

  drawMessageBubble(y: number, width: number, role: string, content: string, timestamp: string, opts?: {
    toolCalls?: number;
    duration?: string;
    agentName?: string;
    isStreaming?: boolean;
  }): number {
    const cols = this.screen.getCols();
    const maxCols = Math.min(width - 4, cols - 6);
    const isUser = role === "user";
    const borderColor = isUser ? this.theme.userBubbleBorder : this.theme.assistantBubbleBorder;
    const bStyle = this.style({ fg: borderColor });
    const headerStyle = this.style({ fg: this.theme.muted, dim: true });
    const canvasStyle = this.style({ bg: this.theme.canvas });
    const contentStyle = this.style({ fg: this.theme.ink });

    const agentIcon = isUser ? "●" : opts?.agentName ? "◈" : "●";
    const name = isUser ? "You" : (opts?.agentName || "Assistant");
    const metaParts: string[] = [];
    if (opts?.toolCalls !== undefined) metaParts.push(`tools: ${opts.toolCalls}`);
    if (opts?.duration) metaParts.push(opts.duration);
    if (opts?.isStreaming) metaParts.push("◌ streaming");
    const meta = metaParts.length > 0 ? `  ·  ${metaParts.join("  ·  ")}` : "";
    const headerText = `${agentIcon} ${name}${meta}  ${timestamp}`;
    const headerW = measureWidth(headerText);

    const lines = wordWrap(content, maxCols - 4);
    let maxLineW = 0;
    for (const line of lines) {
      const lineW = measureWidth(stripAnsi(line.trimEnd()));
      if (lineW > maxLineW) maxLineW = lineW;
    }

    const w = Math.min(maxCols, Math.max(headerW + 4, maxLineW + 4));
    const startX = isUser ? Math.max(2, cols - w - 4) : 2;

    // Top border
    if (y >= this.screen.getRows() - 2) return y;
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(startX, y, "╭" + BOX.h.repeat(w - 2) + "╮", bStyle);
    y++;

    // Header
    if (y >= this.screen.getRows() - 3) return y;
    this.screen.clearLine(y, canvasStyle);
    const trimmedHeader = headerText.length > w - 4 ? headerText.slice(0, w - 6) + "…" : headerText;
    this.screen.writeString(startX + 2, y, trimmedHeader, headerStyle);
    y++;

    // Divider
    if (y >= this.screen.getRows() - 3) return y;
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(startX, y, "│" + " ".repeat(w - 2) + "│", bStyle);
    y++;

    // Content
    for (const line of lines) {
      if (y >= this.screen.getRows() - 3) break;
      this.screen.clearLine(y, canvasStyle);
      const clean = line.trimEnd();
      const pad = Math.max(0, w - 4 - measureWidth(stripAnsi(clean)));
      this.screen.writeString(startX + 2, y, clean + " ".repeat(pad), contentStyle);
      this.screen.writeString(startX, y, "│", bStyle);
      this.screen.writeString(startX + w - 1, y, "│", bStyle);
      y++;
    }

    // Bottom border
    if (y < this.screen.getRows() - 2) {
      this.screen.clearLine(y, canvasStyle);
      this.screen.writeString(startX, y, "╰" + BOX.h.repeat(w - 2) + "╯", bStyle);
      y++;
    }

    return y + 1;
  }

  drawThinkingBlock(y: number, width: number, content: string, isCollapsed: boolean, timestamp: string): number {
    const cols = this.screen.getCols();
    const w = Math.min(width - 4, cols - 6);
    const canvasStyle = this.style({ bg: this.theme.canvas });
    const headerStyle = this.style({ fg: this.theme.muted, dim: true });
    const lineStyle = this.style({ fg: this.theme.hairline });
    const contentStyle = this.style({ fg: this.theme.muted, italic: true });

    if (y >= this.screen.getRows() - 2) return y;
    this.screen.clearLine(y, canvasStyle);

    const chevron = isCollapsed ? "▸" : "▾";
    const headerText = `${chevron} Reasoning  ${timestamp}`;
    this.screen.writeString(2, y, headerText, headerStyle);
    y++;

    if (!isCollapsed && content) {
      const lines = wordWrap(content, w - 6);
      for (const line of lines) {
        if (y >= this.screen.getRows() - 2) break;
        this.screen.clearLine(y, canvasStyle);
        this.screen.writeString(2, y, "│", lineStyle);
        this.screen.writeString(4, y, line, contentStyle);
        y++;
      }
    }
    return y;
  }

  drawInputArea(y: number, width: number, text: string, cursorPos: number, vimMode?: string): number {
    const cols = this.screen.getCols();
    const w = Math.min(width - 2, cols - 4);
    const borderStyle = this.style({ fg: this.theme.hairline });
    const inputStyle = this.style({ fg: this.theme.ink });
    const cursorStyle = this.style({ fg: this.theme.ink, bg: this.theme.accent });
    const canvasStyle = this.style({ bg: this.theme.canvas });
    const modeStyle = this.style({ fg: this.theme.muted, dim: true });
    const accentStyle = this.style({ fg: this.theme.accent });

    if (y >= this.screen.getRows() - 3) return y;

    // Top border
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(1, y, "╭" + BOX.h.repeat(w) + "╮", borderStyle);
    y++;

    if (y >= this.screen.getRows() - 3) return y;

    // Input line
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(1, y, "│", borderStyle);
    const displayText = text.length > w - 2 ? text.slice(text.length - w + 4) : text;
    const visibleCursor = Math.min(cursorPos, displayText.length);
    for (let i = 0; i < w - 2 && i < displayText.length; i++) {
      const ch = displayText[i];
      if (i === visibleCursor && vimMode === "insert") {
        this.screen.writeString(2 + i, y, ch, cursorStyle);
      } else {
        this.screen.writeString(2 + i, y, ch, inputStyle);
      }
    }
    if (visibleCursor >= displayText.length && vimMode === "insert") {
      this.screen.writeString(2 + displayText.length, y, " ", cursorStyle);
    }
    this.screen.writeString(w, y, "│", borderStyle);
    y++;

    // Bottom border
    if (y < this.screen.getRows() - 2) {
      this.screen.clearLine(y, canvasStyle);
      this.screen.writeString(1, y, "╰" + BOX.h.repeat(w) + "╯", borderStyle);
      y++;
    }

    // Mode indicator
    if (y < this.screen.getRows() - 1) {
      this.screen.clearLine(y, canvasStyle);
      if (vimMode) {
        const modeText = vimMode.toUpperCase();
        this.screen.writeString(2, y, `[${modeText}]`, vimMode === "insert" ? accentStyle : modeStyle);
      }
      this.screen.writeString(w - 8, y, "Ctrl+Enter send", modeStyle);
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
    const cols = this.screen.getCols();
    const w = Math.min(width - 2, cols - 4);
    const isRunning = status === "running" || status === "calling_tool";
    const isSuccess = status === "success" || status === "complete";
    const isError = status === "error";
    const borderColor = isError ? this.theme.error : isSuccess ? this.theme.success : isRunning ? this.theme.agentRunning : this.theme.agentWaiting;
    const bStyle = this.style({ fg: borderColor });
    const nameStyle = this.style({ fg: this.theme.ink, bold: true });
    const verbStyle = this.style({ fg: this.theme.muted });
    const metaStyle = this.style({ fg: this.theme.muted, dim: true });
    const outputStyle = this.style({ fg: borderColor, dim: true });
    const canvasStyle = this.style({ bg: this.theme.canvas });

    const icon = isError ? "✗" : isSuccess ? "✓" : isRunning ? "●" : "◴";
    const iconColor = isError ? this.theme.error : isSuccess ? this.theme.success : isRunning ? this.theme.agentRunning : this.theme.agentWaiting;
    const iconStyle = this.style({ fg: iconColor });

    if (y >= this.screen.getRows() - 3) return y;

    // Top border
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(1, y, "╭─", bStyle);
    this.screen.writeString(3, y, icon, iconStyle);
    this.screen.writeString(5, y, ` ${name} `, nameStyle);
    const dur = opts?.duration ? ` ◷ ${opts.duration}` : "";
    const rightLabel = dur;
    const rightStart = w - rightLabel.length - 1;
    this.screen.writeString(rightStart, y, rightLabel, metaStyle);
    this.screen.writeString(w - 1, y, "─╮", bStyle);
    y++;

    if (y >= this.screen.getRows() - 3) return y;

    // Verb + tool calls line
    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(1, y, "│ ", bStyle);
    if (opts?.verb) {
      this.screen.writeString(3, y, `${opts.verb}...`, verbStyle);
    }
    if (opts?.toolCalls) {
      const tcX = w - opts.toolCalls.length - 5;
      this.screen.writeString(tcX, y, opts.toolCalls, metaStyle);
    }
    this.screen.writeString(w - 1, y, " │", bStyle);
    y++;

    // Divider if has output
    if (opts?.outputLines && opts.outputLines.length > 0) {
      if (y >= this.screen.getRows() - 3) return y;
      this.screen.clearLine(y, canvasStyle);
      this.screen.writeString(1, y, "│  ─────────────────────────────────  │", bStyle);
      y++;

      for (const ol of opts.outputLines.slice(-3)) {
        if (y >= this.screen.getRows() - 3) break;
        this.screen.clearLine(y, canvasStyle);
        this.screen.writeString(1, y, "│ ", bStyle);
        const trimmed = ol.length > w - 6 ? ol.slice(0, w - 9) + "…" : ol;
        this.screen.writeString(3, y, trimmed, outputStyle);
        this.screen.writeString(w - 1, y, " │", bStyle);
        y++;
      }
    }

    // Bottom border
    if (y < this.screen.getRows() - 2) {
      this.screen.clearLine(y, canvasStyle);
      this.screen.writeString(1, y, "╰" + BOX.h.repeat(w - 2) + "╯", bStyle);
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

    this.screen.clearLine(y, bgStyle);
    let x = 1;

    // Vim mode
    if (opts?.vimMode) {
      const modeColor = opts.vimMode === "insert" ? this.theme.accent : this.theme.muted;
      const ms = this.style({ fg: modeColor, bold: true });
      this.screen.writeString(x, y, ` ${opts.vimMode.toUpperCase()} `, ms);
      x += opts.vimMode.length + 3;
      this.screen.writeString(x, y, "│", fgStyle);
      x += 2;
    }

    // Agent status
    if (opts?.agentStatus) {
      this.screen.writeString(x, y, opts.agentStatus, fgStyle);
      x += opts.agentStatus.length + 2;
      this.screen.writeString(x, y, "│", fgStyle);
      x += 2;
    }

    // Memory & vault
    const storage: string[] = [];
    if (opts?.memoryCount !== undefined) storage.push(`memory: ${opts.memoryCount}`);
    if (opts?.vaultCount !== undefined) storage.push(`vault: ${opts.vaultCount}`);
    if (storage.length > 0) {
      this.screen.writeString(x, y, storage.join("  ·  "), fgStyle);
      x += storage.join("  ·  ").length + 2;
      this.screen.writeString(x, y, "│", fgStyle);
      x += 2;
    }

    // Cost
    if (opts?.cost) {
      this.screen.writeString(x, y, opts.cost, fgStyle);
      x += opts.cost.length + 2;
    }

    // Right: terminal size
    const sizeStr = ` ${cols}x${this.screen.getRows()} `;
    this.screen.writeString(cols - sizeStr.length, y, sizeStr, this.style({ fg: this.theme.dim }));

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

    if (this.useTruecolor) {
      const tcStyle = this.pool.getTruecolorStyle(state.color);
      this.screen.writeString(1, y, ` ${symbol} ${label} `, tcStyle);
    } else {
      const pulseStyle = this.style({ fg: state.color, bold: true });
      this.screen.writeString(1, y, ` ${symbol} ${label} `, pulseStyle);
    }

    const sizeStr = ` ${cols}x${this.screen.getRows()} `;
    this.screen.writeString(cols - sizeStr.length, y, sizeStr, this.style({ fg: this.theme.dim }));

    return y + 1;
  }

  drawPulseBannerLine(y: number, elapsed?: number): number {
    const cols = this.screen.getCols();
    if (y >= this.screen.getRows()) return y;

    const state = this.pulse.getState(elapsed);
    const canvasStyle = this.style({ bg: this.theme.canvas });
    const fullLine = "∞".repeat(cols - 2);

    this.screen.clearLine(y, canvasStyle);

    if (this.useTruecolor) {
      const tcStyle = this.pool.getTruecolorStyle(state.color);
      this.screen.writeString(1, y, fullLine, tcStyle);
    } else {
      const pulseStyle = this.style({ fg: state.color, dim: true });
      this.screen.writeString(1, y, fullLine, pulseStyle);
    }
    return y + 1;
  }

  drawPulseBorderBox(y: number, width: number, title: string, elapsed?: number): { y: number; pulseStyle: number } {
    const cols = this.screen.getCols();
    const w = Math.min(width, cols - 4);
    const state = this.pulse.getState(elapsed);
    const symbol = this.pulse.getSymbol();
    const canvasStyle = this.style({ bg: this.theme.canvas });

    const borderStyle = this.useTruecolor
      ? this.pool.getTruecolorStyle(state.color)
      : this.style({ fg: state.color });

    const titleText = ` ${symbol} ${title} `;
    const lineLen = Math.max(0, w - 2 - stripAnsi(titleText).length - 1);

    this.screen.clearLine(y, canvasStyle);
    this.screen.writeString(1, y, BOX.tl + BOX.h.repeat(Math.floor(lineLen / 2)), borderStyle);
    this.screen.writeString(1 + Math.floor(lineLen / 2), y, titleText, borderStyle);
    this.screen.writeString(1 + Math.floor(lineLen / 2) + stripAnsi(titleText).length, y, BOX.h.repeat(Math.ceil(lineLen / 2)) + BOX.tr, borderStyle);

    return { y: y + 1, pulseStyle: borderStyle };
  }
}
