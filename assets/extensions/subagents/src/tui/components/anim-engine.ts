// ── Easing Functions ────────────────────────────────────────────────────

export type EasingFn = (t: number) => number;

export const Easing = {
  linear: (t: number) => t,

  quadIn: (t: number) => t * t,
  quadOut: (t: number) => t * (2 - t),
  quadInOut: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  cubicIn: (t: number) => t * t * t,
  cubicOut: (t: number) => --t * t * t + 1,
  cubicInOut: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  elasticOut: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 :
      Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },

  bounceOut: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },

  spring: (t: number, stiffness = 0.15, damping = 0.8) => {
    const decay = Math.pow(damping, t * 10);
    return 1 - decay * Math.cos(t * Math.PI * 2 / stiffness);
  },
};

// ── Color Utilities ─────────────────────────────────────────────────────

export function lerpColor(c1: string, c2: string, t: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${clamp(r1 + (r2 - r1) * t).toString(16).padStart(2, "0")}${clamp(g1 + (g2 - g1) * t).toString(16).padStart(2, "0")}${clamp(b1 + (b2 - b1) * t).toString(16).padStart(2, "0")}`;
}

export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── AnimClip: A single animated property ─────────────────────────────────

export type AnimTarget = "color" | "opacity" | "position" | "rotation" | "scale" | "custom";

export interface AnimClipConfig {
  duration: number;
  delay?: number;
  easing?: EasingFn;
  loop?: boolean;
  yoyo?: boolean;
  onStart?: () => void;
  onUpdate?: (value: number) => void;
  onComplete?: () => void;
}

export class AnimClip {
  readonly duration: number;
  readonly delay: number;
  readonly easing: EasingFn;
  readonly loop: boolean;
  readonly yoyo: boolean;
  readonly onStart?: () => void;
  readonly onUpdate?: (value: number) => void;
  readonly onComplete?: () => void;

  elapsed = 0;
  started = false;
  completed = false;
  direction: 1 | -1 = 1;
  iteration = 0;

  constructor(config: AnimClipConfig) {
    this.duration = config.duration;
    this.delay = config.delay ?? 0;
    this.easing = config.easing ?? Easing.linear;
    this.loop = config.loop ?? false;
    this.yoyo = config.yoyo ?? false;
    this.onStart = config.onStart;
    this.onUpdate = config.onUpdate;
    this.onComplete = config.onComplete;
  }

  tick(delta: number): boolean {
    if (this.completed) return false;

    this.elapsed += delta;

    if (!this.started) {
      if (this.elapsed < this.delay) return true;
      this.started = true;
      this.elapsed -= this.delay;
      this.onStart?.();
    }

    const raw = Math.min(this.elapsed / this.duration, 1);
    const eased = this.easing(raw);
    const value = this.direction === 1 ? eased : 1 - eased;

    this.onUpdate?.(value);

    if (raw >= 1) {
      this.iteration++;
      if (this.yoyo) {
        this.direction *= -1;
        this.elapsed = 0;
        if (this.direction === 1 && !this.loop) {
          this.completed = true;
          this.onComplete?.();
        }
        return true;
      }
      if (this.loop) {
        this.elapsed = 0;
        return true;
      }
      this.completed = true;
      this.onComplete?.();
      return false;
    }

    return true;
  }

  reset(): void {
    this.elapsed = 0;
    this.started = false;
    this.completed = false;
    this.direction = 1;
    this.iteration = 0;
  }
}

// ── AnimTimeline: Composite timeline of clips ────────────────────────────

export type TimelineMode = "parallel" | "sequence";

export class AnimTimeline {
  private clips: AnimClip[] = [];
  private mode: TimelineMode;
  private _active = false;
  private _complete = false;
  private onCompleteCallback?: () => void;

  constructor(mode: TimelineMode = "parallel") {
    this.mode = mode;
  }

  add(clip: AnimClip): this {
    this.clips.push(clip);
    return this;
  }

  get active(): boolean { return this._active; }
  get complete(): boolean { return this._complete; }

  onComplete(cb: () => void): this {
    this.onCompleteCallback = cb;
    return this;
  }

  start(): void {
    this._active = true;
    this._complete = false;
    for (const clip of this.clips) clip.reset();
  }

  stop(): void {
    this._active = false;
  }

  reset(): void {
    this._active = false;
    this._complete = false;
    for (const clip of this.clips) clip.reset();
  }

  tick(delta: number): void {
    if (!this._active || this._complete) return;

    if (this.mode === "parallel") {
      let allDone = true;
      for (const clip of this.clips) {
        const alive = clip.tick(delta);
        if (alive) allDone = false;
      }
      if (allDone) {
        this._complete = true;
        this._active = false;
        this.onCompleteCallback?.();
      }
    } else {
      // Sequence: run clips one after another
      for (const clip of this.clips) {
        if (!clip.completed) {
          const alive = clip.tick(delta);
          if (!alive) {
            // This clip just finished, next tick will start next
          }
          return;
        }
      }
      this._complete = true;
      this._active = false;
      this.onCompleteCallback?.();
    }
  }
}

// ── Built-in Effect Builders ────────────────────────────────────────────

export interface ShimmerBorderConfig {
  colors: string[];
  durationMs: number;
  onColorUpdate: (color: string) => void;
  loop?: boolean;
}

export function createShimmerBorder(cfg: ShimmerBorderConfig): AnimTimeline {
  const timeline = new AnimTimeline("sequence");
  for (let i = 0; i < cfg.colors.length - 1; i++) {
    const c1 = cfg.colors[i];
    const c2 = cfg.colors[i + 1];
    const clip = new AnimClip({
      duration: cfg.durationMs / (cfg.colors.length - 1),
      easing: Easing.quadInOut,
      loop: cfg.loop,
      onUpdate: (t) => {
        cfg.onColorUpdate(lerpColor(c1, c2, t));
      },
    });
    timeline.add(clip);
  }
  return timeline;
}

export interface PulseConfig {
  baseColor: string;
  pulseColor: string;
  durationMs: number;
  breatheAmplitude: number;
  onColorUpdate: (color: string) => void;
  loop?: boolean;
}

export function createPulse(cfg: PulseConfig): AnimTimeline {
  const timeline = new AnimTimeline("parallel");
  const clip = new AnimClip({
    duration: cfg.durationMs,
    easing: Easing.quadInOut,
    loop: cfg.loop ?? true,
    yoyo: true,
    onUpdate: (t) => {
      cfg.onColorUpdate(lerpColor(cfg.baseColor, cfg.pulseColor, t * cfg.breatheAmplitude));
    },
  });
  timeline.add(clip);
  return timeline;
}

export interface TypewriterConfig {
  text: string;
  charDurationMs: number;
  onChar: (char: string, index: number) => void;
  onComplete?: () => void;
}

export function createTypewriter(cfg: TypewriterConfig): AnimTimeline {
  const timeline = new AnimTimeline("sequence");
  for (let i = 0; i < cfg.text.length; i++) {
    const idx = i;
    const clip = new AnimClip({
      duration: cfg.charDurationMs,
      onUpdate: (t) => {
        if (t >= 0.5) {
          cfg.onChar(cfg.text[idx], idx);
        }
      },
    });
    timeline.add(clip);
  }
  timeline.onComplete(() => cfg.onComplete?.());
  return timeline;
}

export interface FadeInConfig {
  durationMs: number;
  onBrightness: (value: number) => void;
}

export function createFadeIn(cfg: FadeInConfig): AnimClip {
  return new AnimClip({
    duration: cfg.durationMs,
    easing: Easing.cubicOut,
    onUpdate: (t) => cfg.onBrightness(t),
  });
}
