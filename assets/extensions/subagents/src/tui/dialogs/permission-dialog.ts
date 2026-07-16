import { THEME } from "../theme/theme";
import { fg, fgBold, dim, bold } from "../theme/colorize";
import { measureWidth, stripAnsi } from "../render/format";

export type PermissionAction = "allow-once" | "always-allow" | "reject";

export interface PermissionRequest {
  toolName: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface PermissionOption {
  id: PermissionAction;
  label: string;
  description: string;
}

const OPTIONS: PermissionOption[] = [
  { id: "allow-once", label: "Allow once", description: "Permit this single invocation" },
  { id: "always-allow", label: "Always allow", description: "Add pattern to permitted list" },
  { id: "reject", label: "Reject", description: "Block this invocation" },
];

interface AllowPattern {
  toolName: string;
  pattern: string;
}

const allowedPatterns: AllowPattern[] = [];

export function isToolAllowed(toolName: string, params: Record<string, unknown>): boolean {
  const paramStr = JSON.stringify(params);
  return allowedPatterns.some(
    p => p.toolName === toolName && p.pattern === "*" || (p.toolName === toolName && paramStr.includes(p.pattern))
  );
}

export class PermissionDialog {
  visible = false;
  request: PermissionRequest | null = null;
  selectedIndex = 0;
  onAllowOnce: (() => void) | null = null;
  onAlwaysAllow: ((pattern: string) => void) | null = null;
  onReject: (() => void) | null = null;

  open(request: PermissionRequest): void {
    this.request = request;
    this.visible = true;
    this.selectedIndex = 0;
  }

  close(): void {
    this.visible = false;
    this.request = null;
  }

  handleInput(char: string): "navigate" | "close" | null {
    if (!this.visible) return null;
    if (char === "Escape") {
      this.close();
      if (this.onReject) this.onReject();
      return "close";
    }
    if (char === "\n" || char === "\r") {
      const selected = OPTIONS[this.selectedIndex];
      if (!selected) return null;
      this.visible = false;
      switch (selected.id) {
        case "allow-once":
          if (this.onAllowOnce) this.onAllowOnce();
          break;
        case "always-allow": {
          if (this.request && this.onAlwaysAllow) {
            const params = this.request.parameters;
            const keys = Object.keys(params);
            const pattern = keys.length > 0
              ? `${keys[0]}=${String(params[keys[0]]).slice(0, 20)}*`
              : "*";
            allowedPatterns.push({ toolName: this.request.toolName, pattern });
            this.onAlwaysAllow(pattern);
          }
          break;
        }
        case "reject":
          if (this.onReject) this.onReject();
          break;
      }
      this.close();
      return "close";
    }
    if (char === "\x1b[A") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return "navigate";
    }
    if (char === "\x1b[B") {
      this.selectedIndex = Math.min(OPTIONS.length - 1, this.selectedIndex + 1);
      return "navigate";
    }
    return null;
  }

