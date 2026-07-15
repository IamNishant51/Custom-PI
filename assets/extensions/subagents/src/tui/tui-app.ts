import { TuiManager } from "./tui-manager";
import { SPINNERS, BOX, SPACING, LAYOUT_PRESETS } from "./types";
import type { AgentState, PulseConfig, ConversationHeader, ScrollIndicator } from "./types";
import { stripAnsi, measureWidth } from "./utils/measure-text";
import { ICONS } from "./theme/icons";
import { activeTrackers as globalTrackers } from "../animations";
import { CommandRegistry, CommandPalette, type PaletteCommand } from "./palette";
import { AutocompleteProvider, type AutocompleteItem } from "./autocomplete";
import { InChatSearch } from "./search";
import { Dialog, ModelSelector, TranscriptViewer } from "./dialogs";
import type { ModelEntry } from "./dialogs";
import { ToastManager } from "./toast";
import { SidebarPanel } from "./sidebar";
import { TodoWidget, type TodoItem } from "./components/todo-widget";

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

const ROTATING_HINTS = [
  "? for shortcuts",
  "Tab to toggle agent/plan mode",
  "Esc to cancel",
  "Ctrl+Enter to send",
  "/help for commands",
];

export class TuiApp {
  tui: TuiManager;
  private active = false;
  private stdinHandler: ((data: Buffer) => void) | null = null;
  private inputText = "";
  private cursorPos = 0;
  private trackers: Map<string, TrackerData> = new Map();
  private messageLog: Array<{ role: string; content: string; timestamp: number }> = [];
  private collapsedThinkingIndices: Set<number> = new Set();
  private messageReactions: Map<number, string> = new Map();
  private renderedElements: Array<{ index: number; role: string; startY: number; endY: number }> = [];
  private compareMode = false;
  private compareLeftIndex = -1;
  private compareRightIndex = -1;
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
  private lastRenderMaxY = 0;
  private lastInputTime = Date.now();
  private lastRenderTime = 0;
  private idleFps = 10;

  private _rendering = false;
  private _messageLogVersion = 0;
  private _lastMessageCount = -1;
  private hintIndex = 0;
  private lastHintSwitch = 0;
  private _agentState: "idle" | "thinking" | "working" | "error" = "idle";
  private _lastTitleUpdate = 0;
  private scrollAccel = { lastEventTime: 0, velocity: 0, accumulated: 0 };
  private _pendingRecap = "";
  private cmdRegistry = new CommandRegistry();
  private cmdPalette: CommandPalette;
  private autocomplete = new AutocompleteProvider();
  private search = new InChatSearch();
  private _vimPendingG = false;
  private confirmDialog = new Dialog({ title: "Confirm", body: ["Proceed?"], confirmText: "Confirm", cancelText: "Cancel" });
  private modelSelector = new ModelSelector();
  private transcriptViewer = new TranscriptViewer();
  private toasts = new ToastManager();
  private sidebar = new SidebarPanel();
  private todoWidget = new TodoWidget();

  private getAutocompleteItems(): AutocompleteItem[] {
    return [
      { label: "search", description: "Search conversation", type: "command", insertText: "search " },
      { label: "clear", description: "Clear conversation", type: "command", insertText: "clear" },
      { label: "export", description: "Export to file", type: "command", insertText: "export " },
      { label: "compact", description: "Compact session", type: "command", insertText: "compact" },
      { label: "help", description: "Show help", type: "command", insertText: "help" },
      { label: "web_search", description: "Search the web", type: "tool", insertText: "web_search " },
      { label: "web_fetch", description: "Fetch a URL", type: "tool", insertText: "web_fetch " },
      { label: "memory_search", description: "Search memory", type: "tool", insertText: "memory_search " },
      { label: "generate_image", description: "Create an image", type: "tool", insertText: "generate_image " },
      { label: "bash", description: "Run a command", type: "tool", insertText: "bash " },
      { label: "write", description: "Write a file", type: "tool", insertText: "write " },
      { label: "assistant", description: "Default assistant", type: "agent", insertText: "assistant " },
      { label: "researcher", description: "Research agent", type: "agent", insertText: "researcher " },
      { label: "coder", description: "Coding agent", type: "agent", insertText: "coder " },
      { label: "reviewer", description: "Code reviewer", type: "agent", insertText: "reviewer " },
    ];
  }

