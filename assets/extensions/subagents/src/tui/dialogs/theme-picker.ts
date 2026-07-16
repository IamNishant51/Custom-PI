import { THEME } from "../theme/theme";
import { fg, fgBold, dim } from "../theme/colorize";
import { measureWidth, stripAnsi } from "../render/format";

export interface ThemeEntry {
  name: string;
  type: "builtin" | "user";
  preview: string;
}

const BUILTIN_THEMES: ThemeEntry[] = [
  { name: "default", type: "builtin", preview: "Normal text sample  # code  \"string\"" },
  { name: "catppuccin-mocha", type: "builtin", preview: "Normal text sample  # code  \"string\"" },
  { name: "dracula", type: "builtin", preview: "Normal text sample  # code  \"string\"" },
  { name: "nord", type: "builtin", preview: "Normal text sample  # code  \"string\"" },
  { name: "solarized-dark", type: "builtin", preview: "Normal text sample  # code  \"string\"" },
];

export class ThemePicker {
  visible = false;
  themes: ThemeEntry[] = [...BUILTIN_THEMES];
  selectedIndex = 0;
  onSelect: ((theme: ThemeEntry) => void) | null = null;

  private filterQuery = "";

  open(themes?: ThemeEntry[]): void {
    if (themes) this.themes = themes;
    this.visible = true;
    this.selectedIndex = 0;
    this.filterQuery = "";
  }

  close(): void {
    this.visible = false;
  }

  get filteredThemes(): ThemeEntry[] {
    if (!this.filterQuery) return this.themes;
    const q = this.filterQuery.toLowerCase();
    return this.themes.filter(t =>
      t.name.toLowerCase().includes(q) || t.type.toLowerCase().includes(q)
    );
  }

  handleInput(char: string): "navigate" | "close" | null {
    if (!this.visible) return null;
    if (char === "Escape") { this.close(); return "close"; }
    if (char === "\n" || char === "\r") {
      const theme = this.filteredThemes[this.selectedIndex];
      if (theme && this.onSelect) this.onSelect(theme);
      this.close();
      return "navigate";
    }
    if (char === "\x1b[A") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return "navigate";
    }
    if (char === "\x1b[B") {
      this.selectedIndex = Math.min(this.filteredThemes.length - 1, this.selectedIndex + 1);
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
    if (!this.visible || !this.themes.length) return [];
    const ink = THEME.ink;
    const surface = THEME.card;
    const hairline = THEME.hairline;
    const accent = THEME.accent;
    const muted = THEME.muted;

    const dW = Math.min(56, width - 4);
    const maxItems = Math.min(8, rows - 7);
    const lines: string[] = [];
    const solidBg = `\x1b[48;2;${parseInt(surface.slice(1,3), 16)};${parseInt(surface.slice(3,5), 16)};${parseInt(surface.slice(5,7), 16)}m`;
    const borderClr = `\x1b[38;2;${parseInt(hairline.slice(1,3), 16)};${parseInt(hairline.slice(3,5), 16)};${parseInt(hairline.slice(5,7), 16)}m`;
    const inkFg = `\x1b[38;2;${parseInt(ink.slice(1,3), 16)};${parseInt(ink.slice(3,5), 16)};${parseInt(ink.slice(5,7), 16)}m`;
    const mutedFg = `\x1b[38;2;${parseInt(muted.slice(1,3), 16)};${parseInt(muted.slice(3,5), 16)};${parseInt(muted.slice(5,7), 16)}m`;
    const accentFg = `\x1b[38;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m`;

    const title = " Theme Picker ";
    lines.push(`${borderClr}\u250c${solidBg}\u2500${accentFg}${title}\x1b[0m${borderClr}${"\u2500".repeat(Math.max(1, dW - measureWidth(title) - 3))}\u2510\x1b[0m`);

    const filterDisplay = `\u{1F50D} ${this.filterQuery || "type to filter..."}`;
    lines.push(`${solidBg}${inkFg}\u2502${filterDisplay.padEnd(dW - 2)}\u2502\x1b[0m`);

    const filtered = this.filteredThemes;
    for (let i = 0; i < Math.min(maxItems, filtered.length); i++) {
      const theme = filtered[i];
      const selected = i === this.selectedIndex;
      const bg = selected ? `\x1b[48;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m` : solidBg;
      const fgColor = selected ? "\x1b[38;2;255;255;255m" : inkFg;
      const dot = selected ? "\u25C9" : "\u25CB";
      const typeBadge = theme.type === "builtin" ? "built-in" : "user";
      const nameStr = ` ${dot} ${theme.name}`;
      const typeStr = ` (${typeBadge})`;
      const remaining = dW - 4 - measureWidth(nameStr) - measureWidth(typeStr);
      lines.push(`${bg}${fgColor}\u2502${nameStr}${mutedFg}${typeStr}\x1b[0m${bg}${" ".repeat(Math.max(0, remaining))}\u2502\x1b[0m`);

      const previewInner = `  ${mutedFg}\u2502 ${theme.preview}\x1b[0m`;
      const previewPad = dW - 4 - Math.min(measureWidth(theme.preview) + 4, dW - 4);
      lines.push(`${solidBg}${mutedFg}\u2502${" ".repeat(2)}\u2502 ${theme.preview}${" ".repeat(Math.max(0, previewPad))}\u2502\x1b[0m`);
    }
    if (filtered.length === 0) {
      lines.push(`${solidBg}${mutedFg}\u2502 ${"No matching themes".padEnd(dW - 4)}\u2502\x1b[0m`);
    }

    const itemLines = Math.min(maxItems, Math.max(1, filtered.length)) * 2;
    for (let i = lines.length; i < 2 + itemLines + 1 && i < rows - 2; i++) {
      lines.push(`${solidBg}${" ".repeat(dW)}\x1b[0m`);
    }

    const helpText = ` [\u2191\u2193] navigate  [Enter] apply  [Esc] cancel `;
    lines.push(`${solidBg}${fg(THEME.dim, helpText.padEnd(dW - 2))} \x1b[0m`);

    lines.push(`${borderClr}\u2514${"\u2500".repeat(dW - 2)}\u2518\x1b[0m`);
    return lines;
  }
}
