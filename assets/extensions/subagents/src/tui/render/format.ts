import chalk from "chalk";
import { C } from "../../tui-colors";
import { visibleWidth } from "@earendil-works/pi-tui";

export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B\].*?\x07|\x1B\[.*?m/g, "");
}

export function truncateToWidth(str: string, width: number): string {
  if (stripAnsi(str).length <= width) return str;
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
      if (visibleLen < width) {
        result += char;
        visibleLen++;
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
    if (stripAnsi(rawLine).length <= maxWidth) {
      lines.push(rawLine);
      continue;
    }
    let remaining = rawLine;
    while (stripAnsi(remaining).length > maxWidth) {
      let breakIdx = -1;
      let visLen = 0;
      let inAnsi = false;
      for (let i = 0; i < remaining.length; i++) {
        const ch = remaining[i];
        if (ch === "\x1B") { inAnsi = true; continue; }
        if (inAnsi) { if (ch.match(/[a-zA-Z]/)) inAnsi = false; continue; }
        visLen++;
        if (visLen > maxWidth) break;
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
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "\u2026";
}

export function progressBar(current: number, total: number, width: number, color?: string): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  const filledPart = "\u2588".repeat(filled);
  const emptyPart = "\u2591".repeat(empty);
  if (color) {
    return chalk.hex(color)(filledPart) + chalk.hex(C.dusty)(emptyPart);
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
