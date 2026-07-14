export class AnsiWriter {
  private buffer: string[] = [];
  private currentStyle: number = -1;

  write(text: string): void {
    this.buffer.push(text);
  }

  writeStyle(styleId: number): void {
    if (styleId !== this.currentStyle) {
      this.currentStyle = styleId;
      this.buffer.push(`\x1b[${styleId}m`);
    }
  }

  writeStyled(text: string, style: number): void {
    if (style !== this.currentStyle) {
      this.currentStyle = style;
      this.buffer.push(`\x1b[${style}m`);
    }
    this.buffer.push(text);
  }

  reset(): void {
    if (this.currentStyle !== 0) {
      this.buffer.push("\x1b[0m");
      this.currentStyle = 0;
    }
  }

  cursorTo(x: number, y: number): void {
    this.buffer.push(`\x1b[${y + 1};${x + 1}H`);
  }

  cursorUp(n: number = 1): void {
    this.buffer.push(`\x1b[${n}A`);
  }

  cursorDown(n: number = 1): void {
    this.buffer.push(`\x1b[${n}B`);
  }

  cursorForward(n: number = 1): void {
    this.buffer.push(`\x1b[${n}C`);
  }

  cursorBackward(n: number = 1): void {
    this.buffer.push(`\x1b[${n}D`);
  }

  eraseLine(mode: 0 | 1 | 2 = 0): void {
    this.buffer.push(`\x1b[${mode}K`);
  }

  eraseScreen(mode: 0 | 1 | 2 = 0): void {
    this.buffer.push(`\x1b[${mode}J`);
  }

  saveCursor(): void {
    this.buffer.push("\x1b[s");
  }

  restoreCursor(): void {
    this.buffer.push("\x1b[u");
  }

  hideCursor(): void {
    this.buffer.push("\x1b[?25l");
  }

  showCursor(): void {
    this.buffer.push("\x1b[?25h");
  }

  setCursorStyle(style: "block" | "underline" | "bar"): void {
    const styles = { block: 2, underline: 3, bar: 5 };
    this.buffer.push(`\x1b[${styles[style]} q`);
  }

  flush(): string {
    const output = this.buffer.join("");
    this.buffer = [];
    return output;
  }

  clear(): void {
    this.buffer = [];
    this.currentStyle = -1;
  }

  getBuffer(): string {
    return this.buffer.join("");
  }
}