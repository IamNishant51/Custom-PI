import { StylePool } from "./style-pool";

const CELL_WORDS = 3;
const WORD_CHAR = 0;
const WORD_STYLE = 1;
const WORD_FLAGS = 2;

const FLAG_DIRTY = 1;
const FLAG_WIDE = 2;

export class TerminalScreen {
  private front: Uint32Array;
  private back: Uint32Array;
  private cols = 80;
  private rows = 24;
  private pool: StylePool;
  private damageTop = Infinity;
  private damageBottom = -1;
  private damageLeft = Infinity;
  private damageRight = -1;

  constructor(pool: StylePool) {
    this.pool = pool;
    this.front = new Uint32Array(0);
    this.back = new Uint32Array(0);
    this.resize(80, 24);
  }

  resize(cols: number, rows: number): void {
    if (this.cols === cols && this.rows === rows) return;
    const oldCols = this.cols;
    const oldRows = this.rows;
    const oldFront = this.front;
    const oldBack = this.back;

    this.cols = cols;
    this.rows = rows;
    this.front = new Uint32Array(cols * rows * CELL_WORDS);
    this.back = new Uint32Array(cols * rows * CELL_WORDS);

    for (let y = 0; y < Math.min(oldRows, rows); y++) {
      for (let x = 0; x < Math.min(oldCols, cols); x++) {
        const oi = (y * oldCols + x) * CELL_WORDS;
        const ni = (y * cols + x) * CELL_WORDS;
        this.front[ni + WORD_CHAR] = oldFront[oi + WORD_CHAR];
        this.front[ni + WORD_STYLE] = oldFront[oi + WORD_STYLE];
        this.front[ni + WORD_FLAGS] = oldFront[oi + WORD_FLAGS] | FLAG_DIRTY;
        this.back[ni + WORD_CHAR] = oldBack[oi + WORD_CHAR];
        this.back[ni + WORD_STYLE] = oldBack[oi + WORD_STYLE];
        this.back[ni + WORD_FLAGS] = oldBack[oi + WORD_FLAGS] | FLAG_DIRTY;
      }
    }

    this.damageTop = 0;
    this.damageBottom = rows - 1;
    this.damageLeft = 0;
    this.damageRight = cols - 1;
  }

  getCols(): number { return this.cols; }

  getRows(): number { return this.rows; }

  private markDamage(x: number, y: number): void {
    if (x < this.damageLeft) this.damageLeft = x;
    if (x > this.damageRight) this.damageRight = x;
    if (y < this.damageTop) this.damageTop = y;
    if (y > this.damageBottom) this.damageBottom = y;
    if (this.damageLeft < 0) this.damageLeft = 0;
    if (this.damageTop < 0) this.damageTop = 0;
    if (this.damageRight >= this.cols) this.damageRight = this.cols - 1;
    if (this.damageBottom >= this.rows) this.damageBottom = this.rows - 1;
  }

  write(x: number, y: number, char: number, style: number, width = 1): void {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const i = (y * this.cols + x) * CELL_WORDS;
    this.back[i + WORD_CHAR] = char;
    this.back[i + WORD_STYLE] = style;
    this.back[i + WORD_FLAGS] = (this.back[i + WORD_FLAGS] & ~FLAG_WIDE) | (width > 1 ? FLAG_WIDE : 0) | FLAG_DIRTY;
    if (width > 1 && x + 1 < this.cols) {
      const j = i + CELL_WORDS;
      this.back[j + WORD_CHAR] = 0;
      this.back[j + WORD_STYLE] = style;
      this.back[j + WORD_FLAGS] = (this.back[j + WORD_FLAGS] & ~FLAG_WIDE) | FLAG_DIRTY;
    }
    this.markDamage(x, y);
  }

