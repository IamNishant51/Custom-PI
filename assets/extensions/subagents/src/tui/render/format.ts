import { visibleWidth } from "@earendil-works/pi-tui";
export { visibleWidth };
import { measureWidth } from "../utils/measure-text";
export { measureWidth };
import { THEME } from "../theme/theme";
import { fg } from "../theme/colorize";

export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B\].*?\x07|\x1B\[.*?m/g, "");
}

export function truncateToWidth(str: string, width: number): string {
  const plain = stripAnsi(str);
  if (measureWidth(plain) <= width) return str;
  let result = "";
  let visibleLen = 0;
  let inAnsi = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === "\x1B") {
      inAnsi = true;
      result += char;
    } else if (inAnsi) {
      result += char;
      if (char.match(/[a-zA-Z]/)) {
        inAnsi = false;
      }
    } else {
      const cw = measureWidth(char);
      if (visibleLen + cw <= width) {
        result += char;
        visibleLen += cw;
      } else {
        break;
      }
    }
  }
  return result + "\x1B[0m";
}

export function wordWrap(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (measureWidth(stripAnsi(rawLine)) <= maxWidth) {
      lines.push(rawLine);
      continue;
    }
    let remaining = rawLine;
    while (measureWidth(stripAnsi(remaining)) > maxWidth) {
      let breakIdx = -1;
      let visLen = 0;
      let inAnsi = false;
      for (let i = 0; i < remaining.length; i++) {
        const ch = remaining[i];
        if (ch === "\x1B") { inAnsi = true; continue; }
        if (inAnsi) { if (ch.match(/[a-zA-Z]/)) inAnsi = false; continue; }
        const cw = measureWidth(ch);
        if (visLen + cw > maxWidth) break;
        visLen += cw;
        if (ch === " ") breakIdx = i;
      }
      if (breakIdx <= 0) {
        const ansiMatch = remaining.match(/^\x1B\[[0-9;]*m/);
        if (ansiMatch) { breakIdx = ansiMatch[0].length + maxWidth - 1; }
        else { breakIdx = maxWidth; }
      }
      lines.push(remaining.slice(0, breakIdx + 1).trimEnd());
      remaining = remaining.slice(breakIdx + 1).trimStart();
    }
    if (remaining) lines.push(remaining);
  }
  return lines;
}

export function elapsed(startTime: number, endTime?: number): string {
  const ms = (endTime || Date.now()) - startTime;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export function truncate(str: string, maxLen: number): string {
  const plain = stripAnsi(str);
  if (measureWidth(plain) <= maxLen) return str;
  let visible = 0;
  let result = "";
  let inAnsi = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "\x1B") { inAnsi = true; result += ch; continue; }
    if (inAnsi) { result += ch; if (ch.match(/[a-zA-Z]/)) inAnsi = false; continue; }
    const cw = measureWidth(ch);
    if (visible + cw > maxLen - 1) break;
    result += ch;
    visible += cw;
  }
  return result + "\u2026";
}

export function progressBar(current: number, total: number, width: number, color?: string): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  const filledPart = "\u2588".repeat(filled);
  const emptyPart = "\u2591".repeat(empty);
  if (color) {
    return fg(color, filledPart) + fg(THEME.muted, emptyPart);
  }
  return filledPart + emptyPart;
}

export function truncateLines(lines: string[], maxWidth: number): string[] {
  return lines.map(line => {
    const vw = visibleWidth(line);
    if (vw > maxWidth) return truncateToWidth(line, maxWidth);
    if (vw < maxWidth) return line + " ".repeat(maxWidth - vw);
    return line;
  });
}
