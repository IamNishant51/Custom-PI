import { THEME } from "./theme/theme";

export type ToastLevel = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  message: string;
  level: ToastLevel;
  createdAt: number;
  duration: number;
}

const LEVEL_COLORS: Record<ToastLevel, string> = {
  info: "\x1b[38;2;100;180;255m",
  success: "\x1b[38;2;80;220;100m",
  warning: "\x1b[38;2;255;200;60m",
  error: "\x1b[38;2;255;80;80m",
};

const LEVEL_ICONS: Record<ToastLevel, string> = {
  info: "\u24d8",
  success: "\u2713",
  warning: "\u26a0",
  error: "\u2717",
};

export class ToastManager {
  private toasts: Toast[] = [];
  private nextId = 1;
  private maxVisible = 3;

  show(message: string, level: ToastLevel = "info", duration = 4000): void {
    this.toasts.push({ id: this.nextId++, message, level, createdAt: Date.now(), duration });
    if (this.toasts.length > 20) this.toasts = this.toasts.slice(-20);
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  clear(): void {
    this.toasts = [];
  }

  getActive(): Toast[] {
    const now = Date.now();
    this.toasts = this.toasts.filter(t => now - t.createdAt < t.duration);
    return this.toasts.slice(-this.maxVisible);
  }

  render(width: number): string[] {
    const active = this.getActive();
    if (!active.length) return [];

    const ink = THEME.ink;
    const lines: string[] = [];

    for (const toast of active) {
      const elapsed = Date.now() - toast.createdAt;
      const fadeStart = toast.duration * 0.75;
      const alpha = elapsed > fadeStart ? 1 - (elapsed - fadeStart) / (toast.duration - fadeStart) : 1;
      const dim = alpha < 0.5 ? "\x1b[2m" : "";
      const icon = LEVEL_ICONS[toast.level];
      const color = LEVEL_COLORS[toast.level];
      const msg = toast.message.slice(0, width - 8);
      lines.push(`${dim}${color}\u2502 ${icon} ${msg}\x1b[0m`);
    }

    return lines;
  }
}
