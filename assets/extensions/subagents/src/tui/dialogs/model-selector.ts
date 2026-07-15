import { THEME } from "../theme/theme";
import { measureWidth } from "../render/format";

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
}

export class ModelSelector {
  visible = false;
  models: ModelEntry[] = [];
  selectedIndex = 0;
  onSelect: ((model: ModelEntry) => void) | null = null;

  private filterQuery = "";

  open(models: ModelEntry[]): void {
    this.models = models;
    this.visible = true;
    this.selectedIndex = 0;
    this.filterQuery = "";
  }

  close(): void {
    this.visible = false;
  }

  get filteredModels(): ModelEntry[] {
    if (!this.filterQuery) return this.models;
    const q = this.filterQuery.toLowerCase();
    return this.models.filter(m =>
      m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }

  handleInput(char: string): "navigate" | "select" | "close" | null {
    if (!this.visible) return null;
    if (char === "Escape") { this.close(); return "close"; }
    if (char === "\n" || char === "\r") {
      const model = this.filteredModels[this.selectedIndex];
      if (model && this.onSelect) this.onSelect(model);
      this.close();
      return "select";
    }
    if (char === "\x1b[A") { // ArrowUp
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return "navigate";
    }
    if (char === "\x1b[B") { // ArrowDown
      this.selectedIndex = Math.min(this.filteredModels.length - 1, this.selectedIndex + 1);
      return "navigate";
    }
    if (char === "Backspace" || char === "\x7f") {
      this.filterQuery = this.filterQuery.slice(0, -1);
      this.selectedIndex = 0;
      return "navigate";
    }
    if (char.length === 1 && char.charCodeAt(0) >= 32) {
      this.filterQuery += char;
      this.selectedIndex = 0;
      return "navigate";
    }
    return null;
  }

  render(width: number, _cols: number, rows: number): string[] {
    if (!this.visible || !this.models.length) return [];
    const ink = THEME.ink;
    const surface = THEME.card;
    const hairline = THEME.hairline;
    const accent = THEME.accent;
    const muted = THEME.muted;

    const dW = Math.min(64, width - 4);
    const maxItems = Math.min(12, rows - 6);
    const lines: string[] = [];
    const solidBg = `\x1b[48;2;${parseInt(surface.slice(1,3), 16)};${parseInt(surface.slice(3,5), 16)};${parseInt(surface.slice(5,7), 16)}m`;
    const borderClr = `\x1b[38;2;${parseInt(hairline.slice(1,3), 16)};${parseInt(hairline.slice(3,5), 16)};${parseInt(hairline.slice(5,7), 16)}m`;
    const inkFg = `\x1b[38;2;${parseInt(ink.slice(1,3), 16)};${parseInt(ink.slice(3,5), 16)};${parseInt(ink.slice(5,7), 16)}m`;
    const mutedFg = `\x1b[38;2;${parseInt(muted.slice(1,3), 16)};${parseInt(muted.slice(3,5), 16)};${parseInt(muted.slice(5,7), 16)}m`;

    const title = " Model Selector ";
    lines.push(`${borderClr}\u250c${solidBg}\u2500${title}\u2500${"\u2500".repeat(Math.max(1, dW - measureWidth(title) - 3))}\u2510\x1b[0m`);

    // Filter input
    const filterDisplay = `\u{1F50D} ${this.filterQuery || "type to filter..."}`;
    lines.push(`${solidBg}${inkFg}\u2502${filterDisplay.padEnd(dW - 2)}\u2502\x1b[0m`);

    const filtered = this.filteredModels;
    for (let i = 0; i < Math.min(maxItems, filtered.length); i++) {
      const model = filtered[i];
      const selected = i === this.selectedIndex;
      const bg = selected ? `\x1b[48;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m` : solidBg;
      const fg = selected ? "\x1b[38;2;255;255;255m" : inkFg;
      const ctx = `(${model.contextWindow.toLocaleString()})`;
      const line = ` ${model.name.padEnd(28)} ${mutedFg}${model.provider.padEnd(12)}\x1b[0m${fg} ${mutedFg}${ctx}\x1b[0m`;
      lines.push(`${bg}${fg}\u2502 ${model.id.padEnd(12)}${line.padEnd(dW - 18)}\u2502\x1b[0m`);
    }
    if (filtered.length === 0) {
      lines.push(`${solidBg}${mutedFg}\u2502 ${"No matching models".padEnd(dW - 4)}\u2502\x1b[0m`);
    }

    lines.push(`${borderClr}\u2514${"\u2500".repeat(dW - 2)}\u2518\x1b[0m`);
    return lines;
  }
}
