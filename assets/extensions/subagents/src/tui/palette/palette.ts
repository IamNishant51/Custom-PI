import { THEME } from "../theme/theme";
import { stripAnsi, measureWidth } from "../render/format";
import type { PaletteCommand, CommandRegistry } from "./commands";

export interface PaletteState {
  visible: boolean;
  query: string;
  results: PaletteCommand[];
  selectedIndex: number;
}

export class CommandPalette {
  state: PaletteState = {
    visible: false,
    query: "",
    results: [],
    selectedIndex: 0,
  };

  private registry: CommandRegistry;

  constructor(registry: CommandRegistry) {
    this.registry = registry;
  }

  open(): void {
    this.state = { visible: true, query: "", results: this.registry.getAll().slice(0, 20), selectedIndex: 0 };
  }

  close(): void {
    this.state.visible = false;
  }

  toggle(): void {
    if (this.state.visible) this.close();
    else this.open();
  }

  handleInput(char: string): "navigate" | "execute" | "close" | null {
    if (!this.state.visible) return null;

    if (char === "Escape") {
      this.close();
      return "close";
    }
    if (char === "Enter") {
      if (this.state.results[this.state.selectedIndex]) {
        const cmd = this.state.results[this.state.selectedIndex];
        this.close();
        cmd.execute();
        return "execute";
      }
      return null;
    }
    if (char === "ArrowUp" || char === "ArrowDown") {
      const dir = char === "ArrowUp" ? -1 : 1;
      this.state.selectedIndex = Math.max(0, Math.min(this.state.results.length - 1, this.state.selectedIndex + dir));
      return "navigate";
    }
    if (char === "Backspace") {
      this.state.query = this.state.query.slice(0, -1);
      this.state.results = this.registry.search(this.state.query);
      this.state.selectedIndex = 0;
      return "navigate";
    }
    if (char.length === 1 && char.charCodeAt(0) >= 32) {
      this.state.query += char;
      this.state.results = this.registry.search(this.state.query);
      this.state.selectedIndex = 0;
      return "navigate";
    }
    return null;
  }

  render(width: number): string[] {
    if (!this.state.visible) return [];
    const maxH = Math.min(16, this.state.results.length + 3);
    const lines: string[] = [];
    const accent = THEME.accent;
    const muted = THEME.muted;
    const ink = THEME.ink;
    const hairline = THEME.hairline;
    const surface = THEME.card;

    const title = " Command Palette ";
    const titleW = measureWidth(title);
    const titlePad = Math.max(2, Math.floor((width - titleW) / 2) - 2);
    lines.push(`\x1b[38;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m\u250c\u2500${"\u2500".repeat(titlePad)}${title}\u2500`.padEnd(width - 1, "\u2500") + "\u2510\x1b[0m");

    const promptBg = `\x1b[48;2;${parseInt(surface.slice(1,3), 16)};${parseInt(surface.slice(3,5), 16)};${parseInt(surface.slice(5,7), 16)}m`;
    const queryText = `\x1b[38;2;${parseInt(ink.slice(1,3), 16)};${parseInt(ink.slice(3,5), 16)};${parseInt(ink.slice(5,7), 16)}m\u2502\x1b[0m${promptBg} > ${this.state.query || "\u203e".repeat(10)}\x1b[0m`;
    lines.push(queryText.padEnd(width) + "\x1b[0m");

    const noneText = `\x1b[38;2;${parseInt(muted.slice(1,3), 16)};${parseInt(muted.slice(3,5), 16)};${parseInt(muted.slice(5,7), 16)}m  No matching commands\x1b[0m`;
    if (this.state.results.length === 0) {
      lines.push(`\x1b[48;2;${parseInt(surface.slice(1,3), 16)};${parseInt(surface.slice(3,5), 16)};${parseInt(surface.slice(5,7), 16)}m${noneText}\x1b[0m`.padEnd(width));
    } else {
      for (let i = 0; i < Math.min(maxH - 3, this.state.results.length); i++) {
        const cmd = this.state.results[i];
        const selected = i === this.state.selectedIndex;
        const bg = selected ? `\x1b[48;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m` : promptBg;
        const fg = selected ? "\x1b[38;2;255;255;255m" : `\x1b[38;2;${parseInt(ink.slice(1,3), 16)};${parseInt(ink.slice(3,5), 16)};${parseInt(ink.slice(5,7), 16)}m`;
        const catFg = selected ? "\x1b[38;2;200;200;255m" : `\x1b[38;2;${parseInt(muted.slice(1,3), 16)};${parseInt(muted.slice(3,5), 16)};${parseInt(muted.slice(5,7), 16)}m`;
        const icon = cmd.icon || "\u25b8";
        const cat = cmd.category.padEnd(12);
        const desc = cmd.description.length > width - 30 ? cmd.description.slice(0, width - 33) + "..." : cmd.description;
        lines.push(`${bg}${fg}  ${icon} ${cmd.title} ${catFg}${cat}\x1b[0m${fg} ${desc}\x1b[0m`.padEnd(width));
      }
    }

    const sep = `\x1b[38;2;${parseInt(hairline.slice(1,3), 16)};${parseInt(hairline.slice(3,5), 16)};${parseInt(hairline.slice(5,7), 16)}m\u2514${"\u2500".repeat(width - 2)}\u2518\x1b[0m`;
    lines.push(sep);
    return lines;
  }
}
