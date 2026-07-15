export interface TranscriptEntry {
  role: string;
  content: string;
  timestamp: number;
  tokens?: number;
}

export class TranscriptViewer {
  visible = false;
  entries: TranscriptEntry[] = [];
  scrollOffset = 0;

  open(entries: TranscriptEntry[]): void {
    this.entries = entries;
    this.visible = true;
    this.scrollOffset = Math.max(0, entries.length - 50);
  }

  close(): void {
    this.visible = false;
  }

  handleInput(char: string): "navigate" | "close" | null {
    if (!this.visible) return null;
    if (char === "Escape") { this.close(); return "close"; }
    if (char === "\x1b[A") { this.scrollOffset = Math.max(0, this.scrollOffset - 1); return "navigate"; }
    if (char === "\x1b[B") { this.scrollOffset = Math.min(this.entries.length - 1, this.scrollOffset + 1); return "navigate"; }
    if (char === "\x1b[5~") { this.scrollOffset = Math.max(0, this.scrollOffset - 20); return "navigate"; } // PageUp
    if (char === "\x1b[6~") { this.scrollOffset = Math.min(this.entries.length - 1, this.scrollOffset + 20); return "navigate"; } // PageDown
    return null;
  }

  render(width: number, _cols: number, rows: number): string[] {
    if (!this.visible) return [];
    const lines: string[] = [];
    const maxH = rows - 4;
    const title = ` Transcript (${this.entries.length} msgs) `;
    lines.push(`\u250c${"\u2500".repeat(Math.max(2, width - 2))}\u2510`.replace("\u2500".repeat(Math.max(2, width - 2)), `\u2500${title}\u2500`));
    const visible = this.entries.slice(this.scrollOffset, this.scrollOffset + maxH);
    for (const entry of visible) {
      const ts = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const role = entry.role === "user" ? "\u25b6 You" : entry.role === "assistant" ? "\u25c0 AI" : "\u25c7 Sys";
      const tk = entry.tokens ? ` [${entry.tokens}t]` : "";
      const preview = entry.content.slice(0, width - 16).replace(/\n/g, " ");
      lines.push(`\u2502 ${ts} ${role.padEnd(6)}${tk} ${preview}\u2502`);
    }
    lines.push(`\u2514${"\u2500".repeat(width - 2)}\u2518`);
    return lines;
  }
}
