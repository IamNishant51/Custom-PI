import { StylePool } from "./StylePool";
import { TerminalScreen } from "./TerminalScreen";

export interface RendererConfig {
  truecolor: boolean;
  theme: AdaptiveTheme;
}

export class ScreenRenderer {
  screen: TerminalScreen;
  pool: StylePool;
  theme: AdaptiveTheme;
  private truecolor: boolean;

  constructor(config: RendererConfig) {
    this.theme = config.theme;
    this.truecolor = config.truecolor;
    this.pool = new StylePool();
    this.pool.setTruecolor(this.truecolor);
    this.screen = new TerminalScreen(this.pool);
    this.pool.prewarm();
  }

  ansi(hex: string): number {
    return this.pool.fromHex(hex);
  }

  style(def: StyleDef): number {
    return this.pool.getOrCreate(def);
  }

  truecolorStyle(fg: string, bg?: string, opts?: { bold?: boolean; dim?: boolean }): number {
    return this.pool.getTruecolorStyle(fg, bg, opts);
  }

  elevationStyle(level: "canvas" | "surface" | "elevated" | "overlay" | "popup"): number {
    const elevation = this.theme.getElevation(level);
    return this.style({ bg: elevation.bg });
  }

  get tokens() {
    return this.theme.tokens;
  }

  start(altScreen = true): void {
    this.screen.start(altScreen);
  }

  stop(): void {
    this.screen.stop();
  }

  render(): void {
    const out: string[] = [];
    const dirty = this.screen.getDirtyRows();
    let currentStyle = -1;
    const height = this.screen.getHeight();
    const width = this.screen.getWidth();
    for (const y of dirty) {
      if (y < 0 || y >= height) continue;
      out.push(`\x1b[${y + 1};1H`);
      currentStyle = -1;
      const row = this.screen.getRow(y);
      for (let x = 0; x < width && x < row.length; x++) {
        const cell = row[x];
        if (cell.style !== currentStyle) {
          out.push("\x1b[0m");
          if (cell.style !== 0) out.push(this.pool.getAnsi(cell.style));
          currentStyle = cell.style;
        }
        out.push(cell.char);
      }
      this.screen.markLineClean(y);
    }
    out.push("\x1b[0m");
    if (out.length > 1) process.stdout.write(out.join(""));
  }

  resize(cols: number, rows: number): void {
    this.screen.resize(cols, rows);
  }

  getScreen(): TerminalScreen {
    return this.screen;
  }

  get contentWidth(): number {
    return Math.max(0, this.screen.getCols() - 4);
  }

  get contentHeight(): number {
    return Math.max(0, this.screen.getRows() - 4);
  }
}

interface StyleDef {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}