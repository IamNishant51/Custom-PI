export interface SearchState {
  visible: boolean;
  query: string;
  matchCount: number;
  currentMatch: number;
  /** For each visible message, the match ranges */
}

export class InChatSearch {
  private _state: SearchState = {
    visible: false, query: "", matchCount: 0, currentMatch: 0,
  };

  get state() { return this._state; }

  toggle(): void {
    this._state.visible = !this._state.visible;
    if (!this._state.visible) this._state.query = "";
  }

  open(): void {
    this._state.visible = true;
  }

  close(): void {
    this._state.visible = false;
    this._state.query = "";
  }

  setQuery(q: string): void {
    this._state.query = q;
  }

  setMatchInfo(count: number, current: number): void {
    this._state.matchCount = count;
    this._state.currentMatch = Math.min(current, Math.max(0, count - 1));
  }

  nextMatch(): void {
    if (this._state.matchCount === 0) return;
    this._state.currentMatch = (this._state.currentMatch + 1) % this._state.matchCount;
  }

  prevMatch(): void {
    if (this._state.matchCount === 0) return;
    this._state.currentMatch = (this._state.currentMatch - 1 + this._state.matchCount) % this._state.matchCount;
  }

  handleInput(char: string): "navigate" | "close" | null {
    if (!this._state.visible) return null;
    if (char === "Escape") { this.close(); return "close"; }
    if (char === "\n" || char === "\r") { this.nextMatch(); return "navigate"; }
    if (char === "\x1b[A") { this.prevMatch(); return "navigate"; }
    if (char === "\x1b[B") { this.nextMatch(); return "navigate"; }
    if (char === "Backspace" || char === "\x7f") {
      this._state.query = this._state.query.slice(0, -1);
      return "navigate";
    }
    const erased = char === "Backspace" || char === "\x7f";
    if (!erased && char.length === 1 && char.charCodeAt(0) >= 32) {
      this._state.query += char;
      return "navigate";
    }
    return null;
  }

  highlightText(text: string, matchStart: number, matchEnd: number): string {
    const before = text.slice(0, matchStart);
    const match = text.slice(matchStart, matchEnd);
    const after = text.slice(matchEnd);
    return `${before}\x1b[7m${match}\x1b[27m${after}`;
  }

  /** Find all match ranges in a string (case-insensitive) */
  findMatches(text: string, query: string): { start: number; end: number }[] {
    if (!query) return [];
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const matches: { start: number; end: number }[] = [];
    let pos = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      matches.push({ start: pos, end: pos + q.length });
      pos += q.length;
    }
    return matches;
  }

  render(width: number): string[] {
    if (!this._state.visible) return [];
    const { query, matchCount, currentMatch } = this._state;
    const indicator = matchCount > 0 ? `${currentMatch + 1}/${matchCount}` : "0/0";
    const bar = `\u{1F50D} ${query || ""}\u258c${indicator.padStart(8)} `;
    return [bar.slice(0, width)];
  }
}
