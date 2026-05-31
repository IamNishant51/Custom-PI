import { hexToAnsi } from "./types";

interface StyleDef {
  fg: number;
  bg: number;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

export class StylePool {
  private styles: StyleDef[] = [];
  private cache = new Map<string, number>();
  private transitionCache = new Map<string, string>();

  private serialize(def: StyleDef): string {
    return `${def.fg}:${def.bg}:${+def.bold}:${+def.dim}:${+def.italic}:${+def.underline}:${+def.inverse}:${+def.strikethrough}`;
  }

  getOrCreate(def: Partial<StyleDef>): number {
    const full: StyleDef = {
      fg: def.fg ?? -1,
      bg: def.bg ?? -1,
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
    if (s.fg >= 0) parts.push(`38;5;${s.fg}`);
    if (s.bg >= 0) parts.push(`48;5;${s.bg}`);
    if (s.bold) parts.push("1");
    if (s.dim) parts.push("2");
    if (s.italic) parts.push("3");
    if (s.underline) parts.push("4");
    if (s.inverse) parts.push("7");
    if (s.strikethrough) parts.push("9");
    return parts.length ? `\x1b[${parts.join(";")}m` : "\x1b[0m";
  }

  transition(from: number, to: number): string {
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

  clear(): void {
    this.styles = [{ fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false, inverse: false, strikethrough: false }];
    this.cache.clear();
    this.transitionCache.clear();
    this.cache.set(this.serialize(this.styles[0]), 0);
  }

  get size(): number {
    return this.styles.length;
  }
}
