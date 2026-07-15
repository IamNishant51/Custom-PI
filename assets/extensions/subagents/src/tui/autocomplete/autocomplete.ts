import { THEME } from "../theme/theme";
import { measureWidth } from "../render/format";

export interface AutocompleteItem {
  label: string;
  description: string;
  type: "agent" | "command" | "tool";
  insertText: string;
}

export interface AutocompleteState {
  visible: boolean;
  items: AutocompleteItem[];
  selectedIndex: number;
  trigger: "@" | "/" | "!" | null;
  query: string;
  /** Start of the token being completed (column offset in input) */
  tokenStart: number;
}

export class AutocompleteProvider {
  private _items: AutocompleteItem[] = [];
  private _state: AutocompleteState = {
    visible: false, items: [], selectedIndex: 0, trigger: null, query: "", tokenStart: 0,
  };

  get state() { return this._state; }

  setItems(items: AutocompleteItem[]): void {
    this._items = items;
  }

  update(text: string, cursorPos: number): void {
    const before = text.slice(0, cursorPos);
    const triggerMatch = before.match(/([@/!])(\w*)$/);
    if (!triggerMatch) {
      if (this._state.visible) this._state.visible = false;
      return;
    }

    const trigger = triggerMatch[1] as "@" | "/" | "!";
    const query = triggerMatch[2].toLowerCase();
    const tokenStart = cursorPos - query.length - 1;

    const pool = this._items.filter(i => {
      if (trigger === "@") return i.type === "agent" || i.type === "tool";
      if (trigger === "/") return i.type === "command";
      if (trigger === "!") return i.type === "tool";
      return false;
    });

    const results = pool.filter(i =>
      i.label.toLowerCase().includes(query) ||
      i.description.toLowerCase().includes(query)
    ).slice(0, 12);

    this._state = {
      visible: results.length > 0,
      items: results,
      selectedIndex: 0,
      trigger,
      query,
      tokenStart,
    };
  }

  selectNext(): void {
    if (!this._state.visible) return;
    this._state.selectedIndex = (this._state.selectedIndex + 1) % this._state.items.length;
  }

  selectPrev(): void {
    if (!this._state.visible) return;
    this._state.selectedIndex = (this._state.selectedIndex - 1 + this._state.items.length) % this._state.items.length;
  }

  getSelected(): AutocompleteItem | null {
    if (!this._state.visible || !this._state.items.length) return null;
    return this._state.items[this._state.selectedIndex];
  }

  applyCompletion(text: string, cursorPos: number): { text: string; cursorPos: number } | null {
    const sel = this.getSelected();
    if (!sel) return null;
    const before = text.slice(0, this._state.tokenStart);
    const after = text.slice(cursorPos);
    const newText = before + sel.insertText + after;
    const newCursor = before.length + sel.insertText.length;
    return { text: newText, cursorPos: newCursor };
  }

  hide(): void {
    this._state.visible = false;
  }

  render(width: number): string[] {
    if (!this._state.visible || !this._state.items.length) return [];
    const accent = THEME.accent;
    const ink = THEME.ink;
    const muted = THEME.muted;
    const hairline = THEME.hairline;
    const surface = THEME.card;

    const lines: string[] = [];
    const maxH = Math.min(8, this._state.items.length + 1);
    const boxW = Math.min(width - 4, 60);

    // top border
    const topBg = `\x1b[48;2;${parseInt(surface.slice(1,3), 16)};${parseInt(surface.slice(3,5), 16)};${parseInt(surface.slice(5,7), 16)}m`;
    const borderClr = `\x1b[38;2;${parseInt(hairline.slice(1,3), 16)};${parseInt(hairline.slice(3,5), 16)};${parseInt(hairline.slice(5,7), 16)}m`;
    const triggerIcon = this._state.trigger === "@" ? "Agent" : this._state.trigger === "/" ? "Cmd" : "Tool";
    const title = ` ${triggerIcon} `;
    lines.push(`${borderClr}\u250c${topBg}\u2500 ${title} \u2500${"\u2500".repeat(Math.max(2, boxW - measureWidth(title) - 6))}\u2510\x1b[0m`);

    for (let i = 0; i < Math.min(maxH - 1, this._state.items.length); i++) {
      const item = this._state.items[i];
      const selected = i === this._state.selectedIndex;
      const bg = selected ? `\x1b[48;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m` : topBg;
      const fg = selected ? "\x1b[38;2;255;255;255m" : `\x1b[38;2;${parseInt(ink.slice(1,3), 16)};${parseInt(ink.slice(3,5), 16)};${parseInt(ink.slice(5,7), 16)}m`;
      const typeFg = selected ? "\x1b[38;2;200;200;255m" : `\x1b[38;2;${parseInt(muted.slice(1,3), 16)};${parseInt(muted.slice(3,5), 16)};${parseInt(muted.slice(5,7), 16)}m`;
      const badge = item.type === "agent" ? "\u{1F916}" : item.type === "command" ? "\u2318" : "\u2699";
      const desc = item.description.length > boxW - 30 ? item.description.slice(0, boxW - 33) + "..." : item.description;
      lines.push(`${bg}${fg} ${badge} ${item.label.padEnd(16)} ${typeFg}${desc}\x1b[0m`.padEnd(boxW + 2));
    }

    lines.push(`${borderClr}\u2514${"\u2500".repeat(boxW)}\u2518\x1b[0m`);
    return lines;
  }
}
