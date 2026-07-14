export interface StyleDef {
  fg?: number;
  bg?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

export interface TruecolorStyleDef {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

export class StylePool {
  private truecolor: boolean = false;
  private ansiById: Map<number, string> = new Map();
  private nextId = 1;
  private readonly idBase = 1_000_000;

  setTruecolor(enabled: boolean): void {
    this.truecolor = enabled;
  }

  fromHex(hex: string): number {
    const clean = hex.startsWith("#") ? hex.slice(1) : hex;
    if (clean.length !== 6) throw new Error(`Invalid hex color: ${hex}`);

    if (this.truecolor) {
      const id = 0x80000000 | this.nextId++;
      this.ansiById.set(id, `\x1b[38;2;${this._rgb(clean)}m`);
      return id;
    }

    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const id = 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
    this.ansiById.set(id, `\x1b[38;5;${id}m`);
    return id;
  }

  getOrCreate(def: StyleDef): number {
    const key = this._styleKey(def);
    const cached = this._keyCache.get(key);
    if (cached !== undefined) return cached;

    const id = this.truecolor ? this._tcId(def) : this._ansi256Id(def);
    this._keyCache.set(key, id);
    return id;
  }

  getTruecolorStyle(fg: string, bg?: string, opts?: { bold?: boolean; dim?: boolean }): number {
    const key = `tc:${fg}:${bg ?? ""}:${opts?.bold ?? false}:${opts?.dim ?? false}`;
    const cached = this._keyCache.get(key);
    if (cached !== undefined) return cached;

    const id = 0x80000000 | this.nextId++;
    const parts: string[] = [];
    if (fg) parts.push(`\x1b[38;2;${this._rgb(fg.startsWith("#") ? fg.slice(1) : fg)}m`);
    if (bg) parts.push(`\x1b[48;2;${this._rgb(bg.startsWith("#") ? bg.slice(1) : bg)}m`);
    if (opts?.bold) parts.push("\x1b[1m");
    if (opts?.dim) parts.push("\x1b[2m");
    this.ansiById.set(id, parts.join(""));
    this._keyCache.set(key, id);
    return id;
  }

  getAnsi(id: number): string {
    return this.ansiById.get(id) ?? "";
  }

  clear(): void {
    this.ansiById.clear();
    this._keyCache.clear();
    this.nextId = 1;
  }

  prewarm(): void {
    const common = [
      "#0d0d0d", "#1a1c20", "#222222", "#1e1e1e", "#191919",
      "#212327", "#2c2f34", "#ffffff", "#9ea2a8", "#6a6e74",
      "#ff7a17", "#e66a00", "#30d158", "#ff9f0a", "#ff3b30",
      "#5ac8fa", "#4e5257",
    ];
    for (const hex of common) this.fromHex(hex);
  }

  private _keyCache: Map<string, number> = new Map();

  private _rgb(hex: string): string {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `${r};${g};${b}`;
  }

  private _styleKey(def: StyleDef): string {
    return `s:${def.fg ?? ""}:${def.bg ?? ""}:${def.bold ?? false}:${def.dim ?? false}:${def.italic ?? false}:${def.underline ?? false}:${def.inverse ?? false}:${def.strikethrough ?? false}`;
  }

  private _ansi256Id(def: StyleDef): number {
    const fg = def.fg ?? 255;
    const bg = def.bg ?? 0;
    const bold = def.bold ? 1 : 0;
    const id = (fg << 16) | (bg << 8) | bold;
    const parts: string[] = [];
    if (def.fg !== undefined) parts.push(`\x1b[38;5;${fg}m`);
    if (def.bg !== undefined) parts.push(`\x1b[48;5;${bg}m`);
    if (def.bold) parts.push("\x1b[1m");
    if (def.dim) parts.push("\x1b[2m");
    if (def.italic) parts.push("\x1b[3m");
    if (def.underline) parts.push("\x1b[4m");
    if (def.inverse) parts.push("\x1b[7m");
    if (def.strikethrough) parts.push("\x1b[9m");
    this.ansiById.set(id, parts.join(""));
    return id;
  }

  private _tcId(def: StyleDef): number {
    const id = 0x80000000 | this.nextId++;
    const parts: string[] = [];
    if (def.fg !== undefined) parts.push(`\x1b[38;2;${this._rgb(String(def.fg))}m`);
    if (def.bg !== undefined) parts.push(`\x1b[48;2;${this._rgb(String(def.bg))}m`);
    if (def.bold) parts.push("\x1b[1m");
    if (def.dim) parts.push("\x1b[2m");
    if (def.italic) parts.push("\x1b[3m");
    if (def.underline) parts.push("\x1b[4m");
    if (def.inverse) parts.push("\x1b[7m");
    if (def.strikethrough) parts.push("\x1b[9m");
    this.ansiById.set(id, parts.join(""));
    return id;
  }
}
