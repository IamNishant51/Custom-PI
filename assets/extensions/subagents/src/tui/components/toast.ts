export type ToastType = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  createdAt: number;
}

export class ToastManager {
  private toasts: Toast[] = [];
  private maxVisible = 3;
  private defaultDuration = 4000;

  show(message: string, type: ToastType = "info", duration?: number): string {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.toasts.push({
      id,
      message,
      type,
      duration: duration ?? this.defaultDuration,
      createdAt: Date.now(),
    });
    // Trim expired
    this.prune();
    return id;
  }

  dismiss(id: string): void {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  getActive(): Toast[] {
    this.prune();
    return this.toasts.slice(-this.maxVisible);
  }

  private prune(): void {
    const now = Date.now();
    this.toasts = this.toasts.filter(t => (now - t.createdAt) < t.duration);
  }

  clear(): void {
    this.toasts = [];
  }
}

export const toastColors: Record<ToastType, string> = {
  info: "#5ac8fa",
  success: "#30d158",
  warning: "#ff9f0a",
  error: "#ff3b30",
};

export const toastIcons: Record<ToastType, string> = {
  info: "\u2139",
  success: "\u2713",
  warning: "\u26a0",
  error: "\u2717",
};