  private registerBuiltinCommands(): void {
    const cmds: PaletteCommand[] = [
      { id: "session.new", title: "New Session", description: "Start a fresh session", category: "navigation", execute: () => {} },
      { id: "session.list", title: "List Sessions", description: "Show all sessions", category: "navigation", execute: () => {} },
      { id: "search.chat", title: "Search Chat", description: "Search conversation history", category: "navigation", icon: "\u{1F50D}", execute: () => { this.search.open(); this.tui.requestFrame(); } },
      { id: "view.layout", title: "Switch Layout", description: "Toggle between default/dense/minimal", category: "view", execute: () => { this.cycleLayout(); } },
      { id: "view.sidebar", title: "Toggle Sidebar", description: "Show or hide sidebar", category: "view", execute: () => {} },
      { id: "view.compact", title: "Toggle Compact Mode", description: "Switch to compact layout", category: "view", execute: () => { this.tui.renderer.setLayout("dense"); } },
      { id: "session.clear", title: "Clear Chat", description: "Clear conversation view", category: "session", execute: () => { this.messageLog = []; } },
      { id: "session.compact", title: "Compact Session", description: "Summarize and compact", category: "session", execute: () => {} },
      { id: "session.export", title: "Export Chat", description: "Export conversation to file", category: "session", execute: () => {} },
      { id: "agent.switch", title: "Switch Model", description: "Change active model", category: "agent", execute: () => {} },
      { id: "agent.toggle-mode", title: "Toggle Plan Mode", description: "Switch between agent and plan mode", category: "agent", execute: () => {} },
      { id: "agent.view-agents", title: "View Agents", description: "List all swarm agents", category: "agent", execute: () => {} },
      { id: "settings.theme", title: "Open Theme Picker", description: "Browse and apply themes", category: "settings", execute: () => {} },
      { id: "settings.layout", title: "Open Layout Picker", description: "Browse layout presets", category: "settings", execute: () => { this.cycleLayout(); } },
      { id: "settings.keybinds", title: "Configure Keybinds", description: "View keyboard shortcuts", category: "settings", execute: () => {} },
    ];
    for (const cmd of cmds) this.cmdRegistry.register(cmd);
  }

  private cycleLayout(): void {
    const names = Object.keys(LAYOUT_PRESETS);
    const current = this.tui.renderer.layout;
    const idx = names.findIndex(n => {
      const p = LAYOUT_PRESETS[n];
      return p.showBanner === current.showBanner && p.bannerCompact === current.bannerCompact;
    });
    const next = (idx + 1) % names.length;
    this.tui.renderer.setLayout(names[next]);
  }

  private updateSearchMatches(): void {
    const q = this.search.state.query;
    if (!q) { this.search.setMatchInfo(0, 0); return; }
    let count = 0;
    let currentGlobalIdx = 0;
    const targetIdx = this.search.state.currentMatch;
    for (const msg of this.messageLog) {
      const matches = this.search.findMatches(msg.content, q);
      for (const m of matches) {
        if (count === targetIdx) currentGlobalIdx = count;
        count++;
      }
    }
    this.search.setMatchInfo(count, currentGlobalIdx);
  }

  private applySearchHighlight(content: string): string {
    const q = this.search.state.query;
    if (!q || !this.search.state.visible) return content;
    const matches = this.search.findMatches(content, q);
    if (!matches.length) return content;
    let result = "";
    let lastEnd = 0;
    for (const m of matches) {
      result += content.slice(lastEnd, m.start);
      result += `\x1b[7m${content.slice(m.start, m.end)}\x1b[27m`;
      lastEnd = m.end;
    }
    result += content.slice(lastEnd);
    return result;
  }

