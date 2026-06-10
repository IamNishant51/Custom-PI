import { hexToAnsi, type TruecolorStyle } from "./types";
import { hexToRgb } from "./utils/color";

interface StyleDef {
  fg: number;
  bg: number;
  fgTruecolor: string;
  bgTruecolor: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

const TRUE_NONE = "";

export class StylePool {
  private styles: StyleDef[] = [];
  private cache = new Map<string, number>();
  private transitionCache = new Map<string, string>();
  private useTruecolor: boolean;

  constructor(useTruecolor = true) {
    this.useTruecolor = useTruecolor;
    this.clear();
  }

  setTruecolor(enabled: boolean): void {
    this.useTruecolor = enabled;
    this.transitionCache.clear();
  }

  private serialize(def: StyleDef): string {
    return `${def.fg}:${def.bg}:${def.fgTruecolor}:${def.bgTruecolor}:${+def.bold}:${+def.dim}:${+def.italic}:${+def.underline}:${+def.inverse}:${+def.strikethrough}`;
  }

  getOrCreate(def: Partial<StyleDef>): number {
    const full: StyleDef = {
      fg: def.fg ?? -1,
      bg: def.bg ?? -1,
      fgTruecolor: def.fgTruecolor ?? TRUE_NONE,
      bgTruecolor: def.bgTruecolor ?? TRUE_NONE,
      bold: def.bold ?? false,
      dim: def.dim ?? false,
      italic: def.italic ?? false,
      underline: def.underline ?? false,
      inverse: def.inverse ?? false,
      strikethrough: def.strikethrough ?? false,
    };
    const key = this.serialize(full);
    const existing = this.cache.get(key);
    if (existing !== undefined) return existing;
    const id = this.styles.length;
    this.styles.push(full);
    this.cache.set(key, id);
    return id;
  }

  getStyle(id: number): StyleDef {
    return this.styles[id];
  }

  toAnsi(id: number): string {
    const s = this.getStyle(id);
    const parts: string[] = [];
    if (this.useTruecolor && s.fgTruecolor) {
      const [r, g, b] = hexToRgb(s.fgTruecolor);
      parts.push(`38;2;${r};${g};${b}`);
    } else if (s.fg >= 0) {
      parts.push(`38;5;${s.fg}`);
    }
    if (this.useTruecolor && s.bgTruecolor) {
      const [r, g, b] = hexToRgb(s.bgTruecolor);
      parts.push(`48;2;${r};${g};${b}`);
    } else if (s.bg >= 0) {
      parts.push(`48;5;${s.bg}`);
    }
    if (s.bold) parts.push("1");
    if (s.dim) parts.push("2");
    if (s.italic) parts.push("3");
    if (s.underline) parts.push("4");
    if (s.inverse) parts.push("7");
    if (s.strikethrough) parts.push("9");
    return parts.length ? `\x1b[${parts.join(";")}m` : "";
  }

  transition(from: number, to: number): string {
    if (from === to) return "";
    const key = `${from}->${to}`;
    const cached = this.transitionCache.get(key);
    if (cached !== undefined) return cached;
    const result = this.toAnsi(to);
    this.transitionCache.set(key, result);
    return result;
  }

  resetAnsi(): string {
    return "\x1b[0m";
  }

  fromHex(hex: string): number {
    return hexToAnsi(hex);
  }

  getTruecolorStyle(fg: string, bg?: string, opts?: { bold?: boolean; dim?: boolean }): number {
    return this.getOrCreate({
      fg: -1,
      bg: -1,
      fgTruecolor: fg,
      bgTruecolor: bg ?? TRUE_NONE,
      bold: opts?.bold,
      dim: opts?.dim,
    });
  }

  ansiFromTruecolor(fgHex: string, bgHex?: string): string {
    const id = this.getTruecolorStyle(fgHex, bgHex);
    return this.toAnsi(id);
  }

  /** Prewarm common style combinations to avoid runtime cache misses */
  prewarm(): void {
    const commonFg = ["#ffffff", "#7d8187", "#4e5257", "#ff7a17", "#30d158", "#ff3b30", "#5ac8fa", "#212327"];
    const commonBg = ["#0a0a0a", "#1a1c20", "#191919", "#222222", "#1e1e1e"];
    for (const fg of commonFg) {
      this.getTruecolorStyle(fg);
      this.getTruecolorStyle(fg, undefined, { bold: true });
      this.getTruecolorStyle(fg, undefined, { dim: true });
    }
    for (const fg of commonFg) {
      for (const bg of commonBg) {
        this.getTruecolorStyle(fg, bg);
      }
    }
  }

  clear(): void {
    this.styles = [{
      fg: -1, bg: -1,
      fgTruecolor: TRUE_NONE, bgTruecolor: TRUE_NONE,
      bold: false, dim: false, italic: false,
      underline: false, inverse: false, strikethrough: false,
    }];
    this.cache.clear();
    this.transitionCache.clear();
    this.cache.set(this.serialize(this.styles[0]), 0);
  }

  get size(): number {
    return this.styles.length;
  }
}
