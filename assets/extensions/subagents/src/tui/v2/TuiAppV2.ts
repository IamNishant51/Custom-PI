import { ScreenRenderer } from "./renderer/ScreenRenderer";
import { TerminalScreen } from "./renderer/TerminalScreen";
import { CellBuffer } from "./renderer/TerminalScreen";
import { StylePool } from "./renderer/StylePool";
import { AdaptiveTheme, createTheme, AdaptiveThemeOptions, SemanticTokens } from "./theme/AdaptiveTheme";

export interface TuiAppOptions {
  theme?: Partial<AdaptiveThemeOptions>;
  truecolor?: boolean;
  reducedMotion?: boolean;
  highContrast?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "thinking";
  content: string;
  timestamp: number;
  toolCalls?: number;
  duration?: string;
  collapsed?: boolean;
  agentName?: string;
}

export interface AgentTracker {
  id: string;
  name: string;
  task: string;
  status: "pending" | "running" | "calling_tool" | "success" | "error" | "warning" | "spawning";
  turn: number;
  maxTurns: number;
  toolCallCount: number;
  currentTool?: string;
  startTime: number;
  outputLines: string[];
}

const ELLIPSIS = "…";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DOT_FRAMES = ["●○○", "○●○", "○○●", "○●○"];

export class TuiAppV2 {
  private renderer: ScreenRenderer;
  private theme: AdaptiveTheme;
  private active = false;
  private stdinHandler?: (data: Buffer) => void;
  private inputText = "";
  private cursorPos = 0;
  private trackers: Map<string, AgentTracker> = new Map();
  private messageLog: Message[] = [];
  private collapsedThinking = new Set<number>();
  private renderedElements: Array<{ index: number; role: string; startY: number; endY: number }> = [];
  private memoryCount = 0;
  private vaultCount = 0;
  private sessionModel = "unknown";
  private sessionId = "session-1";
  private messageLimit = 100;
  private scrollOffset = 0;
  private frameCounter = 0;
  private lastRenderMaxY = 0;
  private lastInputTime = Date.now();
  private lastRenderTime = 0;
  private idleFps = 30;
  private rendering = false;
  private messageLogVersion = 0;
  private lastMessageCount = -1;
  private _onSubmit: ((text: string) => void) | null = null;
  private ctx?: any;
  private pi?: any;
  private vimMode: "normal" | "insert" = "insert";
  private showHelp = false;
  private inputHistory: string[] = [];
  private historyIndex = -1;

  constructor(options: TuiAppOptions = {}) {
    this.theme = createTheme({
      mode: options.theme?.mode ?? "auto",
      truecolor: options.truecolor ?? false,
      reducedMotion: options.reducedMotion ?? false,
      highContrast: options.highContrast ?? false,
    });

    this.renderer = new ScreenRenderer({
      theme: this.theme,
      truecolor: options.truecolor ?? false,
    });
  }

  get onSubmit(): ((text: string) => void) | null {
    return this._onSubmit;
  }

  set onSubmit(cb: ((text: string) => void) | null) {
    this._onSubmit = cb;
  }

  setSessionInfo(model: string, id: string): void {
    this.sessionModel = model;
    this.sessionId = id;
  }

  addMessage(message: Message): void {
    if (!message || !message.role) return;
    this.messageLog.push({ ...message, content: message.content ?? "" });
    if (this.messageLog.length > this.messageLimit) {
      this.messageLog.shift();
    }
    this.messageLogVersion++;
    this.requestRender();
  }

  addAgentTracker(tracker: AgentTracker): void {
    this.trackers.set(tracker.id, tracker);
    this.requestRender();
  }

  updateAgentTracker(id: string, updates: Partial<AgentTracker>): void {
    const existing = this.trackers.get(id);
    if (existing) {
      this.trackers.set(id, { ...existing, ...updates });
      this.requestRender();
    }
  }

  removeAgentTracker(id: string): void {
    this.trackers.delete(id);
    this.requestRender();
  }

  setMemoryCount(count: number): void {
    this.memoryCount = count;
  }