  private acceleratedScroll(delta: number): number {
    const now = Date.now();
    const dt = Math.max(1, now - this.scrollAccel.lastEventTime);
    this.scrollAccel.lastEventTime = now;
    this.scrollAccel.velocity *= Math.pow(0.5, dt / 100);
    this.scrollAccel.velocity += Math.abs(delta) * 0.1;
    const lines = Math.abs(delta) + (this.scrollAccel.velocity > 1 ? Math.log2(this.scrollAccel.velocity) * 2 : 0);
    this.scrollAccel.accumulated += lines;
    const result = Math.floor(this.scrollAccel.accumulated);
    this.scrollAccel.accumulated -= result;
    return Math.sign(delta) * Math.max(1, Math.abs(result));
  }

  private getStatusLight(): { emoji: string; state: string } {
    const map: Record<string, { emoji: string; state: string }> = {
      idle: { emoji: "\u{1F7E2}", state: "idle" },
      thinking: { emoji: "\u{1F7E1}", state: "thinking" },
      working: { emoji: "\u{1F534}", state: "working" },
      error: { emoji: "\u26A0\uFE0F", state: "error" },
    };
    return map[this._agentState] || map.idle;
  }

  private updateTerminalTitle(): void {
    const now = Date.now();
    if (now - this._lastTitleUpdate < 2000) return;
    this._lastTitleUpdate = now;
    const light = this.getStatusLight();
    const cwd = process.cwd().split("/").pop() || "custom-pi";
    process.stdout.write(`\x1b]0;${light.emoji} Custom-PI \u2014 ${cwd} [${light.state}]\x07`);
  }

  private hasActiveAnimations(): boolean {
    if (this.trackers.size > 0) return true;
    if (this.tui.spinners.size > 0) return true;
    if (this.tui.shimmerBorders.size > 0) return true;
    return false;
  }