  writeString(x: number, y: number, text: string, style: number): void {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const width = code > 0x2FF ? 2 : 1;
      this.write(x, y, code, style, width);
      x += width;
      if (x >= this.cols) break;
    }
  }

  clearLine(y: number, style: number): void {
    if (y < 0 || y >= this.rows) return;
    const row = y * this.cols;
    for (let x = 0; x < this.cols; x++) {
      const i = (row + x) * CELL_WORDS;
      this.back[i + WORD_CHAR] = 32;
      this.back[i + WORD_STYLE] = style;
      this.back[i + WORD_FLAGS] |= FLAG_DIRTY;
    }
    if (y < this.damageTop) this.damageTop = y;
    if (y > this.damageBottom) this.damageBottom = y;
  }

  clear(style: number): void {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = (y * this.cols + x) * CELL_WORDS;
        this.back[i + WORD_CHAR] = 32;
        this.back[i + WORD_STYLE] = style;
        this.back[i + WORD_FLAGS] |= FLAG_DIRTY;
      }
    }
    this.damageTop = 0;
    this.damageBottom = this.rows - 1;
    this.damageLeft = 0;
    this.damageRight = this.cols - 1;
  }

  /**
   * Returns the current damage region (the rectangle of cells that have been
   * modified since the last swap/flush), or null if nothing is damaged.
   */
  getDamageRegions(): { top: number; bottom: number; left: number; right: number } | null {
    if (this.damageTop === Infinity) return null;
    return {
      top: this.damageTop,
      bottom: this.damageBottom,
      left: this.damageLeft,
      right: this.damageRight,
    };
  }

  swapBuffers(): void {
    const tmp = this.front;
    this.front = this.back;
    this.back = tmp;
    this.damageTop = Infinity;
    this.damageBottom = -1;
    this.damageLeft = Infinity;
    this.damageRight = -1;
  }

  flush(): string {
    const reset = this.pool.resetAnsi();
    const parts: string[] = [];
    let lastY = -1;

    const cols = this.cols;
    const yStart = Math.max(0, this.damageTop);
    const yEnd = Math.min(this.rows - 1, this.damageBottom);
    if (yStart > yEnd) return "";

    for (let y = yStart; y <= yEnd; y++) {
      const rowBase = y * cols;

      // Find dirty range for this row
      let rowStart = -1;
      let rowEnd = -1;
      for (let x = 0; x < cols; x++) {
        if (this.back[(rowBase + x) * CELL_WORDS + WORD_FLAGS] & FLAG_DIRTY) {
          if (rowStart === -1) rowStart = x;
          rowEnd = x;
        }
      }
      if (rowStart === -1) continue;

      // Single cursor-position to start of dirty run
      parts.push(`\x1b[${y + 1};${rowStart + 1}H`);
      lastY = y;

      // Emit contiguous run: just output chars sequentially with style transitions
      let lastStyle = -1;
      for (let x = rowStart; x <= rowEnd; x++) {
        const bi = (rowBase + x) * CELL_WORDS;
        const flags = this.back[bi + WORD_FLAGS];
        if (!(flags & FLAG_DIRTY)) continue;
        this.back[bi + WORD_FLAGS] = flags & ~FLAG_DIRTY;

        const fi = (rowBase + x) * CELL_WORDS;
        const backChar = this.back[bi + WORD_CHAR];
        const backStyle = this.back[bi + WORD_STYLE];
        if (backChar === this.front[fi + WORD_CHAR] && backStyle === this.front[fi + WORD_STYLE]) continue;

        if (backStyle !== lastStyle) {
          parts.push(this.pool.transition(lastStyle, backStyle));
          lastStyle = backStyle;
        }

        if (backChar === 0) {
          parts.push(" ");
        } else {
          parts.push(String.fromCodePoint(backChar));
        }

        if (flags & FLAG_WIDE) x++;
      }
    }

    if (parts.length === 0) return "";
    return `${parts.join("")}${reset}`;
  }

  renderLines(lines: string[][], startY: number, style: number): void {
    for (let y = 0; y < lines.length; y++) {
      const row = lines[y];
      const sy = startY + y;
      if (sy >= this.rows) break;
      this.clearLine(sy, style);
      let x = 0;
      for (const segment of row) {
        for (let i = 0; i < segment.length && x < this.cols; i++) {
          const code = segment.charCodeAt(i);
          this.write(x, sy, code, style);
          x++;
        }
      }
    }
  }
}
