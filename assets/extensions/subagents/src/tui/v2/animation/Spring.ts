export interface SpringConfig {
  damping: number;
  stiffness: number;
  mass: number;
  velocity?: number;
  precision?: number;
  clamp?: boolean;
}

export const SPRING_PRESETS = {
  snappy:    { damping: 28, stiffness: 280 },
  smooth:    { damping: 28, stiffness: 180 },
  bouncy:    { damping: 20, stiffness: 180 },
  gentle:    { damping: 35, stiffness: 120 },
  stiff:     { damping: 40, stiffness: 400 },
} as const;

export type SpringPreset = keyof typeof SPRING_PRESETS;

export class Spring {
  private damping: number;
  private stiffness: number;
  private mass: number;
  private velocity: number;
  private precision: number;
  private clamp: boolean;

  private position = 0;
  private _done = false;

  constructor(config: SpringConfig) {
    this.damping = config.damping;
    this.stiffness = config.stiffness;
    this.mass = config.mass;
    this.velocity = config.velocity ?? 0;
    this.precision = config.precision ?? 0.01;
    this.clamp = config.clamp ?? false;
  }

  update(dt: number): { value: number; done: boolean } {
    if (this._done) return { value: this.position, done: true };

    const dtMs = dt / 1000; // Convert ms to seconds
    const acceleration = (-this.stiffness * this.position - this.damping * this.velocity) / this.mass;
    this.velocity += acceleration * dtMs;
    this.position += this.velocity * dtMs;

    if (this.clamp) {
      this.position = Math.max(0, Math.min(1, this.position));
    }

    const atRest = Math.abs(this.velocity) < this.precision && Math.abs(this.position) < this.precision;

    if (atRest) {
      this.position = this.position > 0.5 ? 1 : 0;
      this.velocity = 0;
      this._done = true;
    }

    return { value: this.position, done: this._done };
  }

  reset(position = 0, velocity = 0): void {
    this.position = position;
    this.velocity = velocity;
    this._done = false;
  }

  get done(): boolean {
    return this._done;
  }

  get value(): number {
    return this.position;
  }
}

export interface AnimClipConfig {
  duration: number;
  delay?: number;
  easing?: (t: number) => number;
  loop?: boolean;
  yoyo?: boolean;
  onStart?: () => void;
  onUpdate?: (value: number) => void;
  onComplete?: () => void;
}

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
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
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

  tick(dt: number): boolean {
    if (this.completed) return false;

    this.elapsed += dt;

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

  start(): void {
    this._active = true;
    this._complete = false;
    for (const clip of this.clips) clip.reset();
  }

  tick(dt: number): boolean {
    if (!this._active || this._complete) return false;

    let anyActive = false;

    if (this.mode === "parallel") {
      for (const clip of this.clips) {
        if (clip.tick(dt)) anyActive = true;
      }
    } else {
      for (const clip of this.clips) {
        if (clip.completed) continue;
        if (clip.tick(dt)) {
          anyActive = true;
          break;
        }
      }
    }

    if (!anyActive) {
      this._complete = true;
      this._active = false;
      this.onCompleteCallback?.();
    }

    return anyActive;
  }

  onComplete(cb: () => void): this {
    this.onCompleteCallback = cb;
    return this;
  }

  reset(): void {
    this._active = false;
    this._complete = false;
    for (const clip of this.clips) clip.reset();
  }

  get active(): boolean {
    return this._active;
  }

  get complete(): boolean {
    return this._complete;
  }
}

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

export function createFadeIn(config: { duration?: number; delay?: number } = {}): AnimClip {
  return new AnimClip({
    duration: config.duration ?? 300,
    delay: config.delay ?? 0,
    easing: Easing.cubicOut,
    onUpdate: (v) => {},
  });
}

export function createFadeOut(config: { duration?: number; delay?: number } = {}): AnimClip {
  return new AnimClip({
    duration: config.duration ?? 200,
    delay: config.delay ?? 0,
    easing: Easing.cubicIn,
    onUpdate: (v) => {},
  });
}

export function createSlideIn(direction: "up" | "down" | "left" | "right", config: { duration?: number; delay?: number } = {}): AnimClip {
  return new AnimClip({
    duration: config.duration ?? 300,
    delay: config.delay ?? 0,
    easing: Easing.cubicOut,
    onUpdate: (v) => {},
  });
}

export function createScaleIn(config: { duration?: number; delay?: number } = {}): AnimClip {
  return new AnimClip({
    duration: config.duration ?? 200,
    delay: config.delay ?? 0,
    easing: Easing.quadOut,
    onUpdate: (v) => {},
  });
}

export function createShimmer(config: { duration?: number; colors: string[] }): AnimTimeline {
  const timeline = new AnimTimeline("sequence");
  for (let i = 0; i < config.colors.length - 1; i++) {
    timeline.add(new AnimClip({
      duration: (config.duration ?? 1500) / (config.colors.length - 1),
      easing: Easing.cubicInOut,
      onUpdate: (v) => {},
    }));
  }
  return timeline;
}

export function createPulse(config: { duration?: number; min: number; max: number } = {}): AnimTimeline {
  const timeline = new AnimTimeline("sequence");
  timeline.add(new AnimClip({
    duration: config.duration ?? 1000,
    easing: Easing.quadInOut,
    yoyo: true,
    loop: true,
    onUpdate: (v) => {},
  }));
  return timeline;
}