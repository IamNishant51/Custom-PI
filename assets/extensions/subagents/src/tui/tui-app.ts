import { TuiManager } from "./tui-manager";
import { SPINNERS } from "./types";
import type { AgentState } from "./types";
import { stripAnsi } from "./utils/measure-text";
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
  private memoryCount = 0;
  private vaultCount = 0;
  private _onSubmit: ((text: string) => void) | null = null;

  constructor() {
    this.tui = new TuiManager({ useAltScreen: true });
  }

  get onSubmit(): ((text: string) => void) | null { return this._onSubmit; }
  set onSubmit(cb: ((text: string) => void) | null) { this._onSubmit = cb; }

  start(): void {
    if (this.active) return;
    this.active = true;

    this.tui.start();

    process.stdout.write("\x1b[?1002h");

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
    process.stdout.write("\x1b[?1002l");
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

  private renderFrame(): void {
    if (!this.active) return;
    const renderer = this.tui.renderer;
    const cols = renderer.screen.getCols();
    const rows = renderer.screen.getRows();
    if (cols < 20 || rows < 10) return;

    // Sync from global activeTrackers
    for (const [id, tracker] of globalTrackers) {
      this.trackers.set(id, tracker as any);
    }

    const defaultStyle = renderer.style({ bg: renderer.theme.canvas });
    renderer.screen.clear(defaultStyle);

    let y = 1;

    // Banner
    y = renderer.drawBanner(y);

    // Messages (reversed, newest first)
    const visibleMessages = this.messageLog.slice(-10);
    const msgWidth = Math.min(cols - 4, 100);
    for (const msg of visibleMessages) {
      const ts = new Date(msg.timestamp).toLocaleTimeString();
      y = renderer.drawMessageBubble(y, msgWidth, msg.role, msg.content.slice(0, 200), ts, {
        agentName: msg.role === "assistant" ? "Assistant" : undefined,
        isStreaming: false,
      });
      y++;
      if (y >= rows - 6) break;
    }

    // Agent cards
    for (const [id, tracker] of this.trackers) {
      if (y >= rows - 6) break;
      const running = tracker.status === "running" || tracker.status === "calling_tool";
      const verb = running ? tracker.currentTool || "thinking" : undefined;
      const toolStr = tracker.toolCallCount > 0 ? `${tracker.toolCallCount} tool calls` : undefined;
      y = renderer.drawAgentCard(y, msgWidth, tracker.name, tracker.status, {
        verb,
        toolCalls: toolStr,
        outputLines: tracker.outputLines,
        duration: this.elapsed(tracker.startTime),
        animate: running,
      });
      y++;
    }

    // Input area
    if (y < rows - 3) {
      y = renderer.drawInputArea(y, msgWidth, this.inputText, this.cursorPos, this.tui.vimInput.state.mode);
    }

    // Status bar
    if (rows > 2) {
      const runningCount = Array.from(this.trackers.values()).filter(
        t => t.status === "running" || t.status === "calling_tool"
      ).length;
      renderer.drawStatusBar(rows - 1, {
        vimMode: this.tui.vimInput.state.mode,
        memoryCount: this.memoryCount || undefined,
        vaultCount: this.vaultCount || undefined,
        agentStatus: runningCount > 0 ? `● ${runningCount} active` : "○ idle",
      });
    }

    renderer.render();
  }

  private handleInput(data: string): void {
    if (!this.active) return;

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
