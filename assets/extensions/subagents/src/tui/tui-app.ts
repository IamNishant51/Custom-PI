import { TuiManager } from "./tui-manager";
import { SPINNERS, BOX, SPACING } from "./types";
import type { AgentState, PulseConfig, ConversationHeader, ScrollIndicator } from "./types";
import { stripAnsi, measureWidth } from "./utils/measure-text";
import { activeTrackers as globalTrackers } from "../animations";

interface TrackerData {
  id: string;
  name: string;
  task: string;
  status: string;
  turn: number;
  maxTurns: number;
  toolCallCount: number;
  currentTool?: string;
  startTime: number;
  outputLines: string[];
}

export class TuiApp {
  tui: TuiManager;
  private active = false;
  private stdinHandler: ((data: Buffer) => void) | null = null;
  private inputText = "";
  private cursorPos = 0;
  private trackers: Map<string, TrackerData> = new Map();
  private messageLog: Array<{ role: string; content: string; timestamp: number }> = [];
  private collapsedThinkingIndices: Set<number> = new Set();
  private renderedElements: Array<{ index: number; role: string; startY: number; endY: number }> = [];
  private memoryCount = 0;
  private vaultCount = 0;
  private _onSubmit: ((text: string) => void) | null = null;
  private ctx: any;
  private pi: any;

  private sessionModel = "unknown";
  private sessionId = "session-1";
  private messageLimit = 100;
  private scrollOffset = 0;
  private frameCounter = 0;
  /** Tracks the bottom-most row rendered in the previous frame for stale-region clearing */
  private lastRenderMaxY = 0;

  constructor(ctx?: any, pi?: any) {
    this.ctx = ctx;
    this.pi = pi;
    this.tui = new TuiManager({ useAltScreen: true });

    if (this.pi) {
      this.onSubmit = (text) => {
        this.pi.sendMessage({ role: "user", content: [{ type: "text", text }] });
      };
    }
  }

  get onSubmit(): ((text: string) => void) | null { return this._onSubmit; }
  set onSubmit(cb: ((text: string) => void) | null) { this._onSubmit = cb; }

  setSessionInfo(model: string, id: string): void {
    this.sessionModel = model;
    this.sessionId = id;
  }

  start(pulseConfig?: Partial<PulseConfig>): void {
    if (this.active) return;
    this.active = true;

    this.tui.start();
    this.tui.renderer.updateLayout();

    if (pulseConfig) {
      this.tui.renderer.pulse.updateConfig(pulseConfig);
    }
    this.tui.startPulse();

    const pulseAnimId = "tui:pulse-tick";
    this.tui.animFrame.add(pulseAnimId, () => {
      this.tui.renderer.pulse.getState();
    }, 16);

    // Enable SGR Mouse tracking (1002h for drag, 1006h for SGR coordinates)
    process.stdout.write("\x1b[?1002h\x1b[?1006h");

    this.stdinHandler = (data: Buffer) => this.handleInput(data.toString());
    process.stdin.on("data", this.stdinHandler);

    this.tui.animFrame.add("tui:render-loop", () => this.renderFrame(), 16);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.tui.animFrame.clear();
    if (this.stdinHandler) {
      process.stdin.off("data", this.stdinHandler);
      this.stdinHandler = null;
    }
    // Disable mouse tracking
    process.stdout.write("\x1b[?1002l\x1b[?1006l");
    this.tui.stop();
  }

  get isActive(): boolean {
    return this.active;
  }

  updateTracker(id: string, data: Partial<TrackerData>): void {
    const existing = this.trackers.get(id) || {
      id, name: "", task: "", status: "pending", turn: 0, maxTurns: 15,
      toolCallCount: 0, startTime: Date.now(), outputLines: [],
    };
    Object.assign(existing, data);
    this.trackers.set(id, existing);
  }

  removeTracker(id: string): void {
    this.trackers.delete(id);
  }

  addMessage(role: string, content: string): void {
    this.messageLog.push({ role, content, timestamp: Date.now() });
  }

  setMemoryCount(n: number): void { this.memoryCount = n; }
  setVaultCount(n: number): void { this.vaultCount = n; }

