export interface StyledSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseInline(text: string, code: boolean = false): StyledSegment[] {
  if (code) return [{ text, code: true }];

  const segments: StyledSegment[] = [];

  const re = /(`[^`]+`)|(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(\[(.+?)\]\((.+?)\))/g;
  let last = 0;

  for (;;) {
    const m = re.exec(text);
    if (!m) break;

    if (m.index > last) {
      segments.push({ text: text.slice(last, m.index) });
    }

    if (m[1]) {
      segments.push({ text: m[1].slice(1, -1), code: true });
    } else if (m[2]) {
      segments.push({ text: m[3], bold: true, italic: true });
    } else if (m[4]) {
      segments.push({ text: m[5], bold: true });
    } else if (m[6]) {
      segments.push({ text: m[7], italic: true });
    } else if (m[8]) {
      segments.push({ text: m[9], link: m[10] });
    }

    last = re.lastIndex;
  }

  if (last < text.length) {
    segments.push({ text: text.slice(last) });
  }

  return segments.length > 0 ? segments : [{ text }];
}
