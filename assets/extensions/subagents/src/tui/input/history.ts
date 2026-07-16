import { measureWidth } from "../utils/measure-text";

export interface KeyEvent {
  ctrl?: boolean;
  key: string;
}

export class PromptHistory {
  private history: string[] = [];
  private filteredResults: string[] = [];
  private selectedIndex: number = 0;
  private query: string = "";
  private visible: boolean = false;

  get isVisible(): boolean {
    return this.visible;
  }

  get currentQuery(): string {
    return this.query;
  }

  get currentSelected(): string | null {
    if (this.filteredResults.length === 0) return null;
    return this.filteredResults[this.selectedIndex] ?? null;
  }

  activate(): void {
    this.visible = true;
    this.query = "";
    this.selectedIndex = 0;
    this.filterResults();
  }

  deactivate(): void {
    this.visible = false;
    this.query = "";
    this.selectedIndex = 0;
    this.filteredResults = [];
  }

  setHistory(entries: string[]): void {
    this.history = entries;
    this.filterResults();
  }

  pushEntry(entry: string): void {
    if (!entry) return;
    if (this.history[this.history.length - 1] === entry) return;
    this.history.push(entry);
    this.filterResults();
  }

  onKey(data: string): "select" | "cancel" | "cycle" | "update" | null {
    if (!this.visible) return null;

    if (data === "\x12") {
      this.cycleResult();
      return "cycle";
    }

    if (data === "\x7f" || data === "\b") {
      this.query = this.query.slice(0, -1);
      this.selectedIndex = 0;
      this.filterResults();
      return "update";
    }

    if (data === "\r" || data === "\n") {
      if (this.filteredResults.length > 0 && this.filteredResults[this.selectedIndex]) {
        return "select";
      }
      return "cancel";
    }

    if (data === "\x1b" || data === "\x03") {
      return "cancel";
    }

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.query += data;
      this.selectedIndex = 0;
      this.filterResults();
      return "update";
    }

    return null;
  }

  private cycleResult(): void {
    if (this.filteredResults.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.filteredResults.length;
  }

  private filterResults(): void {
    if (!this.query) {
      this.filteredResults = [...this.history];
    } else {
      const q = this.query.toLowerCase();
      this.filteredResults = this.history.filter(e => e.toLowerCase().includes(q));
    }
    if (this.selectedIndex >= this.filteredResults.length) {
      this.selectedIndex = 0;
    }
  }

  render(width: number): string[] {
    if (!this.visible) return [];

    const lines: string[] = [];

    const title = "\u2500 Prompt History \u2500";
    const titlePad = Math.max(0, width - measureWidth(title));
    lines.push(title + "\u2500".repeat(titlePad));

    const queryLine = `  > ${this.query}`;
    lines.push(queryLine);

    const matchCount = this.filteredResults.length;
    const matchHeader = `  \u2500 ${matchCount} ${matchCount === 1 ? "match" : "matches"} \u2500`;
    lines.push(matchHeader);

    const maxDisplay = Math.min(this.filteredResults.length, 10);
    const startIdx = Math.max(0, this.selectedIndex - 5);
    const endIdx = Math.min(startIdx + 10, this.filteredResults.length);

    for (let i = startIdx; i < endIdx; i++) {
      const entry = this.filteredResults[i];
      if (!entry) continue;
      const isSelected = i === this.selectedIndex;
      const prefix = isSelected ? "  \u25c9 " : "  \u25cb ";
      const line = prefix + entry;
      lines.push(line);
    }

    const helpLine = `  [Ctrl+R cycle] [Enter select] [Esc cancel]`;
    lines.push("");
    lines.push(helpLine);

    return lines;
  }
}
