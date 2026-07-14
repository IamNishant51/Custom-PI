import { logger } from "../../logger";

export class RenderScheduler {
  private frameCallbacks: Map<string, { callback: () => void; interval: number; lastTick: number; running: boolean }> = new Map();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private frameId = 0;
  private lastTickWall = 0;
  private fps = 60;
  private tickGuard = false;

  start(fps = 60): void {
    this.fps = fps;
    if (this.running) return;
    this.running = true;
    this.lastTickWall = Date.now();
    this.tick();
  }

  stop(): void {
    this.running = false;
    this.tickGuard = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  setFps(fps: number): void {
    this.fps = fps;
  }

  private tick(): void {
    if (!this.running) return;
    if (this.tickGuard) {
      this.timer = setTimeout(() => this.tick(), Math.max(1, Math.round(1000 / this.fps)));
      return;
    }
    this.tickGuard = true;
    try {
      this.frameId++;
      const now = Date.now();
      for (const [id, entry] of this.frameCallbacks) {
        if (entry.running) continue;
        if (now - entry.lastTick >= entry.interval) {
          entry.lastTick = now;
          entry.running = true;
          try {
            entry.callback();
          } catch (err: any) {
            try { process.stderr.write(`\x1b[31m[Scheduler] ${id} error: ${err.message}\x1b[0m\n`); } catch {}
          } finally {
            entry.running = false;
          }
        }
      }
      const elapsed = now - this.lastTickWall;
      this.lastTickWall = now;
      const targetMs = Math.max(16, Math.round(1000 / this.fps));
      const delay = Math.max(1, targetMs - elapsed);
      this.timer = setTimeout(() => this.tick(), delay);
    } finally {
      this.tickGuard = false;
    }
  }

  add(id: string, callback: () => void, interval = 80): () => void {
    this.frameCallbacks.set(id, { callback, interval, lastTick: Date.now(), running: false });
    return () => { this.frameCallbacks.delete(id); };
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
  private scheduler: RenderScheduler;

  constructor(id: string, frames: string[], interval: number, scheduler: RenderScheduler) {
    this.id = id;
    this.frames = frames;
    this.interval = interval;
    this.scheduler = scheduler;
  }

  start(): void {
    if (this.scheduler.has(this.id)) return;
    this.scheduler.add(this.id, () => {
      this.current = (this.current + 1) % this.frames.length;
    }, this.interval);
  }

  stop(): void {
    this.scheduler.remove(this.id);
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
  private scheduler: RenderScheduler;
  private id: string;

  constructor(id: string, scheduler: RenderScheduler) {
    this.id = id;
    this.scheduler = scheduler;
  }

  start(): void {
    if (this.scheduler.has(this.id)) return;
    this.lastTick = Date.now();
    this.scheduler.add(this.id, () => {
      const delta = Date.now() - this.lastTick;
      this.lastTick = Date.now();
      this.position = (this.position + delta / this.fullLap) % 1;
    }, 16);
  }

  stop(): void {
    this.scheduler.remove(this.id);
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
