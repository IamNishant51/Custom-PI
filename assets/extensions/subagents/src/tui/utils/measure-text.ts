export function measureWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0;
    if (code >= 0x1100 && (
      code <= 0x115F ||
      code === 0x2329 ||
      code === 0x232A ||
      (code >= 0x2E80 && code <= 0xA4CF) ||
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE10 && code <= 0xFE19) ||
      (code >= 0xFE30 && code <= 0xFE6F) ||
      (code >= 0xFF01 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x1B000 && code <= 0x1B0FF) ||
      (code >= 0x1D000 && code <= 0x1D0FF) ||
      (code >= 0x20000 && code <= 0x2FA1F)
    )) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

export function truncateToWidth(text: string, maxWidth: number): string {
  let w = 0;
  let result = "";
  for (const ch of text) {
    const cw = measureWidth(ch);
    if (w + cw > maxWidth) break;
    result += ch;
    w += cw;
  }
  return result;
}

export function wordWrap(text: string, maxWidth: number): string[] {
  if (maxWidth < 1) return [text];
  const lines: string[] = [];
  const words = text.split(/(\s+)/);
  let current = "";
  let currentW = 0;
  for (const word of words) {
    const ww = measureWidth(word);
    if (currentW + ww > maxWidth && current.length > 0) {
      lines.push(current);
      current = word.trimStart();
      currentW = measureWidth(current);
    } else {
      current += word;
      currentW += ww;
    }
  }
  if (current.length > 0) lines.push(current);
  if (lines.length === 0) lines.push("");
  return lines;
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function applyBgToLine(line: string, width: number, bgCode: string): string {
  const visible = stripAnsi(line);
  const pad = Math.max(0, width - measureWidth(visible));
  return line + (pad > 0 ? bgCode + " ".repeat(pad) + "\x1b[0m" : "");
}
