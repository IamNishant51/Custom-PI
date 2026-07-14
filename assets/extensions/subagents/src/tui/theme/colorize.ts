import { hexToRgb } from "../utils/color";

export function fg(hex: string, text: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

export function fgBold(hex: string, text: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m\x1b[1m${text}\x1b[0m`;
}

export function bg(hex: string, text: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m${text}\x1b[0m`;
}

export function bgFg(bgHex: string, fgHex: string, text: string): string {
  const [br, bg2, bb] = hexToRgb(bgHex);
  const [fr, fg2, fb] = hexToRgb(fgHex);
  return `\x1b[48;2;${br};${bg2};${bb}m\x1b[38;2;${fr};${fg2};${fb}m${text}\x1b[0m`;
}

export function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

export function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}