  private elapsed(ms: number): string {
    const sec = Math.floor((Date.now() - ms) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  private syncMessages(): void {
    if (!this.ctx?.sessionManager) return;
    try {
      const branch = this.ctx.sessionManager.getBranch();
      if (!branch) return;
      const messages = branch
        .filter((e: any) => e.type === "message")
        .map((e: any) => e.message);
      
      const newLogs: Array<{ role: string; content: string; timestamp: number }> = [];
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
    } catch (e) {
      // ignore
    }
  }

  private renderFrame(): void {
    if (!this.active) return;
    this.frameCounter++;
    this.syncMessages();

    const renderer = this.tui.renderer;
    const cols = renderer.screen.getCols();
    const rows = renderer.screen.getRows();
    if (cols < SPACING.minScreenCols || rows < SPACING.minScreenRows) return;

    // Ensure layout is up-to-date
    renderer.updateLayout();

    // Sync from global activeTrackers
    for (const [id, tracker] of globalTrackers) {
      this.trackers.set(id, tracker as any);
    }

    const runningCount = Array.from(this.trackers.values()).filter(
      t => t.status === "running" || t.status === "calling_tool"
    ).length;

    const defaultStyle = renderer.style({ bg: renderer.theme.canvas });

    // ── Stale-row clearing ────────────────────────────────────────────
    // Instead of clearing the entire screen (which marks every cell dirty on
    // every frame), track the bottom-most row rendered last frame. If this
    // frame renders fewer rows, clear the stale rows that are no longer used.
    const damageRegions = renderer.screen.getDamageRegions();
    let currentMaxY = 0;

    // ── Layout Regions ─────────────────────────────────────────────────
    // 1. Top: pulse banner line (if active)
    // 2. Banner (logo)
    // 3. Conversation header
    // 4. Scroll indicator (if scrolled)
    // 5. Messages (scrollable middle area)
    // 6. Agent cards
    // 7. Input area (fixed at bottom)
    // 8. Status bar (very bottom)
    //
    // We layout bottom-up for the fixed elements, then fill the rest.

    // Reserve bottom rows for input + status bar
    const statusBarY = rows - 1;
    const inputAreaY = statusBarY - SPACING.inputAreaLines;
    const maxContentBottom = inputAreaY - 1;

    let y = 0;

    // ── 1. Pulse banner line (thin ∞ shimmer at top) ──
    if (runningCount > 0) {
      y = renderer.drawPulseBannerLine(0);
      y = 1;
    }

    // ── 2. Banner ──
    y = renderer.drawBanner(y);

    // ── 3. Conversation Header ──
    const header: ConversationHeader = {
      modelName: this.sessionModel,
      sessionId: this.sessionId,
      contextPercent: Math.min(100, Math.round((this.messageLog.length / this.messageLimit) * 100)),
      messageCount: this.messageLog.length,
    };
    y = renderer.drawConversationHeader(y, header);

    // ── 4. Scroll indicator ──
    const totalVisible = this.messageLog.length;
    const olderCount = Math.max(0, totalVisible - 10 - this.scrollOffset);
    const scroll: ScrollIndicator = { visible: olderCount > 0, olderCount, newerCount: this.scrollOffset };
    y = renderer.drawScrollIndicator(y, scroll);

    // ── 5. Messages ──
    const maxMessages = Math.max(1, maxContentBottom - y - 2);
    const visibleMessages = this.messageLog.slice(-maxMessages);
    this.renderedElements = [];

    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      const startY = y;
      const ts = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      if (msg.role === "thinking") {
        const isCollapsed = this.collapsedThinkingIndices.has(i);
        y = renderer.drawThinkingBlock(y, renderer.contentWidth, msg.content.slice(0, 300), isCollapsed, ts, {
          animFrame: this.frameCounter,
        });
      } else {
        y = renderer.drawMessageBubble(y, renderer.contentWidth, msg.role, msg.content.slice(0, 300), ts, {
          agentName: msg.role === "assistant" ? "Assistant" : undefined,
          isStreaming: msg.role === "assistant" && i === visibleMessages.length - 1,
          animFrame: this.frameCounter,
          modelName: msg.role === "assistant" ? this.sessionModel : undefined,
        });
      }

      this.renderedElements.push({
        index: i,
        role: msg.role,
        startY,
        endY: y
      });

      y += SPACING.paddingSm;
      if (y >= maxContentBottom) break;
    }

    // ── 6. Agent cards ──
    for (const [id, tracker] of this.trackers) {
      if (y >= maxContentBottom) break;
      const running = tracker.status === "running" || tracker.status === "calling_tool";
      const verb = running ? tracker.currentTool || "thinking" : undefined;
      const toolStr = tracker.toolCallCount > 0 ? `${tracker.toolCallCount} tool calls` : undefined;

      if (running) {
        const pulseBox = renderer.drawPulseBorderBox(y, renderer.contentWidth, tracker.name);
        y = pulseBox.y;
        const cx = renderer.contentLeft;
        const verbLine = `${verb || "working"}...  ${toolStr || ""}`.trim();
        renderer.screen.clearLine(y, renderer.style({ bg: renderer.theme.canvas }));
        renderer.screen.writeString(cx + SPACING.padding, y, `  ${verbLine}`, renderer.style({ fg: renderer.theme.muted }));
        y++;
        if (tracker.outputLines.length > 0) {
          const last = tracker.outputLines[tracker.outputLines.length - 1];
          renderer.screen.clearLine(y, renderer.style({ bg: renderer.theme.canvas }));
          renderer.screen.writeString(cx + SPACING.padding, y, `  ${last.slice(0, renderer.contentWidth - 12)}`, renderer.style({ fg: renderer.theme.dim, dim: true }));
          y++;
        }
        const bStyle = renderer.style({ fg: renderer.theme.hairline });
        renderer.screen.clearLine(y, renderer.style({ bg: renderer.theme.canvas }));
        renderer.screen.writeString(cx, y, "\u2570" + BOX.h.repeat(renderer.contentWidth - 2) + "\u256f", bStyle);
        y++;
      } else {
        y = renderer.drawAgentCard(y, renderer.contentWidth, tracker.name, tracker.status, {
          verb,
          toolCalls: toolStr,
          outputLines: tracker.outputLines,
          duration: this.elapsed(tracker.startTime),
          animate: running,
        });
      }
      y += SPACING.paddingSm;
    }

    // ── 7. Input area (fixed at bottom region) ──
    if (inputAreaY < statusBarY) {
      renderer.drawInputArea(inputAreaY, renderer.contentWidth, this.inputText, this.cursorPos, this.tui.vimInput.state.mode);
    }

    // ── 8. Status bar with pulse ──
    if (statusBarY < rows) {
      if (runningCount > 0) {
        renderer.drawPulseInStatusBar(statusBarY, `agents: ${runningCount}`);
      } else {
        renderer.drawStatusBar(statusBarY, {
          vimMode: this.tui.vimInput.state.mode,
          memoryCount: this.memoryCount || undefined,
          vaultCount: this.vaultCount || undefined,
          agentStatus: `\u25cb idle`,
        });
      }
    }

    currentMaxY = y;

    // Clear stale rows from the previous frame that are no longer used
    if (this.lastRenderMaxY > currentMaxY) {
      for (let ry = currentMaxY; ry < this.lastRenderMaxY && ry < rows; ry++) {
        renderer.screen.clearLine(ry, defaultStyle);
      }
    }
    this.lastRenderMaxY = currentMaxY;

    renderer.render();
  }

  private handleMouseClick(x: number, y: number): void {
    const element = this.renderedElements.find(el => y >= el.startY && y < el.endY);
    if (!element) return;

    if (element.role === "user") {
      const thinkingEl = this.renderedElements.find(
        el => el.index > element.index && el.role === "thinking"
      );
      if (thinkingEl) {
        this.toggleThinkingCollapse(thinkingEl.index);
      }
    } else if (element.role === "thinking") {
      this.toggleThinkingCollapse(element.index);
    }
  }

  private toggleThinkingCollapse(index: number): void {
    if (this.collapsedThinkingIndices.has(index)) {
      this.collapsedThinkingIndices.delete(index);
    } else {
      this.collapsedThinkingIndices.add(index);
    }
    this.tui.requestFrame();
  }

  private handleInput(data: string): void {
    if (!this.active) return;

    // Check for SGR Mouse Event
    const mouseMatch = data.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (mouseMatch) {
      const button = parseInt(mouseMatch[1], 10);
      const x = parseInt(mouseMatch[2], 10);
      const y = parseInt(mouseMatch[3], 10);
      const isRelease = mouseMatch[4] === "m";
      if (!isRelease && button === 0) {
        this.handleMouseClick(x, y);
      }
      return;
    }

    const result = this.tui.vimInput.handleData(data, this.inputText, this.cursorPos);
    this.inputText = result.text;
    this.cursorPos = result.cursor;

    if (result.action === "submit" && this.inputText.trim() && this._onSubmit) {
      const text = this.inputText;
      this.inputText = "";
      this.cursorPos = 0;
      this._onSubmit(text);
    }
  }
}
