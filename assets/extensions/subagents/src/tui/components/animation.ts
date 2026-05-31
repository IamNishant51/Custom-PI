export class AnimationFrame {
  private frameCallbacks: Map<string, { callback: () => void; interval: number; lastTick: number }> = new Map();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private frameId = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (!this.running) return;
    this.frameId++;
    const now = Date.now();
    for (const [id, entry] of this.frameCallbacks) {
      if (now - entry.lastTick >= entry.interval) {
        entry.lastTick = now;
        try { entry.callback(); } catch {}
      }
    }
    this.timer = setTimeout(() => this.tick(), 16);
  }

  add(id: string, callback: () => void, interval = 80): void {
    this.frameCallbacks.set(id, { callback, interval, lastTick: Date.now() });
  }

  remove(id: string): void {
    this.frameCallbacks.delete(id);
  }

  has(id: string): boolean {
    return this.frameCallbacks.has(id);
  }

  getFrameId(): number {
    return this.frameId;
  }

  clear(): void {
    this.frameCallbacks.clear();
  }

  get size(): number {
    return this.frameCallbacks.size;
  }
}

export class SpinnerController {
  private frames: string[];
  private current = 0;
  private interval: number;
  private id: string;
  private animFrame: AnimationFrame;

  constructor(id: string, frames: string[], interval: number, animFrame: AnimationFrame) {
    this.id = id;
    this.frames = frames;
    this.interval = interval;
    this.animFrame = animFrame;
  }

  start(): void {
    if (this.animFrame.has(this.id)) return;
    this.animFrame.add(this.id, () => {
      this.current = (this.current + 1) % this.frames.length;
    }, this.interval);
  }

  stop(): void {
    this.animFrame.remove(this.id);
  }

  get frame(): string {
    return this.frames[this.current];
  }

  get index(): number {
    return this.current;
  }
}

export class ShimmerBorderController {
  private position = 0;
  private segmentLength = 8;
  private fullLap = 4000;
  private lastTick = 0;
  private animFrame: AnimationFrame;
  private id: string;

  constructor(id: string, animFrame: AnimationFrame) {
    this.id = id;
    this.animFrame = animFrame;
  }

  start(): void {
    if (this.animFrame.has(this.id)) return;
    this.lastTick = Date.now();
    this.animFrame.add(this.id, () => {
      const delta = Date.now() - this.lastTick;
      this.lastTick = Date.now();
      this.position = (this.position + delta / this.fullLap) % 1;
    }, 16);
  }

  stop(): void {
    this.animFrame.remove(this.id);
  }

  getPhase(): number {
    return this.position;
  }

  isLit(cellIndex: number, totalWidth: number): boolean {
    const pos = this.position * totalWidth;
    const start = pos - this.segmentLength / 2;
    const end = pos + this.segmentLength / 2;
    return cellIndex >= start && cellIndex <= end;
  }
}
