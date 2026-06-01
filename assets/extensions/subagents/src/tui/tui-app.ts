import { TuiManager } from "./tui-manager";
import { SPINNERS, BOX } from "./types";
import type { AgentState, PulseConfig } from "./types";
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

  start(pulseConfig?: Partial<PulseConfig>): void {
    if (this.active) return;
    this.active = true;

    this.tui.start();

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
    this.tui.animFrame.remove("tui:render-loop");
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
    this.syncMessages();

    const renderer = this.tui.renderer;
    const cols = renderer.screen.getCols();
    const rows = renderer.screen.getRows();
    if (cols < 20 || rows < 10) return;

    // Sync from global activeTrackers
    for (const [id, tracker] of globalTrackers) {
      this.trackers.set(id, tracker as any);
    }

    const runningCount = Array.from(this.trackers.values()).filter(
      t => t.status === "running" || t.status === "calling_tool"
    ).length;

    const defaultStyle = renderer.style({ bg: renderer.theme.canvas });
    renderer.screen.clear(defaultStyle);

    let y = 1;

    // Pulse banner line (thin ∞ shimmer at top when agents are active)
    if (runningCount > 0) {
      y = renderer.drawPulseBannerLine(0);
      y = 1;
    }

    // Banner
    y = renderer.drawBanner(y);

    // Pulse ∞ symbol next to running agent count in HUD area
    if (runningCount > 0) {
      const hudStyle = renderer.style({ bg: renderer.theme.canvas });
      renderer.screen.clearLine(y, hudStyle);
      renderer.drawPulseSymbol(2, y);
      const statusText = ` ${runningCount} active     `;
      renderer.screen.writeString(4, y, statusText, renderer.style({ fg: renderer.theme.muted }));
      y++;
    }

    // Messages (reversed, newest first)
    const visibleMessages = this.messageLog.slice(-10);
    const msgWidth = Math.min(cols - 4, 100);
    this.renderedElements = [];

    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      const startY = y;
      const ts = new Date(msg.timestamp).toLocaleTimeString();
      
      if (msg.role === "thinking") {
        const isCollapsed = this.collapsedThinkingIndices.has(i);
        y = renderer.drawThinkingBlock(y, msgWidth, msg.content.slice(0, 200), isCollapsed, ts);
      } else {
        y = renderer.drawMessageBubble(y, msgWidth, msg.role, msg.content.slice(0, 200), ts, {
          agentName: msg.role === "assistant" ? "Assistant" : undefined,
          isStreaming: false,
        });
      }
      
      const endY = y;
      this.renderedElements.push({
        index: i,
        role: msg.role,
        startY,
        endY
      });
      
      y++;
      if (y >= rows - 6) break;
    }

    // Agent cards with pulse indicator
    for (const [id, tracker] of this.trackers) {
      if (y >= rows - 6) break;
      const running = tracker.status === "running" || tracker.status === "calling_tool";
      const verb = running ? tracker.currentTool || "thinking" : undefined;
      const toolStr = tracker.toolCallCount > 0 ? `${tracker.toolCallCount} tool calls` : undefined;

      if (running) {
        const pulseBox = renderer.drawPulseBorderBox(y, msgWidth, tracker.name);
        y = pulseBox.y;
        const verbLine = `${verb || "working"}...  ${toolStr || ""}`.trim();
        renderer.screen.clearLine(y, renderer.style({ bg: renderer.theme.canvas }));
        renderer.screen.writeString(2, y, `  ${verbLine}`, renderer.style({ fg: renderer.theme.muted }));
        y++;
        if (tracker.outputLines.length > 0) {
          const last = tracker.outputLines[tracker.outputLines.length - 1];
          renderer.screen.clearLine(y, renderer.style({ bg: renderer.theme.canvas }));
          renderer.screen.writeString(2, y, `  ${last.slice(0, msgWidth - 8)}`, renderer.style({ fg: renderer.theme.dim, dim: true }));
          y++;
        }
        const bStyle = renderer.style({ fg: renderer.theme.hairline });
        renderer.screen.clearLine(y, renderer.style({ bg: renderer.theme.canvas }));
        renderer.screen.writeString(1, y, "╰" + BOX.h.repeat(msgWidth - 2) + "╯", bStyle);
        y++;
      } else {
        y = renderer.drawAgentCard(y, msgWidth, tracker.name, tracker.status, {
          verb,
          toolCalls: toolStr,
          outputLines: tracker.outputLines,
          duration: this.elapsed(tracker.startTime),
          animate: running,
        });
      }
      y++;
    }

    // Input area
    if (y < rows - 3) {
      y = renderer.drawInputArea(y, msgWidth, this.inputText, this.cursorPos, this.tui.vimInput.state.mode);
    }

    // Status bar with pulse
    if (rows > 2) {
      if (runningCount > 0) {
        renderer.drawPulseInStatusBar(rows - 1, `agents: ${runningCount}`);
      } else {
        renderer.drawStatusBar(rows - 1, {
          vimMode: this.tui.vimInput.state.mode,
          memoryCount: this.memoryCount || undefined,
          vaultCount: this.vaultCount || undefined,
          agentStatus: `○ idle`,
        });
      }
    }

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
