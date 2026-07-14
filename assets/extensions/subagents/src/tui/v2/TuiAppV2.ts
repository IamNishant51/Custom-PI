import { ScreenRenderer } from "./renderer/ScreenRenderer";
import { TerminalScreen } from "./renderer/TerminalScreen";
import { CellBuffer } from "./renderer/TerminalScreen";
import { StylePool } from "./renderer/StylePool";
import { AdaptiveTheme, createTheme, AdaptiveThemeOptions } from "./theme/AdaptiveTheme";

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
  private idleFps = 10;
  private rendering = false;
  private messageLogVersion = 0;
  private lastMessageCount = -1;
  private _onSubmit: ((text: string) => void) | null = null;
  private ctx?: any;
  private pi?: any;

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

  start(): void {
    if (this.active) return;
    this.active = true;
    this.renderer.start(true);
    
    this.stdinHandler = (data: Buffer) => this._handleInput(data.toString());
    process.stdin.on("data", this.stdinHandler);
    
    this._renderLoop();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.rendering = false;
    if (this.stdinHandler) {
      process.stdin.off("data", this.stdinHandler);
      this.stdinHandler = undefined;
    }
    this.renderer.stop();
  }

  updateTracker(id: string, data: Partial<AgentTracker>): void {
    const existing = this.trackers.get(id) || {
      id, name: "", task: "", status: "pending", turn: 0, maxTurns: 15,
      toolCallCount: 0, startTime: Date.now(), outputLines: [],
    };
    Object.assign(existing, data);
    this.trackers.set(id, existing);
    this._requestFrame();
  }

  removeTracker(id: string): void {
    this.trackers.delete(id);
    this._requestFrame();
  }

  addMessage(role: string, content: string): void {
    this.messageLog.push({ role: role as any, content, timestamp: Date.now() });
    this._requestFrame();
  }

  setMemoryCount(n: number): void { this.memoryCount = n; }
  setVaultCount(n: number): void { this.vaultCount = n; }

  private _requestFrame(): void {}

  private _renderLoop(): void {
    if (!this.active) return;
    
    const now = Date.now();
    const idleTime = now - this.lastInputTime;
    
    if (idleTime > 5000 && this.trackers.size === 0) {
      if (now - this.lastRenderTime < 1000 / 10) {
        setTimeout(() => this._renderLoop(), 16);
        return;
      }
    }

    try {
      this._renderFrame();
      this.lastRenderTime = now;
    } catch (err: any) {
      console.error("[TuiAppV2] Render error:", err.message);
    }

    setTimeout(() => this._renderLoop(), 16);
  }

  private _renderFrame(): void {
    if (this.rendering) return;
    this.rendering = true;

    try {
      this._doRender();
      this.renderer.render();
    } finally {
      this.rendering = false;
    }
  }

  private _doRender(): void {
    const cols = this.renderer.screen.getCols();
    const rows = this.renderer.screen.getRows();
    
    if (cols < 60 || rows < 16) return;

    this._syncMessages();

    const runningCount = Array.from(this.trackers.values()).filter(
      t => t.status === "running" || t.status === "calling_tool"
    ).length;

    const defaultStyle = this._style({ bg: this.theme.tokens.canvas });
    let currentMaxY = 0;

    const statusBarY = rows - 1;
    const inputAreaY = statusBarY - 3;
    const maxContentBottom = inputAreaY - 1;

    let y = 0;

    if (runningCount > 0) {
      y = 1;
    }

    y = this._drawBanner(y);

    const header = {
      modelName: this.sessionModel,
      sessionId: this.sessionId,
      contextPercent: Math.min(100, Math.round((this.messageLog.length / this.messageLimit) * 100)),
      messageCount: this.messageLog.length,
    };
    y = this._drawHeader(y, header);

    const totalVisible = this.messageLog.length;
    const olderCount = Math.max(0, totalVisible - 10 - this.scrollOffset);
    y = this._drawScrollIndicator(y, { visible: olderCount > 0, olderCount, newerCount: this.scrollOffset });

    const maxMessages = Math.max(1, maxContentBottom - y - 2);
    const visibleMessages = this.messageLog.slice(-maxMessages);
    this.renderedElements = [];

    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      const startY = y;
      const ts = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      if (msg.role === "thinking") {
        const isCollapsed = this.collapsedThinkingIndices.has(i);
        y = this._drawThinkingBlock(y, this.renderer.screen.getCols(), msg.content.slice(0, 300), isCollapsed, ts, {
          animFrame: this.frameCounter,
        });
      } else {
        y = this._drawMessageBubble(y, this.renderer.getScreen().getCols(), msg.role, msg.content.slice(0, 300), ts, {
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
        const pulseBox = this._drawPulseBorderBox(y, tracker.name);
        y = pulseBox.y;
        const cx = this._getContentLeft();
        const verbLine = `${tracker.currentTool || "working"}...  ${tracker.toolCallCount > 0 ? `${tracker.toolCallCount} tool calls` : ""}`.trim();
        this._clearLine(y, defaultStyle);
        this._writeString(cx + 2, y, `  ${verbLine}`, this._style({ fg: this.theme.tokens.muted }));
        y++;
        if (tracker.outputLines.length > 0) {
          const last = tracker.outputLines[tracker.outputLines.length - 1];
          this._clearLine(y, defaultStyle);
          this._writeString(cx + 2, y, `  ${last.slice(0, this._getContentWidth() - 12)}`, this._style({ fg: this.theme.tokens.dim, dim: true }));
          y++;
        }
        const bStyle = this._style({ fg: this.theme.tokens.hairline });
        this._clearLine(y, defaultStyle);
        this._writeString(cx, y, "╰" + "─".repeat(this._getContentWidth() - 2) + "╯", bStyle);
        y++;
      } else {
        y = this._drawAgentCard(y, tracker.name, tracker.status, {
          verb: running ? tracker.currentTool : undefined,
          toolCalls: tracker.toolCallCount > 0 ? `${tracker.toolCallCount} tool calls` : undefined,
          outputLines: tracker.outputLines,
          duration: this._elapsed(tracker.startTime),
          animate: running,
        });
      }
      y += 1;
    }

    if (inputAreaY < statusBarY) {
      this._drawInputArea(inputAreaY, this._getContentWidth(), this.inputText, this.cursorPos, this._getVimMode());
    }

    if (statusBarY < rows) {
      if (runningCount > 0) {
        this._drawPulseInStatusBar(statusBarY, `agents: ${runningCount}`);
      } else {
        this._drawStatusBar(statusBarY, {
          vimMode: this._getVimMode(),
          memoryCount: this.memoryCount,
          vaultCount: this.vaultCount,
          agentStatus: "○ idle",
        });
      }
    }

    currentMaxY = y;

    if (this.lastRenderMaxY > currentMaxY) {
      for (let ry = currentMaxY; ry < this.lastRenderMaxY && ry < rows; ry++) {
        this._clearLine(ry, defaultStyle);
      }
    }
    this.lastRenderMaxY = currentMaxY;

    this.renderer.render();
  }

  private _style(def: any): number {
    const defObj = def as { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; inverse?: boolean; strikethrough?: boolean };
    return this.renderer.style(defObj);
  }

  private _writeString(x: number, y: number, text: string, style: number): void {
    this.renderer.screen.writeString(x, y, text, style);
  }

  private _clearLine(y: number, style: number): void {
    this.renderer.screen.clearLine(y, style);
  }

  private _getContentLeft(): number {
    return 2;
  }

  private _getContentWidth(): number {
    return this.renderer.contentWidth;
  }

  private _drawBanner(y: number): number {
    const banner = [
      "  ██████╗ ██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ███╗      ██████╗ ██╗",
      " ██╔════╝ ██║   ██║██╔════╝ ╚══██╔══╝██╔═══██╗████╗ ████║      ██╔══██╗██║",
      " ██║      ██║   ██║╚██████╗    ██║   ██║   ██║██╔████╔██║█████╗██████╔╝██║",
      " ██║      ██║   ██║ ╚═══██║    ██║   ██║   ██║██║╚██╔╝██║╚════╝██╔═══╝ ██║",
      " ╚██████╗ ╚██████╔╝██████╔╝    ██║   ╚██████╔╝██║ ╚═╝ ██║      ██║     ██║",
      "  ╚═════╝  ╚═════╝ ╚═════╝     ╚═╝    ╚═════╝ ╚═╝     ╚═╝      ╚═╝     ╚═╝",
    ];
    const cols = this.renderer.screen.getCols();
    const colors = this.theme.tokens.banner || ["#ff0087", "#ff00ff", "#af5fff", "#5f00ff", "#00ffff", "#00d7ff"];
    const canvasStyle = this._style({ bg: this.theme.tokens.canvas });

    const showFull = cols >= 80;
    const displayBanner = showFull ? banner : banner.map(l => l.slice(0, Math.floor(cols * 0.6)));

     for (let i = 0; i < displayBanner.length; i++) {
      const line = displayBanner[i];
      const color = colors[i] || colors[colors.length - 1];
      const s = this._style({ fg: color });
      const lineY = y + i;
      this._clearLine(lineY, this._style({ bg: this.theme.tokens.canvas }));
      const x = 2;
      this._writeString(x, lineY, line, this._style({ fg: color }));
    }
    return y + displayBanner.length + 1;
  }

  private _drawHeader(y: number, header: { modelName: string; sessionId: string; contextPercent: number; messageCount: number }): number {
    const cols = this.renderer.screen.getCols();
    if (y >= this.renderer.screen.getRows()) return y;

    const bgStyle = this._style({ bg: this.theme.tokens.surface });
    const accentStyle = this._style({ fg: this.theme.tokens.accent, bold: true });
    const mutedStyle = this._style({ fg: this.theme.tokens.muted });
    const dimStyle = this._style({ fg: this.theme.tokens.dim });

    this._clearLine(y, this._style({ bg: this.theme.tokens.surface }));

    const modelTag = ` ${header.modelName} `;
    this._writeString(2, y, modelTag, accentStyle);

    const sepX = 2 + modelTag.length + 1;
    this._writeString(sepX, y, "│", this._style({ fg: this.theme.tokens.dim }));

    const sessionText = ` ${header.sessionId.slice(0, 12)} `;
    const sessX = sepX + 2;
    this._writeString(sessX, y, sessionText, mutedStyle);

    const barW = 16;
    const barX = cols - barW - 2 - 10;
    const filled = Math.round((header.contextPercent / 100) * barW);
    const ctxColor = header.contextPercent > 80 ? this.theme.tokens.warning :
      header.contextPercent > 50 ? this.theme.tokens.accent : this.theme.tokens.success;
    const ctxStyle = this._style({ fg: ctxColor });
    const bar = "█".repeat(filled) + "░".repeat(barW - filled);
    this._writeString(barX, y, `ctx ${bar}`, ctxStyle);

    const msgText = ` ${header.messageCount} msgs `;
    this._writeString(cols - 2 - msgText.length, y, msgText, mutedStyle);

    return y + 1;
  }

  private _drawScrollIndicator(y: number, opts: { visible: boolean; olderCount: number; newerCount: number }): number {
    const cols = this.renderer.screen.getCols();
    if (y >= this.renderer.screen.getRows()) return y;

    const bgStyle = this._style({ bg: this.theme.tokens.canvas });
    const muteStyle = this._style({ fg: this.theme.tokens.muted, dim: true });

    this._clearLine(y, bgStyle);

    if (opts.olderCount > 0) {
      const text = ` ↑ ${opts.olderCount} older messages ↑ `;
      const x = Math.floor((cols - text.length) / 2);
      this._writeString(x, y, text, muteStyle);
    }

    return y + 1;
  }

  private _drawMessageBubble(y: number, width: number, role: string, content: string, timestamp: string, opts?: {
    toolCalls?: number;
    duration?: string;
    agentName?: string;
    isStreaming?: boolean;
    animFrame?: number;
    modelName?: string;
  }): number {
    const cols = this.renderer.screen.getCols();
    const cx = 2;
    const cw = Math.min(cols - 4, 100);
    const isUser = role === "user";

    const badgeColor = opts?.agentColor || (isUser ? this.theme.tokens.accent : this.theme.tokens.info);
    const borderColor = isUser ? this.theme.tokens.userBubbleBorder : this.theme.tokens.assistantBubbleBorder;
    const bgColor = isUser ? this.theme.tokens.userBubble : this.theme.tokens.card;

    const canvasBg = this._style({ bg: this.theme.tokens.canvas });
    const bStyle = this._style({ fg: borderColor });
    const badgeStyle = this._style({ fg: badgeColor, bold: true });
    const headerStyle = this._style({ fg: this.theme.tokens.muted, dim: true });
    const contentStyle = this._style({ fg: this.theme.tokens.ink });
    const bubbleBg = this._style({ bg: bgColor });

    const badgeSym = isUser ? "◆" : "■";
    const name = isUser ? "You" : (opts?.agentName || "Assistant");
    const modelTag = (!isUser && opts?.modelName) ? ` │ ${opts.modelName}` : "";

    const metaParts: string[] = [];
    if (opts?.toolCalls !== undefined) metaParts.push(`tools:${opts.toolCalls}`);
    if (opts?.duration) metaParts.push(opts.duration);
    if (opts?.isStreaming) metaParts.push(this._streamDot(opts?.animFrame ?? 0));
    const metaStr = metaParts.length > 0 ? `  ·  ${metaParts.join("  ·  ")}` : "";

    const identityStr = `${badgeSym} ${name}${modelTag}`;
    const identityW = this._measureWidth(identityStr);

    const maxContentW = Math.min(cw - 4, 80);
    const innerWrapW = Math.max(16, maxContentW - 4);
    const lines = this._wordWrap(content, innerWrapW);
    let maxLineW = 0;
    for (const line of lines) {
      const lineW = this._measureWidth(line.trimEnd());
      if (lineW > maxLineW) maxLineW = lineW;
    }

    const headerTotalW = identityW + this._measureWidth(metaStr) + timestamp.length + 4;
    const bubbleW = Math.min(maxContentW, Math.max(headerTotalW + 2, maxLineW + 8));
    const startX = isUser ? 2 + cw - bubbleW - 1 : 2 + 1;

    if (y >= this.renderer.screen.getRows() - 2) return y;

    this._clearLine(y, this._style({ bg: this.theme.tokens.canvas }));
    this._writeString(startX, y, "╭" + "─".repeat(bubbleW - 2) + "╮", this._style({ fg: borderColor }));
    y++;

    if (y >= this.renderer.screen.getRows() - 2) return y;
    this._clearLine(y, this._style({ bg: isUser ? this.theme.tokens.userBubble : this.theme.tokens.card }));

    this._writeString(startX + 1, y, badgeSym, this._style({ fg: badgeColor, bold: true }));
    this._writeString(startX + 3, y, name, this._style({ fg: badgeColor, bold: true }));
    if (opts?.modelName && !isUser) {
      this._writeString(startX + 3 + name.length + 1, y, ` │ ${opts.modelName}`, this._style({ fg: this.theme.tokens.muted, dim: true }));
    }

    const rightContent = metaStr ? `${metaStr}  ${timestamp}` : timestamp;
    const rightW = rightContent.length;
    const rightX = startX + bubbleW - 1 - rightW;
    if (rightX > startX + 3 + identityW + 2) {
      this._writeString(rightX, y, rightContent, this._style({ fg: this.theme.tokens.muted, dim: true }));
    }

    this._writeString(startX, y, "│", this._style({ fg: borderColor }));
    this._writeString(startX + bubbleW - 1, y, "│", this._style({ fg: borderColor }));
    y++;

    for (const line of lines) {
      if (y >= this.renderer.screen.getRows() - 2) break;
      this._clearLine(y, this._style({ bg: isUser ? this.theme.tokens.userBubble : this.theme.tokens.card }));
      const clean = line.trimEnd();
      const visibleLen = this._measureWidth(clean.replace(/\x1b\[[0-9;]*m/g, ""));
      const pad = Math.max(0, bubbleW - 4 - visibleLen);
      this._writeString(startX + 2, y, clean + " ".repeat(pad), this._style({ fg: this.theme.tokens.ink }));
      this._writeString(startX, y, "│", this._style({ fg: borderColor }));
      this._writeString(startX + bubbleW - 1, y, "│", this._style({ fg: borderColor }));
      y++;
    }

    if (y < this.renderer.screen.getRows() - 2) {
      this._clearLine(y, this._style({ bg: this.theme.tokens.canvas }));
      this._writeString(startX, y, "╰" + "─".repeat(bubbleW - 2) + "╯", this._style({ fg: borderColor }));
      y++;
    }

    return y + 1;
  }

  private _drawThinkingBlock(y: number, width: number, content: string, isCollapsed: boolean, timestamp: string, opts?: { animFrame?: number }): number {
    const cx = 2;
    const cw = Math.min(width - 4, 100);
    const gutterX = cx + 1;

    const canvasStyle = this._style({ bg: this.theme.tokens.canvas });
    const headerStyle = this._style({ fg: this.theme.tokens.muted, dim: true });
    const contentStyle = this._style({ fg: this.theme.tokens.muted, italic: true });

    const frame = opts?.animFrame ?? 0;
    const shimmerT = Math.sin(frame * 0.08) * 0.5 + 0.5;
    const baseRgb = this._hexToRgb(this.theme.tokens.accent);
    const warnRgb = this._hexToRgb(this.theme.tokens.warning);
    const mixRgb: [number, number, number] = [
      Math.round(baseRgb[0] + (warnRgb[0] - baseRgb[0]) * shimmerT),
      Math.round(baseRgb[1] + (warnRgb[1] - baseRgb[1]) * shimmerT),
      Math.round(baseRgb[2] + (warnRgb[2] - baseRgb[2]) * shimmerT),
    ];
    const accentHex = this._rgbToHex(...mixRgb);
    let accentStyle: number;
    if (this.theme.truecolor) {
      accentStyle = this._style({ fg: accentHex });
    } else {
      accentStyle = this._style({ fg: accentHex });
    }

    if (y >= this.renderer.screen.getRows() - 2) return y;

    this._clearLine(y, canvasStyle);
    this._writeString(gutterX, y, "▌", accentStyle);
    const chevron = isCollapsed ? "▸" : "▾";
    const headerText = `${chevron} Reasoning  ${timestamp}`;
    this._writeString(gutterX + 2, y, headerText, headerStyle);

    const hint = isCollapsed ? "click to expand" : "click to collapse";
    const hintW = hint.length;
    this._writeString(cx + this._getContentWidth() - hintW - 2, y, hint, this._style({ fg: this.theme.tokens.dim, dim: true }));

    y++;

    if (!isCollapsed && content) {
      const innerW = cw - 4;
      const lines = this._wordWrap(content, innerW);
      for (const line of lines) {
        if (y >= this.renderer.screen.getRows() - 2) break;
        this._clearLine(y, canvasStyle);
        this._writeString(gutterX, y, "▌", accentStyle);
        this._writeString(gutterX + 2, y, line, contentStyle);
        y++;
      }
    }
    return y;
  }

  private _drawAgentCard(y: number, name: string, status: string, opts?: {
    verb?: string;
    toolCalls?: string;
    outputLines?: string[];
    duration?: string;
    animate?: boolean;
    animFrame?: number;
  }): number {
    const cx = 2;
    const cw = this._getContentWidth();
    const w = Math.min(cw, this.renderer.screen.getCols() - cx - 2);
    const isRunning = status === "running" || status === "calling_tool";
    const isSuccess = status === "success" || status === "complete";
    const isError = status === "error";
    let borderColor = isError ? this.theme.tokens.error : isSuccess ? this.theme.tokens.success : isRunning ? this.theme.tokens.agentRunning : this.theme.tokens.agentWaiting;
    if (isRunning && opts?.animate && opts?.animFrame !== undefined) {
      const t = Math.sin(opts.animFrame * 0.06) * 0.5 + 0.5;
      const base = this._hexToRgb(this.theme.tokens.agentRunning);
      const bright = this._hexToRgb(this.theme.tokens.warning);
      const mix: [number, number, number] = [
        Math.round(base[0] + (bright[0] - base[0]) * t),
        Math.round(base[1] + (bright[1] - base[1]) * t),
        Math.round(base[2] + (bright[2] - base[2]) * t),
      ];
      borderColor = this._rgbToHex(...mix);
    }
    const bStyle = this._style({ fg: borderColor });
    const cardBgStyle = this._style({ bg: this.theme.tokens.card });
    const nameStyle = this._style({ fg: this.theme.tokens.ink, bold: true });
    const verbStyle = this._style({ fg: this.theme.tokens.muted });
    const metaStyle = this._style({ fg: this.theme.tokens.muted, dim: true });
    const outputStyle = this._style({ fg: borderColor, dim: true });
    const canvasStyle = this._style({ bg: this.theme.tokens.canvas });

    const icon = isError ? "✗" : isSuccess ? "✓" : isRunning ? "●" : "○";
    const iconColor = isError ? this.theme.tokens.error : isSuccess ? this.theme.tokens.success : isRunning ? this.theme.tokens.agentRunning : this.theme.tokens.agentWaiting;
    const iconStyle = this._style({ fg: iconColor });

    if (y >= this.renderer.screen.getRows() - 2) return y;

    this._clearLine(y, canvasStyle);
    this._writeString(cx, y, "╭─", bStyle);
    this._writeString(cx + 2, y, icon, this._style({ fg: iconColor }));
    this._writeString(cx + 4, y, ` ${name} `, this._style({ fg: this.theme.tokens.ink, bold: true }));
    const dur = opts?.duration ? ` ⧗ ${opts.duration}` : "";
    const rightStart = cx + w - dur.length - 2;
    this._writeString(rightStart, y, dur, this._style({ fg: this.theme.tokens.muted, dim: true }));
    this._writeString(cx + w - 1, y, "─╮", bStyle);
    y++;

    if (y >= this.renderer.screen.getRows() - 2) return y;

    this._clearLine(y, this._style({ bg: this.theme.tokens.card }));
    this._writeString(cx, y, "│ ", bStyle);
    if (opts?.verb) {
      this._writeString(cx + 2, y, `${opts.verb}...`, this._style({ fg: this.theme.tokens.muted }));
    }
    if (opts?.toolCalls) {
      const tcX = cx + w - opts.toolCalls.length - 2;
      this._writeString(tcX, y, opts.toolCalls, this._style({ fg: this.theme.tokens.muted, dim: true }));
    }
    this._writeString(cx + w - 1, y, " │", bStyle);
    y++;

    if (opts?.outputLines && opts.outputLines.length > 0) {
      if (y >= this.renderer.screen.getRows() - 2) return y;
      this._clearLine(y, this._style({ bg: this.theme.tokens.card }));
      this._writeString(cx, y, "│", this._style({ fg: borderColor }));
      this._writeString(cx + 2, y, "─".repeat(Math.min(30, w - 8)), this._style({ fg: this.theme.tokens.dim }));
      this._writeString(cx + w - 1, y, "│", bStyle);
      y++;

      for (const ol of opts.outputLines.slice(-3)) {
        if (y >= this.renderer.screen.getRows() - 2) break;
        this._clearLine(y, this._style({ bg: this.theme.tokens.card }));
        this._writeString(cx, y, "│ ", bStyle);
        const trimmed = ol.length > w - 8 ? ol.slice(0, w - 12) + "…" : ol;
        this._writeString(cx + 2, y, trimmed, this._style({ fg: borderColor, dim: true }));
        this._writeString(cx + w - 1, y, " │", bStyle);
        y++;
      }
    }

    if (y < this.renderer.screen.getRows() - 2) {
      this._clearLine(y, canvasStyle);
      this._writeString(cx, y, "╰" + "─".repeat(w - 2) + "╯", bStyle);
      y++;
    }

    return y + 1;
  }

  private _drawPulseBorderBox(y: number, name: string): { y: number } {
    const cx = 2;
    const cw = this._getContentWidth();
    const w = Math.min(cw, this.renderer.screen.getCols() - cx - 2);
    const canvasStyle = this._style({ bg: this.theme.tokens.canvas });
    const bStyle = this._style({ fg: this.theme.tokens.agentRunning });
    const nameStyle = this._style({ fg: this.theme.tokens.ink, bold: true });
    const metaStyle = this._style({ fg: this.theme.tokens.muted, dim: true });

    if (y >= this.renderer.screen.getRows() - 2) return { y };

    this._clearLine(y, canvasStyle);
    this._writeString(cx, y, "╭─", bStyle);
    this._writeString(cx + 2, y, " ● ", this._style({ fg: this.theme.tokens.agentRunning }));
    this._writeString(cx + 6, y, ` ${name} `, nameStyle);
    this._writeString(cx + w - 1, y, "─╮", bStyle);
    y++;

    return { y };
  }

  private _drawInputArea(y: number, width: number, text: string, cursorPos: number, vimMode?: string): number {
    const cols = this.renderer.screen.getCols();
    const cx = 2;
    const cw = this._getContentWidth();
    const w = Math.min(cw, cols - cx - 2);

    const borderStyle = this._style({ fg: this.theme.tokens.hairline, dim: true });
    const inputStyle = this._style({ fg: this.theme.tokens.ink });
    const cursorStyle = this._style({ fg: this.theme.tokens.ink, bg: this.theme.tokens.accent });
    const canvasStyle = this._style({ bg: this.theme.tokens.canvas });
    const modeStyle = this._style({ fg: this.theme.tokens.muted, dim: true });
    const accentStyle = this._style({ fg: this.theme.tokens.accent, bold: true });
    const atStyle = this._style({ fg: this.theme.tokens.info });
    const slashStyle = this._style({ fg: this.theme.tokens.warning });
    const shellStyle = this._style({ fg: this.theme.tokens.error });

    if (y >= this.renderer.screen.getRows() - 3) return y;

    this._clearLine(y, canvasStyle);
    this._writeString(cx, y, "─".repeat(w), borderStyle);
    y++;

    const lines = text.split("\n");
    const visibleLines = lines.slice(-3);

    let cursorLine = 0;
    let cursorLineOffset = 0;
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i].length + 1;
      if (charCount + lineLen > cursorPos) {
        cursorLine = i;
        cursorLineOffset = cursorPos - charCount;
        break;
      }
      charCount += lineLen;
    }
    const lineOffset = Math.max(0, lines.length - 3);
    const visCursorLine = cursorLine - lineOffset;

    for (let li = 0; li < visibleLines.length; li++) {
      if (y >= this.renderer.screen.getRows() - 3) break;
      this._clearLine(y, canvasStyle);

      if (li === 0 && lineOffset === 0) {
        this._writeString(cx, y, "❯ ", accentStyle);
      } else {
        this._writeString(cx, y, "  ", this._style({ fg: this.theme.tokens.muted, dim: true }));
      }

      const lineText = visibleLines[li];
      const displayText = lineText.length > w - 3 ? lineText.slice(lineText.length - w + 3) : lineText;
      const startOffset = lineText.length > w - 3 ? lineText.length - w + 3 : 0;

      const writeStartX = cx + 2;

      for (let i = 0; i < displayText.length && i < w - 3; i++) {
        const globalI = startOffset + i;
        const ch = displayText[i];
        const isCursor = li === visCursorLine && globalI === cursorLineOffset;

        const entity = this._entityAt(text, globalI);
        let charStyle = inputStyle;
        if (entity.type === "at" && globalI >= entity.start && globalI <= entity.end) {
          charStyle = this._style({ fg: this.theme.tokens.info });
        } else if (entity.type === "slash" && globalI >= entity.start && globalI <= entity.end) {
          charStyle = this._style({ fg: this.theme.tokens.warning });
        } else if (entity.type === "shell") {
          charStyle = this._style({ fg: this.theme.tokens.error });
        }

        if (isCursor && vimMode === "insert") {
          this._writeString(writeStartX + i, y, ch, cursorStyle);
        } else {
          this._writeString(writeStartX + i, y, ch, charStyle);
        }
      }

      if (li === visCursorLine && cursorLineOffset >= lineText.length) {
        if (vimMode === "insert") {
          this._writeString(writeStartX + lineText.length - startOffset, y, " ", cursorStyle);
        } else {
          this._writeString(writeStartX + lineText.length - startOffset, y, "█", inputStyle);
        }
      }

      if (lineText.length === 0 && li === visCursorLine) {
        if (vimMode === "insert") {
          this._writeString(writeStartX, y, " ", cursorStyle);
        } else {
          this._writeString(writeStartX, y, "█", inputStyle);
        }
      }
      y++;
    }

    for (let li = visibleLines.length; li < 3; li++) {
      if (y >= this.renderer.screen.getRows() - 1) break;
      this._clearLine(y, canvasStyle);
      y++;
    }

    if (y < this.renderer.screen.getRows()) {
      this._clearLine(y, this._style({ bg: this.theme.tokens.surface }));
      if (vimMode) {
        const modeText = vimMode.toUpperCase();
        this._writeString(cx, y, ` ◆ ${modeText} `, vimMode === "insert" ? accentStyle : this._style({ fg: this.theme.tokens.muted, dim: true }));
        this._writeString(cx + 10, y, "│", this._style({ fg: this.theme.tokens.dim }));
      }

      if (text.split("\n").length > 1) {
        const lineCount = `${text.split("\n").length} lines`;
        const lcStyle = this._style({ fg: this.theme.tokens.textSecondary });
        this._writeString(cx + 14, y, lineCount, lcStyle);
        this._writeString(cx + 14 + lineCount.length + 1, y, "│", this._style({ fg: this.theme.tokens.dim }));
      }

      const hint = "⌘ Enter send";
      this._writeString(cx + cw - hint.length - 1, y, hint, this._style({ fg: this.theme.tokens.muted, dim: true }));
      y++;
    }

    return y;
  }

  private _drawStatusBar(y: number, opts?: { vimMode?: string; memoryCount?: number; vaultCount?: number; cost?: string; tokens?: string; agentStatus?: string }): number {
    const cols = this.renderer.screen.getCols();
    if (y >= this.renderer.screen.getRows()) return y;

    const bgStyle = this._style({ bg: this.theme.tokens.surface });
    const fgStyle = this._style({ fg: this.theme.tokens.muted });
    const dimStyle = this._style({ fg: this.theme.tokens.dim });

    this._clearLine(y, bgStyle);
    let x = 2;

    this._writeString(x, y, "│", dimStyle);
    x += 2;

    if (opts?.vimMode) {
      const modeColor = opts.vimMode === "insert" ? this.theme.tokens.accent : this.theme.tokens.muted;
      const ms = this._style({ fg: modeColor, bold: true });
      this._writeString(x, y, ` ${opts.vimMode.toUpperCase()} `, ms);
      x += ` ${opts.vimMode.toUpperCase()} `.length + 1;
      this._writeString(x, y, "│", dimStyle);
      x += 2;
    }

    if (opts?.agentStatus) {
      this._writeString(x, y, opts.agentStatus, fgStyle);
      x += opts.agentStatus.length + 2;
      this._writeString(x, y, "│", dimStyle);
      x += 2;
    }

    const storage: string[] = [];
    if (opts?.memoryCount !== undefined) storage.push(`mem:${opts.memoryCount}`);
    if (opts?.vaultCount !== undefined) storage.push(`vault:${opts.vaultCount}`);
    if (storage.length > 0) {
      this._writeString(x, y, storage.join("  ·  "), fgStyle);
      x += storage.join("  ·  ").length + 2;
      this._writeString(x, y, "│", dimStyle);
      x += 2;
    }

    if (opts?.cost) {
      this._writeString(x, y, opts.cost, fgStyle);
      x += opts.cost.length + 2;
    }

    const sizeStr = ` ${cols}x${this.renderer.screen.getRows()} `;
    this._writeString(cols - sizeStr.length - 2, y, sizeStr, dimStyle);

    return y + 1;
  }

  private _drawPulseInStatusBar(y: number, label: string, elapsed?: number): number {
    const cols = this.renderer.screen.getCols();
    if (y >= this.renderer.screen.getRows()) return y;

    const bgStyle = this._style({ bg: this.theme.tokens.surface });

    this._clearLine(y, bgStyle);

    const pulseStyle = this._style({ fg: this.theme.tokens.agentRunning, bold: true });
    this._writeString(2, y, ` ◆ ${label} `, pulseStyle);

    const sizeStr = ` ${cols}x${this.renderer.screen.getRows()} `;
    this._writeString(cols - sizeStr.length - 2, y, sizeStr, this._style({ fg: this.theme.tokens.dim }));

    return y + 1;
  }

  private _elapsed(ms: number): string {
    const sec = Math.floor((Date.now() - ms) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  private _entityAt(text: string, pos: number): { type: "at" | "slash" | "shell" | null; start: number; end: number } {
    if (pos < 0 || pos >= text.length) return { type: null, start: pos, end: pos };
    const atMatch = text.slice(0, pos + 1).match(/(?:^|\s)(@\w*)$/);
    if (atMatch) return { type: "at", start: pos - atMatch[1].length + 1, end: pos };
    const slashMatch = text.slice(0, pos + 1).match(/(?:^|\s)(\/\w*)$/);
    if (slashMatch) return { type: "slash", start: pos - slashMatch[1].length + 1, end: pos };
    if (text.charAt(0) === "!") return { type: "shell", start: 0, end: text.indexOf(" ") > 0 ? text.indexOf(" ") - 1 : text.length - 1 };
    return { type: null, start: pos, end: pos };
  }

  private _streamDot(frame: number): string {
    const dots = ["◐", "◓", "◑", "◒"];
    return dots[frame % dots.length];
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
    return lines;
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

  private _syncMessages(): void {
    if (!this.ctx?.sessionManager) return;
    const branch = this.ctx.sessionManager.getBranch();
    if (!branch) return;
    const messages = branch
      .filter((e: any) => e.type === "message")
      .map((e: any) => e.message);

    if (messages.length === this.lastMessageCount) return;
    this.lastMessageCount = messages.length;

    try {
      const newLogs: Message[] = [];
      for (const m of messages) {
        let contentStr = "";
        if (typeof m.content === "string") {
          contentStr = m.content;
        } else if (Array.isArray(m.content)) {
          contentStr = m.content
            .map((c: any) => {
              if (typeof c === "string") return c;
              if (c && typeof c === "object") {
                if (c.type === "text") return c.text || "";
              }
              return "";
            })
            .join("\n");
        }

        let thinkingContent = "";
        let textContent = contentStr;
        if (Array.isArray(m.content)) {
          const thinkingBlock = m.content.find((c: any) => c.type === "thinking");
          const textBlock = m.content.find((c: any) => c.type === "text");
          if (thinkingBlock) {
            thinkingContent = thinkingBlock.thinking || thinkingBlock.text || "";
          }
          if (textBlock) {
            textContent = textBlock.text || "";
          }
        }

        const timestamp = m.timestamp || Date.now();

        if (m.role === "assistant" && thinkingContent) {
          newLogs.push({ role: "thinking", content: thinkingContent, timestamp });
          newLogs.push({ role: "assistant", content: textContent, timestamp });
        } else {
          newLogs.push({ role: m.role, content: textContent, timestamp });
        }
      }

      this.messageLog = newLogs;
      this.messageLogVersion++;
    } catch {
      // ignore parse failures
    }
  }

  private _handleInput(data: string): void {
    if (!this.active) return;
    this.lastInputTime = Date.now();

    const mouseMatch = data.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (mouseMatch) {
      const button = parseInt(mouseMatch[1], 10);
      const x = parseInt(mouseMatch[2], 10);
      const y = parseInt(mouseMatch[3], 10);
      const isRelease = mouseMatch[4] === "m";
      if (!isRelease && button === 0) {
        this._handleMouseClick(x, y);
      }
      return;
    }

    const result = this._vimInput(data);
    this.inputText = result.text;
    this.cursorPos = result.cursor;

    if (result.action === "submit" && this.inputText.trim() && this._onSubmit) {
      const text = this.inputText;
      this.inputText = "";
      this.cursorPos = 0;
      this._onSubmit(text);
    }
  }

  private _vimInput(data: string): { text: string; cursor: number; action?: string } {
    if (data === "\t") {
      return { text: this.inputText, cursor: this.cursorPos };
    }
    if (data === "\x1b") return { text: this.inputText, cursor: this.cursorPos };
    if (data === "\r" || data === "\n") {
      return { text: this.inputText, cursor: this.cursorPos, action: "submit" };
    }
    if (data === "\x7f" || data === "\b") {
      if (this.cursorPos > 0) {
        return { text: this.inputText.slice(0, this.cursorPos - 1) + this.inputText.slice(this.cursorPos), cursor: this.cursorPos - 1 };
      }
      return { text: this.inputText, cursor: this.cursorPos };
    }
    if (data === "\x1b[D") {
      return { text: this.inputText, cursor: Math.max(0, this.cursorPos - 1) };
    }
    if (data === "\x1b[C") {
      return { text: this.inputText, cursor: Math.min(this.inputText.length, this.cursorPos + 1) };
    }
    if (data === "\x1b[H") {
      return { text: this.inputText, cursor: 0 };
    }
    if (data === "\x1b[F") {
      return { text: this.inputText, cursor: this.inputText.length };
    }
    if (data.length === 1 && data >= " " && data <= "~") {
      return { text: this.inputText.slice(0, this.cursorPos) + data + this.inputText.slice(this.cursorPos), cursor: this.cursorPos + 1 };
    }
    return { text: this.inputText, cursor: this.cursorPos };
  }

  private _handleMouseClick(x: number, y: number): void {
    const element = this.renderedElements.find(el => y >= el.startY && y < el.endY);
    if (!element) return;

    if (element.role === "user") {
      const thinkingEl = this.renderedElements.find(
        el => el.index > element.index && el.role === "thinking"
      );
      if (thinkingEl) {
        this._toggleThinkingCollapse(thinkingEl.index);
      }
    } else if (element.role === "thinking") {
      this._toggleThinkingCollapse(element.index);
    }
  }

  private _toggleThinkingCollapse(index: number): void {
    if (this.collapsedThinkingIndices.has(index)) {
      this.collapsedThinkingIndices.delete(index);
    } else {
      this.collapsedThinkingIndices.add(index);
    }
    this._requestFrame();
  }

  private _getVimMode(): string {
    return "insert";
  }
}

// Global trackers for cross-session sync
const globalTrackers = new Map<string, any>();

export function getGlobalTrackers(): Map<string, any> {
  return globalTrackers;
}