  constructor(ctx?: any, pi?: any) {
    this.ctx = ctx;
    this.pi = pi;
    this.tui = new TuiManager({ useAltScreen: true });
    this.registerBuiltinCommands();
    this.cmdPalette = new CommandPalette(this.cmdRegistry);
    this.autocomplete.setItems(this.getAutocompleteItems());

    if (this.pi) {
      this.onSubmit = (text) => {
        try {
          this.pi.sendMessage({ role: "user", content: [{ type: "text", text }] });
        } catch (e: any) {
          process.stderr.write(`\x1b[31m[TuiApp] Send error: ${e.message}\x1b[0m\n`);
        }
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

    this.tui.start(false);
    this.tui.renderer.updateLayout();

    if (pulseConfig) {
      this.tui.renderer.pulse.updateConfig(pulseConfig);
    }
    this.tui.startPulse();

    this.stdinHandler = (data: Buffer) => this.handleInput(data.toString());
    process.stdin.on("data", this.stdinHandler);

    this.tui.scheduler.add("tui:render-loop", () => this.renderFrame(), 33);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this._rendering = false;
    this.tui.scheduler.clear();
    if (this.stdinHandler) {
      process.stdin.off("data", this.stdinHandler);
      this.stdinHandler = null;
    }
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
    const branch = this.ctx.sessionManager.getBranch();
    if (!branch) return;
    const messages = branch
      .filter((e: any) => e.type === "message")
      .map((e: any) => e.message);

    if (messages.length === this._lastMessageCount) return;
    this._lastMessageCount = messages.length;

    try {
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
      this._messageLogVersion++;
    } catch {
      // ignore parse failures
    }
  }

  private renderFrame(): void {
    if (!this.active) return;
    if (this._rendering) return;
    this._rendering = true;

    try {
      this._doRender();
    } catch (err: any) {
      try {
        const msg = `[TuiApp] Render error: ${err.message}`;
        const style = "\x1b[31m";
        process.stderr.write(`${style}${msg}\x1b[0m\n`);
      } catch {
        // last resort
      }
    } finally {
      this._rendering = false;
    }
  }

  private _doRender(): void {
    const _frameStart = process.env.PI_TUI_DEBUG_FRAMES ? performance.now() : 0;
    const idleTime = Date.now() - this.lastInputTime;
    if (idleTime > 5000 && !this.hasActiveAnimations()) {
      const now = Date.now();
      if (now - this.lastRenderTime < 1000 / this.idleFps) return;
      this.lastRenderTime = now;
    }

    this.frameCounter++;
    this.syncMessages();

    // Session recap — show after idle period with enough history
    if (!this._pendingRecap && idleTime > 180000 && this.messageLog.length >= 6) {
      const lastMsgs = this.messageLog.slice(-6);
      const userMsgs = lastMsgs.filter(m => m.role === "user").length;
      const toolLike = lastMsgs.filter(m => m.role === "assistant" || m.role === "thinking").length;
      this._pendingRecap = `\u2501 Since you were away: ${userMsgs} prompts, ${toolLike} responses \u2501`;
    }

    const hasRunning = Array.from(this.trackers.values()).some(
      t => t.status === "running" || t.status === "calling_tool"
    );
    const hasError = Array.from(this.trackers.values()).some(
      t => t.status === "error"
    );
    this._agentState = hasRunning ? "working" : hasError ? "error" : "idle";
    this.updateTerminalTitle();

    const renderer = this.tui.renderer;
    const cols = renderer.screen.getCols();
    const rows = renderer.screen.getRows();
    const canvasStyle = renderer.style({ bg: renderer.theme.canvas });
    if (cols < SPACING.minScreenCols || rows < SPACING.minScreenRows) {
      renderer.screen.clear(canvasStyle);
      const msg = "Resize your terminal to at least 60x16 to use the Custom-PI TUI";
      const x = Math.max(0, Math.floor((cols - measureWidth(msg)) / 2));
      const y = Math.floor(rows / 2);
      const msgStyle = renderer.style({ fg: renderer.theme.warning, bold: true });
      renderer.screen.writeString(x, y, msg, msgStyle);
      renderer.render();
      return;
    }

    renderer.updateLayout();

    // Adjust content area for sidebar
    if (this.sidebar.state.visible) {
      const sbw = this.sidebar.state.width + 1;
      renderer.contentLeft += sbw;
      renderer.contentWidth = Math.max(40, renderer.contentWidth - sbw);
    }

    for (const [id, tracker] of globalTrackers) {
      this.trackers.set(id, tracker as any);
    }

    const runningCount = Array.from(this.trackers.values()).filter(
      t => t.status === "running" || t.status === "calling_tool"
    ).length;

    const defaultStyle = renderer.style({ bg: renderer.theme.canvas });
    let currentMaxY = 0;
    const hairlineFg = renderer.style({ fg: renderer.theme.hairline });
    const cardStyle = renderer.style({ bg: renderer.theme.card });

    // Render sidebar content
    if (this.sidebar.state.visible) {
      const sbLines = this.sidebar.render();
      const sbw = this.sidebar.state.width;
      for (let si = 0; si < sbLines.length && si < rows; si++) {
        renderer.screen.clearLine(si, defaultStyle);
        renderer.screen.writeString(0, si, sbLines[si], defaultStyle);
      }
      // Separator and fill remaining sidebar area
      for (let si = 0; si < rows; si++) {
        if (si < sbLines.length) {
          renderer.screen.writeString(sbw, si, "\u2502", hairlineFg);
        } else {
          renderer.screen.clearLine(si, defaultStyle);
          renderer.screen.writeString(0, si, " ".repeat(sbw), cardStyle);
          renderer.screen.writeString(sbw, si, "\u2502", hairlineFg);
        }
      }
    }

    const statusBarY = rows - 1;
    const inputAreaY = statusBarY - SPACING.inputAreaLines;
    const maxContentBottom = inputAreaY - 1;

    let y = 0;

    if (runningCount > 0) {
      y = 1;
    }

    y = renderer.drawBanner(y, this.frameCounter);

    const header: ConversationHeader = {
      modelName: this.sessionModel,
      sessionId: this.sessionId,
      contextPercent: Math.min(100, Math.round((this.messageLog.length / this.messageLimit) * 100)),
      messageCount: this.messageLog.length,
    };
    y = renderer.drawConversationHeader(y, header);

    // Search bar
    if (this.search.state.visible) {
      const searchBar = this.search.render(cols);
      if (searchBar.length) {
        renderer.screen.clearLine(y, renderer.style({ bg: renderer.theme.card }));
        renderer.screen.writeString(renderer.contentLeft, y, searchBar[0], renderer.style({ fg: renderer.theme.ink, bg: renderer.theme.card }));
        y++;
      }
    }

    const totalVisible = this.messageLog.length;
    const olderCount = Math.max(0, totalVisible - 10 - this.scrollOffset);
    const scroll: ScrollIndicator = { visible: olderCount > 0, olderCount, newerCount: this.scrollOffset };
    if (renderer.breakpoint === "compact") {
      y = renderer.drawScrollIndicator(y, scroll);
    }

    const maxVisibleMsgs = Math.max(1, maxContentBottom - y - 2);

    if (this.compareMode && this.compareLeftIndex >= 0 && this.compareRightIndex >= 0) {
      // Split-screen comparison: render two messages side by side
      const halfW = Math.floor((renderer.contentWidth - 3) / 2);
      const origContentLeft = renderer.contentLeft;
      const origContentWidth = renderer.contentWidth;

      // Left message
      const leftMsg = this.messageLog[this.compareLeftIndex];
      const leftTs = new Date(leftMsg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      renderer.contentLeft = origContentLeft;
      renderer.contentWidth = halfW;
      renderer.drawMessageBubble(y, halfW, leftMsg.role, leftMsg.content.slice(0, 200), leftTs, {
        agentName: leftMsg.role === "assistant" ? "Assistant (A)" : undefined,
        modelName: leftMsg.role === "assistant" ? this.sessionModel : undefined,
      });

      // Separator
      const sepX = origContentLeft + halfW + 1;
      const sepStyle = renderer.style({ fg: renderer.theme.hairline });
      for (let sy = y; sy < y + 6 && sy < maxContentBottom; sy++) {
        renderer.screen.writeString(sepX, sy, "\u2502", sepStyle);
      }

      // Right message
      const rightMsg = this.messageLog[this.compareRightIndex];
      const rightTs = new Date(rightMsg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      renderer.contentLeft = origContentLeft + halfW + 3;
      renderer.contentWidth = halfW;
      renderer.drawMessageBubble(y, halfW, rightMsg.role, rightMsg.content.slice(0, 200), rightTs, {
        agentName: rightMsg.role === "assistant" ? "Assistant (B)" : undefined,
        modelName: rightMsg.role === "assistant" ? this.sessionModel : undefined,
      });

      renderer.contentLeft = origContentLeft;
      renderer.contentWidth = origContentWidth;
      y += 8;

      // Compare hint
      const hintStyle = renderer.style({ fg: renderer.theme.muted, dim: true });
      renderer.screen.clearLine(y, renderer.style({ bg: renderer.theme.canvas }));
      renderer.screen.writeString(renderer.contentLeft, y, " Compare mode \u2014 Escape to exit", hintStyle);
      y++;
    } else {
      const visibleMessages = this.messageLog.slice(-maxVisibleMsgs);

      this.renderedElements = [];

      for (let i = 0; i < visibleMessages.length; i++) {
        const msg = visibleMessages[i];
        const startY = y;
        const ts = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        if (msg.role === "thinking") {
          const isCollapsed = this.collapsedThinkingIndices.has(i);
          const thinkingContent = this.search.state.visible ? this.applySearchHighlight(msg.content.slice(0, 300)) : msg.content.slice(0, 300);
          y = renderer.drawThinkingBlock(y, renderer.contentWidth, thinkingContent, isCollapsed, ts, {
            animFrame: this.frameCounter,
          });
        } else {
          const contentForDisplay = this.search.state.visible ? this.applySearchHighlight(msg.content.slice(0, 300)) : msg.content.slice(0, 300);
          y = renderer.drawMessageBubble(y, renderer.contentWidth, msg.role, contentForDisplay, ts, {
            agentName: msg.role === "assistant" ? "Assistant" : undefined,
            isStreaming: msg.role === "assistant" && i === visibleMessages.length - 1,
            animFrame: this.frameCounter,
            modelName: msg.role === "assistant" ? this.sessionModel : undefined,
          });
        }

        // Render reaction indicator if present
        const reaction = this.messageReactions.get(i);
        const msgIndex = i + this.messageLog.length - visibleMessages.length;
        if (reaction && y > 0) {
          const reactStyle = renderer.style({ fg: renderer.theme.warning, dim: false });
          const reactX = renderer.contentLeft + renderer.contentWidth - measureWidth(reaction) - SPACING.padding;
          renderer.screen.writeString(reactX, y - 1, reaction, reactStyle);
        }

        this.renderedElements.push({
          index: msgIndex,
          role: msg.role,
          startY,
          endY: y
        });

        y += SPACING.paddingSm;
        if (y >= maxContentBottom) break;
      }
    }

    // Typing indicator (shows when agent is working but no streaming message)
    if (this._agentState === "working" && y < maxContentBottom) {
      const dotIdx = Math.floor(this.frameCounter / 4) % 3;
      const dots = ["\u25cf", "\u25cb", "\u25cb"];
      const ordered = dots.slice(dotIdx).concat(dots.slice(0, dotIdx));
      const indicator = ` ${ordered.join(" ")}  ${ICONS.assistantLabel}`;
      const typingStyle = renderer.style({ fg: renderer.theme.accent, dim: true });
      renderer.screen.clearLine(y, renderer.style({ bg: renderer.theme.canvas }));
      renderer.screen.writeString(renderer.contentLeft, y, indicator, typingStyle);
      y++;
    }

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

    // Todo widget (renders above input area)
    if (y < inputAreaY) {
      const todoLines = this.todoWidget.render(renderer.contentWidth);
      if (todoLines.length > 0) {
        const todoStyle = renderer.style({ fg: renderer.theme.muted, bg: renderer.theme.canvas });
        for (const line of todoLines) {
          if (y >= inputAreaY) break;
          renderer.screen.clearLine(y, todoStyle);
          renderer.screen.writeString(renderer.contentLeft, y, line, todoStyle);
          y++;
        }
      }
    }

    if (inputAreaY < statusBarY) {
      renderer.drawInputArea(inputAreaY, renderer.contentWidth, this.inputText, this.cursorPos, this.tui.vimInput.state.mode);
    }

    // Show session recap before status bar
    if (this._pendingRecap && y < statusBarY - 1) {
      const recapStyle = renderer.style({ fg: renderer.theme.muted, dim: true, italic: true });
      renderer.screen.clearLine(y, renderer.style({ bg: renderer.theme.canvas }));
      renderer.screen.writeString(renderer.contentLeft, y, this._pendingRecap, recapStyle);
      y++;
      if (idleTime < 5000) this._pendingRecap = "";
    }

    if (statusBarY < rows) {
      const now = Date.now();
      if (now - this.lastHintSwitch > 5000) {
        this.hintIndex = (this.hintIndex + 1) % ROTATING_HINTS.length;
        this.lastHintSwitch = now;
      }
      if (runningCount > 0) {
        renderer.drawPulseInStatusBar(statusBarY, `agents: ${runningCount}`);
      } else {
        renderer.drawStatusBar(statusBarY, {
          vimMode: this.tui.vimInput.state.mode,
          memoryCount: this.memoryCount || undefined,
          vaultCount: this.vaultCount || undefined,
          agentStatus: `\u25cb idle`,
          hint: ROTATING_HINTS[this.hintIndex],
        });
      }
    }

    // Draw scrollbar overlay
    if (renderer.breakpoint !== "compact") {
      renderer.drawScrollbar(0, rows - 2, {
        total: this.messageLog.length,
        visible: maxVisibleMsgs,
        offset: this.scrollOffset,
      });
    }

    // Autocomplete popup (rendered above input area)
    if (this.autocomplete.state.visible && this.tui.vimInput.state.mode === "insert") {
      const acLines = this.autocomplete.render(cols);
      if (acLines.length > 0) {
        const popupStartY = inputAreaY - acLines.length - 1;
        for (let ai = 0; ai < acLines.length; ai++) {
          const py = popupStartY + ai;
          if (py < 0) break;
          renderer.screen.clearLine(py, defaultStyle);
          renderer.screen.writeString(renderer.contentLeft + 2, py, acLines[ai], defaultStyle);
        }
      }
    }

    currentMaxY = y;

    if (this.lastRenderMaxY > currentMaxY) {
      for (let ry = currentMaxY; ry < this.lastRenderMaxY && ry < rows; ry++) {
        renderer.screen.clearLine(ry, defaultStyle);
      }
    }

    // Toast notifications (top-right overlay)
    const toastLines = this.toasts.render(cols);
    if (toastLines.length > 0) {
      const toastStartY = Math.max(2, Math.floor(rows * 0.08));
      for (let ti = 0; ti < toastLines.length; ti++) {
        const py = toastStartY + ti;
        if (py >= rows) break;
        renderer.screen.clearLine(py, defaultStyle);
        renderer.screen.writeString(cols - 50, py, toastLines[ti], defaultStyle);
      }
    }

    // Modal dialog overlays (drawn on top of everything)
    const activeDialog = this.confirmDialog.visible ? this.confirmDialog
      : this.modelSelector.visible ? this.modelSelector
      : this.transcriptViewer.visible ? this.transcriptViewer
      : null;
    if (activeDialog) {
      const dlgLines = activeDialog.render(cols, cols, rows);
      if (dlgLines.length > 0) {
        const dlgH = dlgLines.length;
        const startY = Math.max(0, Math.floor((rows - dlgH) / 2));
        for (let di = 0; di < dlgH; di++) {
          const py = startY + di;
          if (py >= rows) break;
          renderer.screen.clearLine(py, defaultStyle);
          const pad = Math.floor((cols - measureWidth(stripAnsi(dlgLines[di]))) / 2);
          renderer.screen.writeString(Math.max(0, pad), py, dlgLines[di], defaultStyle);
        }
      }
    }

    // Command palette overlay (drawn last, on top of everything)
    if (this.cmdPalette.state.visible) {
      const paletteLines = this.cmdPalette.render(cols);
      const overlayH = paletteLines.length;
      const startY = Math.max(0, Math.floor((rows - overlayH) / 3));
      for (let pi = 0; pi < overlayH; pi++) {
        const py = startY + pi;
        if (py >= rows) break;
        renderer.screen.clearLine(py, defaultStyle);
        renderer.screen.writeString(0, py, paletteLines[pi], defaultStyle);
      }
    }
    this.lastRenderMaxY = currentMaxY;

    renderer.render();

    if (_frameStart) {
      const elapsed = performance.now() - _frameStart;
      if (elapsed > 4) {
        try {
          process.stderr.write(`\x1b[2m[tui-app frame: ${elapsed.toFixed(1)}ms, dirty rows: ${this.lastRenderMaxY}]\x1b[0m\n`);
        } catch {}
      }
    }
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
    this.lastInputTime = Date.now();

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

    // Command palette — intercept before VimInput
    if (this.cmdPalette.state.visible) {
      const action = this.cmdPalette.handleInput(data);
      if (action === "close") this.tui.requestFrame();
      else this.tui.requestFrame();
      return;
    }

    // Search mode — intercept before VimInput
    if (this.search.state.visible) {
      const action = this.search.handleInput(data);
      if (action === "close") { this.tui.requestFrame(); return; }
      if (action === "navigate") { this.updateSearchMatches(); this.tui.requestFrame(); }
      return;
    }

    // Sidebar input
    if (this.sidebar.state.visible) {
      this.sidebar.handleInput(data);
      this.tui.requestFrame();
      return;
    }

    // Modal dialogs — intercept before everything
    if (this.confirmDialog.visible) {
      this.confirmDialog.handleInput(data);
      this.tui.requestFrame();
      return;
    }
    if (this.modelSelector.visible) {
      this.modelSelector.handleInput(data);
      this.tui.requestFrame();
      return;
    }
    if (this.transcriptViewer.visible) {
      this.transcriptViewer.handleInput(data);
      this.tui.requestFrame();
      return;
    }

    // Ctrl+B (0x02) to toggle sidebar
    if (data === "\x02") {
      this.sidebar.toggle();
      this.tui.requestFrame();
      return;
    }



    // Escape to exit compare mode
    if (data === "\x1b" && this.compareMode) {
      this.compareMode = false;
      this.tui.requestFrame();
      return;
    }

    // Ctrl+F (0x06) to open search
    if (data === "\x06") {
      this.search.open();
      this.tui.requestFrame();
      return;
    }

    // Ctrl+K (0x0b) or Ctrl+P (0x10) to open command palette
    if (data === "\x0b" || data === "\x10") {
      this.cmdPalette.toggle();
      this.tui.requestFrame();
      return;
    }

    // Ctrl+Y (0x19) to toggle compare/split-screen mode
    if (data === "\x19") {
      if (this.compareMode) {
        this.compareMode = false;
      } else {
        const assistantIndices = this.messageLog
          .map((m, i) => m.role === "assistant" ? i : -1)
          .filter(i => i >= 0);
        if (assistantIndices.length >= 2) {
          this.compareLeftIndex = assistantIndices[assistantIndices.length - 2];
          this.compareRightIndex = assistantIndices[assistantIndices.length - 1];
          this.compareMode = true;
        }
      }
      this.tui.requestFrame();
      return;
    }

    // Ctrl+R (0x12) to toggle reaction on last assistant message
    if (data === "\x12") {
      const lastAssistant = this.messageLog.length - 1;
      for (let i = this.messageLog.length - 1; i >= 0; i--) {
        if (this.messageLog[i].role === "assistant") {
          const existing = this.messageReactions.get(i);
          if (existing) {
            this.messageReactions.delete(i);
          } else {
            this.messageReactions.set(i, "\u2b50");
          }
          break;
        }
      }
      this.tui.requestFrame();
      return;
    }

    // Autocomplete: Tab to cycle, Enter to select
    if (this.autocomplete.state.visible) {
      if (data === "\x1b" || data === "\x03") { // Escape or Ctrl+C
        this.autocomplete.hide();
        this.tui.requestFrame();
        return;
      }
      if (data === "\t" || data === "\x1b[B") { // Tab or ArrowDown
        this.autocomplete.selectNext();
        this.tui.requestFrame();
        return;
      }
      if (data === "\x1b[A") { // ArrowUp
        this.autocomplete.selectPrev();
        this.tui.requestFrame();
        return;
      }
      if (data === "\n" || data === "\r") {
        const applied = this.autocomplete.applyCompletion(this.inputText, this.cursorPos);
        if (applied) {
          this.inputText = applied.text;
          this.cursorPos = applied.cursorPos;
          this.autocomplete.hide();
          this.tui.requestFrame();
          return;
        }
      }
    }

    // Vim message list navigation (normal mode, no input text)
    if (this.tui.vimInput.state.mode === "normal" && !this.inputText) {
      if (data !== "g" && data !== "G" && this._vimPendingG) {
        this._vimPendingG = false;
      }
      if (data === "j" || data === "\x1b[B") {
        this.scrollOffset = Math.max(0, this.scrollOffset + 1);
        this.tui.requestFrame();
        return;
      }
      if (data === "k" || data === "\x1b[A") {
        this.scrollOffset = Math.max(0, this.scrollOffset - 1);
        this.tui.requestFrame();
        return;
      }
      if (data === "g") {
        this._vimPendingG = true;
        this.tui.requestFrame();
        return;
      }
      if (data === "G") {
        this.scrollOffset = 0;
        this._vimPendingG = false;
        this.tui.requestFrame();
        return;
      }
      if (this._vimPendingG && data === "g") {
        this.scrollOffset = this.messageLog.length;
        this._vimPendingG = false;
        this.tui.requestFrame();
        return;
      }
      if (data === "\x1b[5~" || data === "\x04") { // PageUp / Ctrl+D
        this.scrollOffset = Math.max(0, this.scrollOffset - 10);
        this.tui.requestFrame();
        return;
      }
      if (data === "\x1b[6~" || data === "\x15") { // PageDown / Ctrl+U
        this.scrollOffset = Math.max(0, this.scrollOffset + 10);
        this.tui.requestFrame();
        return;
      }
    }

    const result = this.tui.vimInput.handleData(data, this.inputText, this.cursorPos);
    const prevText = this.inputText;
    this.inputText = result.text;
    this.cursorPos = result.cursor;

    // Update autocomplete after every input change
    if (this.inputText !== prevText) {
      this.autocomplete.update(this.inputText, this.cursorPos);
    }

    if (result.action === "submit" && this.inputText.trim() && this._onSubmit) {
      this.autocomplete.hide();
      const text = this.inputText;
      this.inputText = "";
      this.cursorPos = 0;
      this._onSubmit(text);
    }
  }
}
