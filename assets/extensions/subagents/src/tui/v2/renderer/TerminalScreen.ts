export interface Cell {
  char: string;
  style: number;
  dirty: boolean;
  width: number;
}

export class CellBuffer {
  private cells: Cell[][];
  private width: number;
  private height: number;
  private dirtyRows: Set<number> = new Set();
  private defaultStyle: number;

  constructor(width: number, height: number, defaultStyle: number = 0) {
    this.width = width;
    this.height = height;
    this.defaultStyle = defaultStyle;
    this.cells = this._createEmptyGrid();
  }

  private _createEmptyGrid(): Cell[][] {
    const grid: Cell[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < this.width; x++) {
        row.push({
          char: " ",
          style: this.defaultStyle,
          dirty: true,
          width: 1,
        });
      }
      grid.push(row);
    }
    return grid;
  }

  resize(width: number, height: number): void {
    const newGrid = this._createEmptyGridWithSize(width, height);
    
    // Copy existing content
    const minH = Math.min(this.height, height);
    const minW = Math.min(this.width, width);
    for (let y = 0; y < minH; y++) {
      for (let x = 0; x < minW; x++) {
        newGrid[y][x] = this.cells[y][x];
      }
    }

    this.width = width;
    this.height = height;
    this.cells = newGrid;
    this._markAllDirty();
  }

  private _createEmptyGridWithSize(width: number, height: number): Cell[][] {
    const grid: Cell[][] = [];
    for (let y = 0; y < height; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < width; x++) {
        row.push({
          char: " ",
          style: this.defaultStyle,
          dirty: true,
          width: 1,
        });
      }
      grid.push(row);
    }
    return grid;
  }

  setCell(x: number, y: number, char: string, style: number, width: number = 1): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const cell = this.cells[y][x];
    if (cell.char !== char || cell.style !== style || cell.width !== width) {
      cell.char = char;
      cell.style = style;
      cell.width = width;
      cell.dirty = true;
      this.dirtyRows.add(y);
    }
  }

  writeString(x: number, y: number, text: string, style: number): number {
    let cx = x;
    for (const ch of text) {
      if (cx >= this.width) break;
      this.setCell(cx, y, ch, style);
      cx += 1;
    }
    return cx - x;
  }

  clearLine(y: number, style: number): void {
    if (y < 0 || y >= this.height) return;
    const row = this.cells[y];
    for (let x = 0; x < this.width; x++) {
      row[x] = { char: " ", style, dirty: true, width: 1 };
    }
    this.dirtyRows.add(y);
  }

  clearRect(x: number, y: number, width: number, height: number, style: number): void {
    for (let y = 0; y < height; y++) {
      const row = y + y;
      if (row >= this.height) break;
      for (let x = 0; x < width; x++) {
        const col = x + x;
        if (col >= this.width) break;
        this.setCell(col, row, " ", style);
      }
    }
  }

  getCell(x: number, y: number): Cell | undefined {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return undefined;
    return this.cells[y][x];
  }

  getRow(y: number): Cell[] {
    if (y < 0 || y >= this.height) return [];
    return this.cells[y];
  }

  getDirtyRows(): number[] {
    return Array.from(this.dirtyRows).sort((a, b) => a - b);
  }

  markClean(y: number): void {
    this.dirtyRows.delete(y);
  }

  markAllClean(): void {
    this.dirtyRows.clear();
  }

  _markAllDirty(): void {
    for (let y = 0; y < this.height; y++) {
      this.dirtyRows.add(y);
    }
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  // Double buffering support
  private frontBuffer: Cell[][] = [];
  private backBuffer: Cell[][] = [];
  private usingFront = true;

  getCurrentBuffer(): Cell[][] {
    return this.usingFront ? this.frontBuffer : this.backBuffer;
  }

  swapBuffers(): void {
    this.usingFront = !this.usingFront;
    this._markAllDirty();
  }
}

export class TerminalScreen {
  private buffer: CellBuffer;
  private cols: number;
  private rows: number;
  private defaultStyle: number;

  constructor(defaultStyle: number = 0) {
    this.cols = process.stdout.columns || 80;
    this.rows = process.stdout.rows || 24;
    this.defaultStyle = defaultStyle;
    this.buffer = new CellBuffer(this.cols, this.rows, defaultStyle);
  }

  start(altScreen = true): void {
    const out: string[] = [];
    out.push("\x1b[?25l"); // Hide cursor
    out.push("\x1b[?2004h"); // Bracketed paste
    if (altScreen) out.push("\x1b[?1049h"); // Alt screen
    out.push("\x1b[?2026h"); // Sync output
    process.stdout.write(out.join(""));
    process.stdout.on("resize", () => this.handleResize());
  }

  stop(): void {
    const out: string[] = [];
    out.push("\x1b[?2026l");
    out.push("\x1b[?2004l");
    out.push("\x1b[?1049l");
    out.push("\x1b[?25h"); // Show cursor
    process.stdout.write(out.join(""));
  }

  private handleResize(): void {
    const { columns, rows } = process.stdout as any;
    if (columns && rows) {
      this.resize(columns, rows);
    }
  }

  getCols(): number {
    return this.cols;
  }

  getRows(): number {
    return this.rows;
  }

  getBuffer(): CellBuffer {
    return this.buffer;
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.buffer.resize(cols, rows);
  }

  writeString(x: number, y: number, text: string, style: number): number {
    return this.buffer.writeString(x, y, text, style);
  }

  clearLine(y: number, style: number): void {
    this.buffer.clearLine(y, style);
  }

  clearRect(x: number, y: number, width: number, height: number, style: number): void {
    this.buffer.clearRect(x, y, width, height, style);
  }

  setCell(x: number, y: number, char: string, style: number, width: number = 1): void {
    this.buffer.setCell(x, y, char, style, width);
  }

  getCell(x: number, y: number): Cell | undefined {
    return this.buffer.getCell(x, y);
  }

  getRow(y: number): Cell[] {
    return this.buffer.getRow(y);
  }

  getDirtyRows(): number[] {
    return this.buffer.getDirtyRows();
  }

  markLineClean(y: number): void {
    this.buffer.markClean(y);
  }

  markAllClean(): void {
    this.buffer.markAllClean();
  }

  getWidth(): number {
    return this.cols;
  }

  getHeight(): number {
    return this.rows;
  }
}