  render(width: number, _cols: number, rows: number): string[] {
    if (!this.visible || !this.request) return [];
    const ink = THEME.ink;
    const surface = THEME.card;
    const hairline = THEME.hairline;
    const accent = THEME.accent;
    const muted = THEME.muted;
    const error = THEME.error;
    const warning = THEME.warning;
    const success = THEME.success;

    const dW = Math.min(56, width - 4);
    const lines: string[] = [];
    const solidBg = `\x1b[48;2;${parseInt(surface.slice(1,3), 16)};${parseInt(surface.slice(3,5), 16)};${parseInt(surface.slice(5,7), 16)}m`;
    const borderClr = `\x1b[38;2;${parseInt(hairline.slice(1,3), 16)};${parseInt(hairline.slice(3,5), 16)};${parseInt(hairline.slice(5,7), 16)}m`;
    const inkFg = `\x1b[38;2;${parseInt(ink.slice(1,3), 16)};${parseInt(ink.slice(3,5), 16)};${parseInt(ink.slice(5,7), 16)}m`;
    const mutedFg = `\x1b[38;2;${parseInt(muted.slice(1,3), 16)};${parseInt(muted.slice(3,5), 16)};${parseInt(muted.slice(5,7), 16)}m`;
    const accentFg = `\x1b[38;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m`;
    const warningFg = `\x1b[38;2;${parseInt(warning.slice(1,3), 16)};${parseInt(warning.slice(3,5), 16)};${parseInt(warning.slice(5,7), 16)}m`;
    const successFg = `\x1b[38;2;${parseInt(success.slice(1,3), 16)};${parseInt(success.slice(3,5), 16)};${parseInt(success.slice(5,7), 16)}m`;

    const title = " Permission Required ";
    lines.push(`${borderClr}\u250c${solidBg}\u2500${accentFg}${title}\x1b[0m${borderClr}${"\u2500".repeat(Math.max(1, dW - measureWidth(title) - 3))}\u2510\x1b[0m`);

    // Gap
    lines.push(`${solidBg}${" ".repeat(dW)}\x1b[0m`);

    // Tool info
    const toolLabel = ` ${bold("Tool:")} ${this.request.toolName}`;
    lines.push(`${solidBg}${inkFg}\u2502${toolLabel.padEnd(dW - 2)}\u2502\x1b[0m`);

    const descLabel = ` ${bold("Action:")} ${this.request.description}`;
    const truncatedDesc = descLabel.length > dW - 4 ? descLabel.slice(0, dW - 7) + "..." : descLabel;
    lines.push(`${solidBg}${inkFg}\u2502${truncatedDesc.padEnd(dW - 2)}\u2502\x1b[0m`);

    // Parameters
    const paramKeys = Object.keys(this.request.parameters);
    if (paramKeys.length > 0) {
      const paramStr = paramKeys.slice(0, 3).map(k => {
        const v = this.request!.parameters[k];
        const vs = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}=${vs.length > 25 ? vs.slice(0, 25) + "..." : vs}`;
      }).join(", ");
      const paramsLabel = ` ${bold("Args:")} ${paramStr}`;
      const truncatedParams = paramsLabel.length > dW - 4 ? paramsLabel.slice(0, dW - 7) + "..." : paramsLabel;
      lines.push(`${solidBg}${fg(THEME.textTertiary, `\u2502${truncatedParams.padEnd(dW - 2)}`)}\u2502\x1b[0m`);
    }

    lines.push(`${solidBg}${" ".repeat(dW)}\x1b[0m`);

    // Separator
    lines.push(`${solidBg}${borderClr}\u2502${"\u2500".repeat(dW - 4)}\u2502\x1b[0m`);
    lines.push(`${solidBg}${" ".repeat(dW)}\x1b[0m`);

    // Options
    for (let i = 0; i < OPTIONS.length; i++) {
      const opt = OPTIONS[i];
      const selected = i === this.selectedIndex;
      const bg = selected ? `\x1b[48;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m` : solidBg;
      const fgColor = selected ? "\x1b[38;2;255;255;255m" : inkFg;
      const radio = selected ? "\u25C9" : "\u25CB";

      let optLabel: string;
      if (opt.id === "always-allow" && this.request) {
        const params = this.request.parameters;
        const keys = Object.keys(params);
        const pattern = keys.length > 0
          ? `${keys[0]}=${String(params[keys[0]]).slice(0, 12)}*`
          : "*";
        optLabel = ` ${radio} ${opt.label}  (pattern: ${pattern})`;
      } else {
        optLabel = ` ${radio} ${opt.label}`;
      }

      const truncatedOpt = optLabel.length > dW - 6 ? optLabel.slice(0, dW - 9) + "..." : optLabel;
      lines.push(`${bg}${fgColor}\u2502 ${truncatedOpt}${" ".repeat(Math.max(0, dW - 4 - measureWidth(stripAnsi(truncatedOpt))))}\u2502\x1b[0m`);

      // Description
      const descStr = `   ${opt.description}`;
      const truncatedDesc2 = descStr.length > dW - 6 ? descStr.slice(0, dW - 9) + "..." : descStr;
      lines.push(`${bg}${selected ? mutedFg : mutedFg}\u2502 ${truncatedDesc2}${" ".repeat(Math.max(0, dW - 4 - measureWidth(stripAnsi(truncatedDesc2))))}\u2502\x1b[0m`);
    }

    lines.push(`${solidBg}${" ".repeat(dW)}\x1b[0m`);

    // Help
    const helpText = ` [\u2191\u2193] navigate  [Enter] confirm  [Esc] reject `;
    lines.push(`${solidBg}${fg(THEME.dim, `\u2502${helpText.padEnd(dW - 2)}`)}\u2502\x1b[0m`);

    lines.push(`${borderClr}\u2514${"\u2500".repeat(dW - 2)}\u2518\x1b[0m`);
    return lines;
  }
}
