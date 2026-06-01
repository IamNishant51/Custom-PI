import { ScreenRenderer } from "./screen-renderer";
import { AnimationFrame, SpinnerController, ShimmerBorderController } from "./components/animation";
import { ToastManager } from "./components/toast";
import type { Toast, ToastType } from "./components/toast";
import { QuestionModalManager } from "./components/question-modal";
import type { QuestionModalConfig } from "./components/question-modal";
import { VimInputHandler } from "./input/vim-input";
import { THEME, SPACING, type PulseConfig, type ConversationHeader, type ScrollIndicator } from "./types";
import { PulseController } from "./app/pulse-controller";

export interface TuiManagerOptions {
  useAltScreen?: boolean;
  enableMouse?: boolean;
}

export class TuiManager {
  renderer: ScreenRenderer;
  animFrame: AnimationFrame;
  vimInput: VimInputHandler;
  toasts: ToastManager;
  questions: QuestionModalManager;
  spinners: Map<string, SpinnerController> = new Map();
  shimmerBorders: Map<string, ShimmerBorderController> = new Map();
  private options: TuiManagerOptions;
  private _isActive = false;
  private frameRequested = false;

  constructor(opts: TuiManagerOptions = {}) {
    this.options = opts;
    this.renderer = new ScreenRenderer();
    this.animFrame = new AnimationFrame();
    this.vimInput = new VimInputHandler();
    this.toasts = new ToastManager();
    this.questions = new QuestionModalManager();
  }

  start(): void {
    if (this._isActive) return;
    this._isActive = true;
    this.renderer.start(this.options.useAltScreen !== false);
    this.animFrame.start();

    this.animFrame.add("tui:render", () => {
      if (!this.frameRequested) {
        this.frameRequested = true;
        setImmediate(() => {
          this.frameRequested = false;
          this.renderer.render();
        });
      }
    }, 16);
  }

  stop(): void {
    this._isActive = false;
    this.animFrame.stop();
    this.renderer.stop();
  }

  get isActive(): boolean {
    return this._isActive;
  }

  // Spinner management
  getSpinner(id: string, frames: string[], interval: number): SpinnerController {
    if (!this.spinners.has(id)) {
      this.spinners.set(id, new SpinnerController(id, frames, interval, this.animFrame));
    }
    return this.spinners.get(id)!;
  }

  startSpinner(id: string, frames: string[], interval?: number): SpinnerController {
    const s = this.getSpinner(id, frames, interval ?? 80);
    s.start();
    return s;
  }

  stopSpinner(id: string): void {
    this.spinners.get(id)?.stop();
  }

  // Shimmer border management
  getShimmer(id: string): ShimmerBorderController {
    if (!this.shimmerBorders.has(id)) {
      this.shimmerBorders.set(id, new ShimmerBorderController(id, this.animFrame));
    }
    return this.shimmerBorders.get(id)!;
  }

  startShimmer(id: string): void {
    this.getShimmer(id).start();
  }

  stopShimmer(id: string): void {
    this.shimmerBorders.get(id)?.stop();
  }

  requestFrame(): void {
    if (!this.frameRequested) {
      this.frameRequested = true;
      setImmediate(() => {
        this.frameRequested = false;
        this.renderer.render();
      });
    }
  }

  // ── Layout system ────────────────────────────────────────────────────────

  updateLayout(): void {
    this.renderer.updateLayout();
  }

  drawConversationHeader(y: number, opts: ConversationHeader): number {
    return this.renderer.drawConversationHeader(y, opts);
  }

  drawScrollIndicator(y: number, opts: ScrollIndicator): number {
    return this.renderer.drawScrollIndicator(y, opts);
  }

  // High-level layout helpers
  drawBanner(startY?: number): number {
    return this.renderer.drawBanner(startY ?? 0);
  }

  drawStatusBar(y: number, opts?: {
    vimMode?: string;
    memoryCount?: number;
    vaultCount?: number;
    cost?: string;
    tokens?: string;
    agentStatus?: string;
  }): number {
    return this.renderer.drawStatusBar(y, opts);
  }

  drawInputArea(y: number, width: number, text: string, cursor: number, vimMode?: string): number {
    return this.renderer.drawInputArea(y, width, text, cursor, vimMode);
  }

  drawAgentCard(y: number, width: number, name: string, status: string, opts?: {
    verb?: string;
    toolCalls?: string;
    outputLines?: string[];
    duration?: string;
    animate?: boolean;
  }): number {
    return this.renderer.drawAgentCard(y, width, name, status, opts);
  }

  drawMessageBubble(y: number, width: number, role: string, content: string, timestamp: string, opts?: {
    toolCalls?: number;
    duration?: string;
    agentName?: string;
    isStreaming?: boolean;
  }): number {
    return this.renderer.drawMessageBubble(y, width, role, content, timestamp, opts);
  }

  drawBox(y: number, width: number, title: string, content: string[], borderColor: string, accentColor?: string): number {
    return this.renderer.drawBox(y, width, title, content, borderColor, accentColor);
  }

  drawDivider(y: number, width: number, color: string): number {
    return this.renderer.drawDivider(y, width, color);
  }

  // ── Pulse Animation ───────────────────────────────────────────────────────

  get pulse(): PulseController {
    return this.renderer.pulse;
  }

  startPulse(): void {
    this.renderer.pulse.start();
  }

  stopPulse(): void {
    this.renderer.pulse.stop();
  }

  drawPulseSymbol(x: number, y: number, elapsed?: number): number {
    return this.renderer.drawPulseSymbol(x, y, elapsed);
  }

  drawPulseInStatusBar(y: number, label: string, elapsed?: number): number {
    return this.renderer.drawPulseInStatusBar(y, label, elapsed);
  }

  drawPulseBannerLine(y: number, elapsed?: number): number {
    return this.renderer.drawPulseBannerLine(y, elapsed);
  }

  drawPulseBorderBox(y: number, width: number, title: string, elapsed?: number): { y: number; pulseStyle: number } {
    return this.renderer.drawPulseBorderBox(y, width, title, elapsed);
  }
}
