import { THEME } from "../theme/theme";
import { measureWidth } from "../render/format";

export type DialogResult = "confirm" | "cancel" | "dismiss";

export interface DialogConfig {
  title: string;
  body: string[];
  confirmText?: string;
  cancelText?: string;
  width?: number;
  height?: number;
  variant?: "info" | "warning" | "danger";
}

export class Dialog {
  config: DialogConfig;
  result: DialogResult | null = null;
  visible = false;
  selectedIndex = 0; // 0 = confirm, 1 = cancel

  private confirmText: string;
  private cancelText: string;

  constructor(config: DialogConfig) {
    this.config = config;
    this.confirmText = config.confirmText || "OK";
    this.cancelText = config.cancelText || "Cancel";
  }

  open(): void {
    this.visible = true;
    this.result = null;
    this.selectedIndex = 0;
  }

  close(result?: DialogResult): void {
    this.visible = false;
    if (result) this.result = result;
  }

  handleInput(char: string): "navigate" | "confirm" | "cancel" | null {
    if (!this.visible) return null;
    if (char === "Escape") { this.close("dismiss"); return "cancel"; }
    if (char === "\n" || char === "\r") {
      const r = this.selectedIndex === 0 ? "confirm" : "cancel";
      this.close(r);
      return r;
    }
    if (char === "\t" || char === "\x1b[C" || char === "\x1b[D") {
      this.selectedIndex = this.selectedIndex === 0 ? 1 : 0;
      return "navigate";
    }
    return null;
  }

  render(width: number, _cols: number, rows: number): string[] {
    if (!this.visible) return [];
    const ink = THEME.ink;
    const surface = THEME.card;
    const hairline = THEME.hairline;
    const accent = THEME.accent;
    const muted = THEME.muted;

    const dW = Math.min(this.config.width || 50, width - 4);
    const dH = Math.min(this.config.height || 10, rows - 4);
    const lines: string[] = [];

    const solidBg = `\x1b[48;2;${parseInt(surface.slice(1,3), 16)};${parseInt(surface.slice(3,5), 16)};${parseInt(surface.slice(5,7), 16)}m`;
    const borderClr = `\x1b[38;2;${parseInt(hairline.slice(1,3), 16)};${parseInt(hairline.slice(3,5), 16)};${parseInt(hairline.slice(5,7), 16)}m`;
    const inkFg = `\x1b[38;2;${parseInt(ink.slice(1,3), 16)};${parseInt(ink.slice(3,5), 16)};${parseInt(ink.slice(5,7), 16)}m`;
    const accentFg = `\x1b[38;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m`;

    const padL = Math.floor((dW - measureWidth(this.config.title)) / 2);
    lines.push(`${borderClr}\u250c${solidBg}${" ".repeat(Math.max(1, padL))}${accentFg}${this.config.title}\x1b[0m${borderClr}${" ".repeat(Math.max(1, dW - padL - measureWidth(this.config.title) - 2))}\u2510`);

    const bodyLines = this.config.body.slice(0, dH - 3);
    for (const bl of bodyLines) {
      lines.push(`${solidBg}${inkFg} ${bl.padEnd(dW - 2)} \x1b[0m`);
    }
    // Fill remaining height
    for (let i = bodyLines.length; i < dH - 2; i++) {
      lines.push(`${solidBg}${" ".repeat(dW)}\x1b[0m`);
    }

    // Button row
    const btnW = Math.max(measureWidth(this.confirmText) + 4, 8);
    const btnGap = 2;
    const btnRowW = btnW * 2 + btnGap;
    const btnPad = Math.max(1, Math.floor((dW - btnRowW) / 2));

    const confirmSel = this.selectedIndex === 0;
    const cancelSel = this.selectedIndex === 1;
    const btnBg0 = confirmSel ? `\x1b[48;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m` : solidBg;
    const btnFg0 = confirmSel ? "\x1b[38;2;255;255;255m" : accentFg;
    const btnBg1 = cancelSel ? `\x1b[48;2;${parseInt(muted.slice(1,3), 16)};${parseInt(muted.slice(3,5), 16)};${parseInt(muted.slice(5,7), 16)}m` : solidBg;
    const btnFg1 = cancelSel ? "\x1b[38;2;255;255;255m" : inkFg;

    const btn0 = `${btnBg0}${btnFg0} ${this.confirmText.padEnd(btnW - 3)} \x1b[0m`;
    const btn1 = `${btnBg1}${btnFg1} ${this.cancelText.padEnd(btnW - 3)} \x1b[0m`;
    lines.push(`${solidBg}${" ".repeat(btnPad)}${btn0}${" ".repeat(btnGap)}${btn1}${" ".repeat(dW - btnPad - btnRowW)}\x1b[0m`);

    const bottom = `${borderClr}\u2514${"\u2500".repeat(dW - 2)}\u2518\x1b[0m`;
    lines.push(bottom);

    return lines;
  }
}