  setVaultCount(count: number): void {
    this.vaultCount = count;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.renderer.start(true);

    this.stdinHandler = (data: Buffer) => this._handleInput(data.toString());
    process.stdin.on("data", this.stdinHandler);
    process.stdin.setRawMode?.(true);
    process.stdin.resume?.();

    this._renderLoop();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.stdinHandler) {
      process.stdin.off("data", this.stdinHandler);
    }
    process.stdin.setRawMode?.(false);
    process.stdin.pause?.();
    this.renderer.stop();
  }

  private requestRender(): void {
    if (!this.rendering) {
      this.rendering = true;
      setImmediate(() => {
        this.rendering = false;
        this._doRender();
      });
    }
  }

  private _renderLoop(): void {
    if (!this.active) return;
    const now = Date.now();
    const targetFps = this._hasActiveAgents() ? 30 : this.idleFps;
    const frameTime = 1000 / targetFps;
    if (now - this.lastRenderTime >= frameTime) {
      this.frameCounter++;
      this.lastRenderTime = now;
      this._doRender();
    }
    setImmediate(() => this._renderLoop());
  }

  private _hasActiveAgents(): boolean {
    for (const t of this.trackers.values()) {
      if (t.status === "running" || t.status === "calling_tool" || t.status === "spawning") return true;
    }
    return false;
  }

  private _doRender(): void {
    const screen = this.renderer.getScreen();
    const rows = screen.getRows();
    const cols = screen.getCols();
    const contentWidth = this.renderer.contentWidth;

    const statusBarY = rows - 1;
    const inputAreaY = statusBarY - 3;
    const maxContentBottom = inputAreaY - 1;

    const defaultStyle = this._style({ bg: this.theme.tokens.canvas });
    screen.clear(defaultStyle);

    let y = 0;
    y = this._drawHeader(y, cols);
    y++;

    const totalVisible = this.messageLog.length;
    const olderCount = Math.max(0, totalVisible - 10 - this.scrollOffset);
    if (olderCount > 0 && y < maxContentBottom) {
      y = this._drawScrollIndicator(y, cols, { olderCount });
    }

    const maxMessages = Math.max(1, maxContentBottom - y);
    const visibleMessages = this.messageLog.slice(-maxMessages);
    this.renderedElements = [];

    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      const startY = y;
      const ts = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      if (msg.role === "thinking") {
        const isCollapsed = this.collapsedThinking.has(i);
        y = this._drawThinkingBlock(y, cols, msg.content, isCollapsed, ts, { animFrame: this.frameCounter });
      } else {
        y = this._drawMessageBubble(y, cols, msg.role, msg.content, ts, {
          agentName: msg.role === "assistant" ? "Assistant" : undefined,
          isStreaming: msg.role === "assistant" && i === visibleMessages.length - 1,
          animFrame: this.frameCounter,
          modelName: msg.role === "assistant" ? this.sessionModel : undefined,
        });
      }

      this.renderedElements.push({ index: i, role: msg.role, startY, endY: y });
      y += 1;
      if (y >= maxContentBottom) break;
    }

    for (const [id, tracker] of this.trackers) {
      if (y >= maxContentBottom) break;
      const running = tracker.status === "running" || tracker.status === "calling_tool";
      if (running) {
        y = this._drawAgentActivity(y, cols, tracker);
      } else {
        y = this._drawAgentCard(y, cols, tracker);
      }
      y += 1;
    }

    if (inputAreaY < statusBarY) {
      this._drawInputArea(inputAreaY, contentWidth);
    }

    this._drawStatusBar(statusBarY, cols);

    let currentMaxY = y;
    if (this.lastRenderMaxY > currentMaxY) {
      for (let ry = currentMaxY; ry < this.lastRenderMaxY && ry < rows; ry++) {
        this._clearLine(ry, defaultStyle);
      }
    }
    this.lastRenderMaxY = currentMaxY;

    this.renderer.render();
  }

  private _style(def: { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; inverse?: boolean; strikethrough?: boolean }): number {
    return this.renderer.style(def);
  }

  private _writeString(x: number, y: number, text: string, style: number): void {
    this.renderer.screen.writeString(x, y, text, style);
  }

  private _clearLine(y: number, style: number): void {
    this.renderer.screen.clearLine(y, style);
  }

  private _getContentWidth(): number {
    return this.renderer.contentWidth;
  }

  private _drawHeader(y: number, cols: number): number {
    if (y >= this.renderer.screen.getRows()) return y;

    const canvasBg = this._style({ bg: this.theme.tokens.canvas });
    const accentStyle = this._style({ fg: this.theme.tokens.accent, bold: true });
    const mutedStyle = this._style({ fg: this.theme.tokens.muted });
    const dimStyle = this._style({ fg: this.theme.tokens.dim });
    const surfaceStyle = this._style({ bg: this.theme.tokens.surface });

    this._clearLine(y, surfaceStyle);

    const modelName = this.sessionModel || "model";
    const modelTag = ` ${modelName} `;
    this._writeString(2, y, modelTag, accentStyle);

    let x = 2 + modelTag.length + 1;
    this._writeString(x, y, "│", dimStyle);
    x += 2;

    const sessionShort = this.sessionId.slice(0, 8);
    this._writeString(x, y, sessionShort, mutedStyle);
    x += sessionShort.length + 2;

    this._writeString(x, y, "│", dimStyle);
    x += 2;

    const contextPercent = Math.min(100, Math.round((this.messageLog.length / this.messageLimit) * 100));
    const barW = 14;
    const filled = Math.round((contextPercent / 100) * barW);
    const ctxColor = contextPercent > 85 ? this.theme.tokens.error :
                     contextPercent > 60 ? this.theme.tokens.warning :
                     contextPercent > 30 ? this.theme.tokens.accent : this.theme.tokens.success;
    const bar = "▰".repeat(filled) + "▱".repeat(barW - filled);
    this._writeString(x, y, bar, this._style({ fg: ctxColor }));
    x += barW + 1;
    this._writeString(x, y, `${contextPercent}%`, this._style({ fg: ctxColor, dim: true }));
    x += 5;

    const msgText = ` ${this.messageLog.length} msgs `;
    this._writeString(cols - 2 - msgText.length, y, msgText, dimStyle);

    return y + 1;
  }

  private _drawScrollIndicator(y: number, cols: number, opts: { olderCount: number }): number {
    if (y >= this.renderer.screen.getRows()) return y;
    const canvasBg = this._style({ bg: this.theme.tokens.canvas });
    const muteStyle = this._style({ fg: this.theme.tokens.muted, dim: true });
    this._clearLine(y, canvasBg);
    const text = ` ↑ ${opts.olderCount} older ${ELLIPSIS} `;
    const x = Math.floor((cols - text.length) / 2);
    this._writeString(x, y, text, muteStyle);
    return y + 1;
  }

  private _drawMessageBubble(y: number, cols: number, role: string, content: string, timestamp: string, opts?: {
    toolCalls?: number;
    duration?: string;
    agentName?: string;
    isStreaming?: boolean;
    animFrame?: number;
    modelName?: string;
  }): number {
    const cx = 2;
    const cw = Math.min(cols - 4, 110);
    const isUser = role === "user";

    const userColors = {
      badge: this.theme.tokens.accent,
      border: this.theme.tokens.accent,
      bg: this._adjustColor(this.theme.tokens.accent, 0.12),
      text: this.theme.tokens.ink,
    };
    const assistantColors = {
      badge: this.theme.tokens.info,
      border: this.theme.tokens.border,
      bg: this.theme.tokens.surface,
      text: this.theme.tokens.ink,
    };
    const systemColors = {
      badge: this.theme.tokens.warning,
      border: this.theme.tokens.warning,
      bg: this._adjustColor(this.theme.tokens.warning, 0.1),
      text: this.theme.tokens.ink,
    };
    const toolColors = {
      badge: this.theme.tokens.success,
      border: this.theme.tokens.success,
      bg: this._adjustColor(this.theme.tokens.success, 0.1),
      text: this.theme.tokens.ink,
    };

    let colors = assistantColors;
    let badgeSym = "▸";
    let name = opts?.agentName || "Assistant";
    let modelTag = "";

    if (isUser) {
      colors = userColors;
      badgeSym = "◆";
      name = "You";
    } else if (role === "system") {
      colors = systemColors;
      badgeSym = "⬢";
      name = "System";
    } else if (role === "tool") {
      colors = toolColors;
      badgeSym = "⚙";
      name = "Tool";
    } else if (opts?.modelName) {
      modelTag = ` ${opts.modelName}`;
    }

    const canvasBg = this._style({ bg: this.theme.tokens.canvas });
    const borderStyle = this._style({ fg: colors.border });
    const badgeStyle = this._style({ fg: colors.badge, bold: true });
    const nameStyle = this._style({ fg: colors.badge, bold: true });
    const modelStyle = this._style({ fg: this.theme.tokens.muted, dim: true });
    const metaStyle = this._style({ fg: this.theme.tokens.muted, dim: true });
    const contentStyle = this._style({ fg: colors.text, bg: colors.bg });
    const bubbleBgStyle = this._style({ bg: colors.bg });
    const timeStyle = this._style({ fg: this.theme.tokens.dim });

    const metaParts: string[] = [];
    if (opts?.toolCalls !== undefined) metaParts.push(`${opts.toolCalls} tools`);
    if (opts?.duration) metaParts.push(opts.duration);
    if (opts?.isStreaming && opts.animFrame !== undefined) {
      metaParts.push(SPINNER_FRAMES[opts.animFrame % SPINNER_FRAMES.length]);
    }
    const metaStr = metaParts.length > 0 ? ` · ${metaParts.join(" · ")}` : "";

    const headerLeft = `${badgeSym} ${name}${modelTag}`;
    const headerRight = `${metaStr} ${timestamp}`.trim();
    const headerWidth = this._measureWidth(headerLeft) + this._measureWidth(headerRight) + 4;
    const maxBubbleW = Math.min(cw, 100);
    const innerWrapW = Math.max(20, maxBubbleW - 6);
    const safeContent = content ?? "";
    const lines = this._wordWrap(safeContent, innerWrapW);
    let maxLineW = 0;
    for (const line of lines) {
      const w = this._measureWidth(line.trimEnd());
      if (w > maxLineW) maxLineW = w;
    }
    const bubbleW = Math.min(maxBubbleW, Math.max(headerWidth + 2, maxLineW + 6));
    const startX = isUser ? 2 + cw - bubbleW - 1 : 3;

    if (y >= this.renderer.screen.getRows() - 3) return y;

    this._clearLine(y, canvasBg);
    this._writeString(startX, y, "╭" + "─".repeat(bubbleW - 2) + "╮", borderStyle);
    y++;

    if (y >= this.renderer.screen.getRows() - 3) return y;
    this._clearLine(y, bubbleBgStyle);
    this._writeString(startX + 1, y, badgeSym, badgeStyle);
    this._writeString(startX + 3, y, name, nameStyle);
    if (modelTag) {
      this._writeString(startX + 3 + name.length + 1, y, modelTag, modelStyle);
    }

    const rightContent = headerRight;
    const rightW = this._measureWidth(rightContent);
    const rightX = startX + bubbleW - 1 - rightW;
    if (rightX > startX + 3 + this._measureWidth(headerLeft) + 1) {
      this._writeString(rightX, y, rightContent, metaStyle);
    }
    this._writeString(startX, y, "│", borderStyle);
    this._writeString(startX + bubbleW - 1, y, "│", borderStyle);
    y++;

    for (const line of lines) {
      if (y >= this.renderer.screen.getRows() - 3) break;
      this._clearLine(y, bubbleBgStyle);
      const clean = line.trimEnd();
      const visibleLen = this._measureWidth(clean);
      const pad = Math.max(0, bubbleW - 4 - visibleLen);
      this._writeString(startX + 2, y, clean + " ".repeat(pad), contentStyle);
      this._writeString(startX, y, "│", borderStyle);
      this._writeString(startX + bubbleW - 1, y, "│", borderStyle);
      y++;
    }

    if (y < this.renderer.screen.getRows() - 3) {
      this._clearLine(y, canvasBg);
      this._writeString(startX, y, "╰" + "─".repeat(bubbleW - 2) + "╯", borderStyle);
      y++;
    }

    return y + 1;
  }

  private _drawThinkingBlock(y: number, cols: number, content: string, isCollapsed: boolean, timestamp: string, opts?: { animFrame?: number }): number {
    const cx = 2;
    const cw = Math.min(cols - 4, 110);
    const gutterX = cx + 1;

    const canvasStyle = this._style({ bg: this.theme.tokens.canvas });
    const headerStyle = this._style({ fg: this.theme.tokens.muted, dim: true });
    const accentStyle = this._style({ fg: this.theme.tokens.accent });
    const dimStyle = this._style({ fg: this.theme.tokens.dim });

    if (y >= this.renderer.screen.getRows() - 3) return y;

    this._clearLine(y, canvasStyle);
    this._writeString(gutterX, y, "▎", accentStyle);
    const chevron = isCollapsed ? "▸" : "▾";
    this._writeString(gutterX + 2, y, `${chevron} Thinking  ${timestamp}`, headerStyle);

    const hint = isCollapsed ? "Enter to expand" : "Enter to collapse";
    const hintW = hint.length;
    this._writeString(cx + this._getContentWidth() - hintW - 2, y, hint, dimStyle);
    y++;

    if (!isCollapsed && content) {
      const safeContent = content ?? "";
      const innerW = cw - 4;
      const lines = this._wordWrap(safeContent, innerW);
      for (const line of lines) {
        if (y >= this.renderer.screen.getRows() - 3) break;
        this._clearLine(y, canvasStyle);
        this._writeString(gutterX, y, "▎", accentStyle);
        this._writeString(gutterX + 2, y, line, this._style({ fg: this.theme.tokens.inkSecondary, italic: true }));
        y++;
      }
    }

    return y + 1;
  }

  private _drawAgentActivity(y: number, cols: number, tracker: AgentTracker): number {
    const cx = 3;
    const cw = Math.min(cols - 6, 110);

    const canvasStyle = this._style({ bg: this.theme.tokens.canvas });
    const accentStyle = this._style({ fg: this.theme.tokens.accent, bold: true });
    const runningStyle = this._style({ fg: this.theme.tokens.agentRunning });
    const mutedStyle = this._style({ fg: this.theme.tokens.muted });
    const dimStyle = this._style({ fg: this.theme.tokens.dim });
    const borderStyle = this._style({ fg: this.theme.tokens.hairline });

    const frame = this.frameCounter;
    const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    const dot = DOT_FRAMES[Math.floor(frame / 4) % DOT_FRAMES.length];

    if (y >= this.renderer.screen.getRows() - 3) return y;
    this._clearLine(y, canvasStyle);
    this._writeString(cx, y, ` ${spinner} ${tracker.name} `, accentStyle);
    this._writeString(cx + 20, y, dot, runningStyle);
    this._writeString(cx + 24, y, ` ${tracker.task.slice(0, 50)}`, mutedStyle);
    y++;

    const verbLine = tracker.currentTool ? ` ${tracker.currentTool} ` : " working ";
    if (y < this.renderer.screen.getRows() - 3) {
      this._clearLine(y, canvasStyle);
      this._writeString(cx + 2, y, verbLine, this._style({ fg: this.theme.tokens.accent, bg: this._adjustColor(this.theme.tokens.accent, 0.1) }));
      y++;
    }

    if (tracker.outputLines.length > 0 && y < this.renderer.screen.getRows() - 3) {
      const last = tracker.outputLines[tracker.outputLines.length - 1];
      this._clearLine(y, canvasStyle);
      this._writeString(cx + 2, y, ` ${last.slice(0, this._getContentWidth() - 8)}`, dimStyle);
      y++;
    }

    if (y < this.renderer.screen.getRows() - 3) {
      this._clearLine(y, canvasStyle);
      this._writeString(cx, y, "╰" + "─".repeat(cw - 2) + "╯", borderStyle);
      y++;
    }

    return y;
  }

  private _drawAgentCard(y: number, cols: number, tracker: AgentTracker): number {
    const cx = 3;
    const cw = Math.min(cols - 6, 110);

    const statusColors: Record<string, string> = {
      success: this.theme.tokens.success,
      error: this.theme.tokens.error,
      warning: this.theme.tokens.warning,
      pending: this.theme.tokens.muted,
    };
    const statusIcons: Record<string, string> = {
      success: "✓",
      error: "✕",
      warning: "⚠",
      pending: "○",
    };
    const color = statusColors[tracker.status] || this.theme.tokens.muted;
    const icon = statusIcons[tracker.status] || "○";

    const canvasStyle = this._style({ bg: this.theme.tokens.canvas });
    const cardStyle = this._style({ bg: this.theme.tokens.surface });
    const borderStyle = this._style({ fg: this.theme.tokens.border });
    const titleStyle = this._style({ fg: this.theme.tokens.ink, bold: true });
    const statusStyle = this._style({ fg: color, bold: true });
    const metaStyle = this._style({ fg: this.theme.tokens.muted });
    const dimStyle = this._style({ fg: this.theme.tokens.dim });

    if (y >= this.renderer.screen.getRows() - 3) return y;
    this._clearLine(y, canvasStyle);
    this._writeString(cx, y, "╭" + "─".repeat(cw - 2) + "╮", borderStyle);
    y++;

    if (y < this.renderer.screen.getRows() - 3) {
      this._clearLine(y, cardStyle);
      this._writeString(cx + 1, y, ` ${icon} ${tracker.name} `, titleStyle);
      this._writeString(cx + cw - 2 - tracker.status.length - 4, y, ` ${tracker.status} `, statusStyle);
      this._writeString(cx, y, "│", borderStyle);
      this._writeString(cx + cw - 1, y, "│", borderStyle);
      y++;
    }

    if (tracker.toolCallCount > 0 && y < this.renderer.screen.getRows() - 3) {
      this._clearLine(y, cardStyle);
      this._writeString(cx + 2, y, ` ${tracker.toolCallCount} tool calls  ·  ${this._elapsed(tracker.startTime)}`, metaStyle);
      this._writeString(cx, y, "│", borderStyle);
      this._writeString(cx + cw - 1, y, "│", borderStyle);
      y++;
    }

    if (tracker.outputLines.length > 0 && y < this.renderer.screen.getRows() - 3) {
      this._clearLine(y, cardStyle);
      const last = tracker.outputLines[tracker.outputLines.length - 1];
      this._writeString(cx + 2, y, ` ${last.slice(0, this._getContentWidth() - 8)}`, dimStyle);
      this._writeString(cx, y, "│", borderStyle);
      this._writeString(cx + cw - 1, y, "│", borderStyle);
      y++;
    }

    if (y < this.renderer.screen.getRows() - 3) {
      this._clearLine(y, canvasStyle);
      this._writeString(cx, y, "╰" + "─".repeat(cw - 2) + "╯", borderStyle);
      y++;
    }

    return y;
  }

  private _drawInputArea(y: number, contentWidth: number): void {
    const rows = this.renderer.screen.getRows();
    const cx = 2;
    const cw = contentWidth;

    const canvasStyle = this._style({ bg: this.theme.tokens.canvas });
    const borderStyle = this._style({ fg: this.theme.tokens.border });
    const focusBorderStyle = this._style({ fg: this.theme.tokens.accent });
    const promptStyle = this._style({ fg: this.theme.tokens.accent, bold: true });
    const textStyle = this._style({ fg: this.theme.tokens.ink });
    const hintStyle = this._style({ fg: this.theme.tokens.dim });
    const cursorStyle = this._style({ inverse: true, fg: this.theme.tokens.ink, bg: this.theme.tokens.accent });
    const inputBgStyle = this._style({ bg: this.theme.tokens.surface });

    const isFocused = this.active;
    const bStyle = isFocused ? focusBorderStyle : borderStyle;

    if (y >= rows - 2) return;
    this._clearLine(y, canvasStyle);
    this._writeString(cx, y, "╭" + "─".repeat(cw - 2) + "╮", bStyle);
    y++;

    if (y >= rows - 1) return;
    this._clearLine(y, inputBgStyle);
    this._writeString(cx + 1, y, " ", inputBgStyle);
    this._writeString(cx + 2, y, ">", promptStyle);
    this._writeString(cx + 4, y, " ", inputBgStyle);

    const maxInputW = cw - 8;
    const displayText = this.inputText.slice(-maxInputW);
    this._writeString(cx + 5, y, displayText, textStyle);

    const cursorX = cx + 5 + Math.min(this.cursorPos, maxInputW);
    if (cursorX < cx + cw - 2 && this.vimMode === "insert") {
      const char = this.inputText[this.cursorPos] || " ";
      this._writeString(cursorX, y, char, cursorStyle);
    }

    this._writeString(cx, y, "│", bStyle);
    this._writeString(cx + cw - 1, y, "│", bStyle);
    y++;

    if (y < rows - 1) {
      this._clearLine(y, canvasStyle);
      this._writeString(cx, y, "╰" + "─".repeat(cw - 2) + "╯", bStyle);
      const hint = this.vimMode === "normal" ? " i: insert  ·  /: search  ·  ?: help " : " Esc: normal  ·  ↑↓: history  ·  Enter: send ";
      this._writeString(cx + 2, y, hint, hintStyle);
    }
  }

  private _drawStatusBar(y: number, cols: number): void {
    const canvasStyle = this._style({ bg: this.theme.tokens.canvas });
    const surfaceStyle = this._style({ bg: this.theme.tokens.surface });
    const dimStyle = this._style({ fg: this.theme.tokens.dim });
    const mutedStyle = this._style({ fg: this.theme.tokens.muted });
    const accentStyle = this._style({ fg: this.theme.tokens.accent, bold: true });
    const runningStyle = this._style({ fg: this.theme.tokens.agentRunning, bold: true });

    const runningCount = Array.from(this.trackers.values()).filter(t => t.status === "running" || t.status === "calling_tool").length;

    this._clearLine(y, surfaceStyle);

    let x = 2;
    this._writeString(x, y, "│", dimStyle);
    x += 2;

    if (runningCount > 0) {
      const spinner = SPINNER_FRAMES[this.frameCounter % SPINNER_FRAMES.length];
      this._writeString(x, y, `${spinner} ${runningCount} agent${runningCount > 1 ? "s" : ""} running`, runningStyle);
      x += 20 + String(runningCount).length;
      this._writeString(x, y, "│", dimStyle);
      x += 2;
    } else {
      this._writeString(x, y, "○ idle", mutedStyle);
      x += 7;
      this._writeString(x, y, "│", dimStyle);
      x += 2;
    }

    if (this.vimMode === "normal") {
      this._writeString(x, y, " NORMAL ", this._style({ fg: this.theme.tokens.warning, bold: true, inverse: true }));
      x += 9;
      this._writeString(x, y, "│", dimStyle);
      x += 2;
    }

    const memText = `mem:${this.memoryCount}`;
    this._writeString(x, y, memText, mutedStyle);
    x += memText.length + 2;
    this._writeString(x, y, "│", dimStyle);
    x += 2;

    const vaultText = `vault:${this.vaultCount}`;
    this._writeString(x, y, vaultText, mutedStyle);
    x += vaultText.length + 2;

    const sizeStr = ` ${cols}x${this.renderer.screen.getRows()} `;
    this._writeString(cols - sizeStr.length - 2, y, sizeStr, dimStyle);
  }

  private _elapsed(ms: number): string {
    const sec = Math.floor((Date.now() - ms) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  private _adjustColor(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const bg = this.theme.background === "dark" ? 0x0d0d0d : 0xffffff;
    const br = (bg >> 16) & 0xff;
    const bgG = (bg >> 8) & 0xff;
    const bb = bg & 0xff;
    const nr = Math.round(r * alpha + br * (1 - alpha));
    const ng = Math.round(g * alpha + bgG * (1 - alpha));
    const nb = Math.round(b * alpha + bb * (1 - alpha));
    return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
  }

  private _hexToRgb(hex: string): [number, number, number] {
    const clean = hex.startsWith("#") ? hex.slice(1) : hex;
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }

  private _rgbToHex(r: number, g: number, b: number): string {
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  private _measureWidth(text: string): number {
    return text.replace(/\x1b\[[0-9;]*m/g, "").length;
  }

  private _wordWrap(text: string, width: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if ((current + word).length > width) {
        lines.push(current.trim());
        current = word;
      } else {
        current += (current ? " " : "") + word;
      }
    }
    if (current) lines.push(current.trim());
    return lines.length ? lines : [""];
  }

  private _handleInput(data: string): void {
    this.lastInputTime = Date.now();
    for (const ch of data) {
      if (ch === "\x1b") {
        this._handleEscape(data);
        break;
      } else if (ch === "\r" || ch === "\n") {
        this._handleEnter();
      } else if (ch === "\x7f" || ch === "\b") {
        this._handleBackspace();
      } else if (ch >= " " && ch <= "~") {
        this._handleChar(ch);
      }
    }
    this.requestRender();
  }

  private _handleEscape(data: string): void {
    if (data.startsWith("\x1b[")) {
      const seq = data.slice(2);
      if (seq.startsWith("A")) this._historyUp();
      else if (seq.startsWith("B")) this._historyDown();
      else if (seq.startsWith("C")) this._cursorRight();
      else if (seq.startsWith("D")) this._cursorLeft();
      else if (seq.startsWith("H")) this._cursorHome();
      else if (seq.startsWith("F")) this._cursorEnd();
      else if (seq.startsWith("3~")) this._handleDelete();
    } else if (data === "\x1b") {
      this.vimMode = this.vimMode === "insert" ? "normal" : "insert";
    }
  }

  private _handleEnter(): void {
    if (this.vimMode === "normal") {
      this.vimMode = "insert";
      return;
    }
    const text = this.inputText.trim();
    if (text) {
      this.inputHistory.unshift(text);
      if (this.inputHistory.length > 100) this.inputHistory.pop();
      this.historyIndex = -1;
      this.inputText = "";
      this.cursorPos = 0;
      this._onSubmit?.(text);
    }
  }

  private _handleBackspace(): void {
    if (this.cursorPos > 0) {
      this.inputText = this.inputText.slice(0, this.cursorPos - 1) + this.inputText.slice(this.cursorPos);
      this.cursorPos--;
    }
  }

  private _handleDelete(): void {
    if (this.cursorPos < this.inputText.length) {
      this.inputText = this.inputText.slice(0, this.cursorPos) + this.inputText.slice(this.cursorPos + 1);
    }
  }

  private _handleChar(ch: string): void {
    if (this.vimMode === "normal") {
      if (ch === "i") this.vimMode = "insert";
      else if (ch === "?") this.showHelp = !this.showHelp;
      return;
    }
    this.inputText = this.inputText.slice(0, this.cursorPos) + ch + this.inputText.slice(this.cursorPos);
    this.cursorPos++;
  }

  private _cursorLeft(): void { if (this.cursorPos > 0) this.cursorPos--; }
  private _cursorRight(): void { if (this.cursorPos < this.inputText.length) this.cursorPos++; }
  private _cursorHome(): void { this.cursorPos = 0; }
  private _cursorEnd(): void { this.cursorPos = this.inputText.length; }
  private _historyUp(): void {
    if (this.historyIndex < this.inputHistory.length - 1) {
      this.historyIndex++;
      this.inputText = this.inputHistory[this.historyIndex];
      this.cursorPos = this.inputText.length;
    }
  }
  private _historyDown(): void {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.inputText = this.inputHistory[this.historyIndex];
      this.cursorPos = this.inputText.length;
    } else if (this.historyIndex === 0) {
      this.historyIndex = -1;
      this.inputText = "";
      this.cursorPos = 0;
    }
  }
}