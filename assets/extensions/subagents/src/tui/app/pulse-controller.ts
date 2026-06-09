export interface PulseConfig {
  symbol: string;
  restColor: string;
  gradientColors: string[];
  sweepMs: number;
  breatheMs: number;
  breatheAmplitude: number;
  easing: boolean;
}

const DEFAULT_PULSE_CONFIG: PulseConfig = {
  symbol: "\u221e",
  restColor: "#8B6914",
  gradientColors: ["#8B6914", "#B8860B", "#D08770", "#E8923A", "#FF9B4A"],
  sweepMs: 320,
  breatheMs: 2000,
  breatheAmplitude: 0.4,
  easing: true,
};

import { hexToRgb, rgbToHex } from "../utils/color";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function lerpColor(c1: [number, number, number], c2: [number, number, number], t: number): [number, number, number] {
  return [
    lerp(c1[0], c2[0], t),
    lerp(c1[1], c2[1], t),
    lerp(c1[2], c2[2], t),
  ];
}

function gradientAt(gradient: string[], t: number): string {
  if (gradient.length === 0) return "#ffffff";
  if (gradient.length === 1) return gradient[0];
  const clamped = Math.max(0, Math.min(1, t));
  const segments = gradient.length - 1;
  const seg = clamped * segments;
  const idx = Math.min(Math.floor(seg), segments - 1);
  const frac = seg - idx;
  const c1 = hexToRgb(gradient[idx]);
  const c2 = hexToRgb(gradient[idx + 1]);
  return rgbToHex(...lerpColor(c1, c2, frac));
}

export class PulseController {
  private config: PulseConfig;
  private startTime: number;
  private active = false;

  constructor(config?: Partial<PulseConfig>) {
    this.config = { ...DEFAULT_PULSE_CONFIG, ...config };
    this.startTime = Date.now();
  }

  start(): void {
    this.active = true;
    this.startTime = Date.now();
  }

  stop(): void {
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  getConfig(): PulseConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<PulseConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getSweepPhase(elapsed?: number): number {
    const t = (elapsed ?? (Date.now() - this.startTime)) % this.config.sweepMs;
    const raw = t / this.config.sweepMs;
    return this.config.easing ? easeInOut(raw) : raw;
  }

  getBreathPhase(elapsed?: number): number {
    const t = (elapsed ?? (Date.now() - this.startTime)) % this.config.breatheMs;
    return t / this.config.breatheMs;
  }

  getBreathFactor(elapsed?: number): number {
    const phase = this.getBreathPhase(elapsed);
    const sine = (Math.sin(phase * Math.PI * 2) + 1) / 2;
    return 1 - this.config.breatheAmplitude + sine * this.config.breatheAmplitude;
  }

  getCurrentColor(elapsed?: number): string {
    if (!this.active) return this.config.restColor;
    const e = elapsed ?? (Date.now() - this.startTime);
    const sweep = this.getSweepPhase(e);
    const breath = this.getBreathFactor(e);
    const baseColor = gradientAt(this.config.gradientColors, sweep);
    const rgb = hexToRgb(baseColor);
    return rgbToHex(rgb[0] * breath, rgb[1] * breath, rgb[2] * breath);
  }

  getCurrentBrightColor(elapsed?: number): string {
    if (!this.active) return this.config.gradientColors[Math.floor(this.config.gradientColors.length / 2)] ?? this.config.restColor;
    const e = elapsed ?? (Date.now() - this.startTime);
    return gradientAt(this.config.gradientColors, this.getSweepPhase(e));
  }

  getState(elapsed?: number): { color: string; brightColor: string; breathFactor: number } {
    const e = elapsed ?? (Date.now() - this.startTime);
    return {
      color: this.getCurrentColor(e),
      brightColor: this.getCurrentBrightColor(e),
      breathFactor: this.getBreathFactor(e),
    };
  }

  getSymbol(): string {
    return this.config.symbol;
  }
}
