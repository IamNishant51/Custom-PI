export class AnsiWriter {
  private buffer: string[] = [];
  private cursorY = 0;
  private cursorX = 0;
  private suppress = false;

  suppressNext(flag: boolean): void {
    this.suppress = flag;
  }

  moveTo(y: number, x: number): void {
    if (this.suppress) return;
    if (y === this.cursorY && x === this.cursorX) return;
    if (y !== this.cursorY) {
      this.buffer.push(`\x1b[${y + 1};${x + 1}H`);
    } else {
      this.buffer.push(`\x1b[${x + 1}G`);
    }
    this.cursorY = y;
    this.cursorX = x;
  }

  write(text: string, style?: string): void {
    if (this.suppress) return;
    if (style) this.buffer.push(style);
    this.buffer.push(text);
    if (style) this.buffer.push("\x1b[0m");
    this.cursorX += text.length;
  }

  newline(): void {
    if (this.suppress) return;
    this.buffer.push("\r\n");
    this.cursorY++;
    this.cursorX = 0;
  }

  clearScreen(): void {
    this.buffer.push("\x1b[2J\x1b[H");
    this.cursorY = 0;
    this.cursorX = 0;
  }

  clearLine(): void {
    this.buffer.push("\x1b[2K");
  }

  hideCursor(): void {
    this.buffer.push("\x1b[?25l");
  }

  showCursor(): void {
    this.buffer.push("\x1b[?25h");
  }

  enterAltScreen(): void {
    this.buffer.push("\x1b[?1049h");
    this.cursorY = 0;
    this.cursorX = 0;
  }

  exitAltScreen(): void {
    this.buffer.push("\x1b[?1049l");
  }

  enableBracketedPaste(): void {
    this.buffer.push("\x1b[?2004h");
  }

  disableBracketedPaste(): void {
    this.buffer.push("\x1b[?2004l");
  }

  enableMouse(): void {
    this.buffer.push("\x1b[?1002h\x1b[?1003h");
  }

  disableMouse(): void {
    this.buffer.push("\x1b[?1002l\x1b[?1003l");
  }

  beginSync(): void {
    this.buffer.push("\x1b[?2026h");
  }

  endSync(): void {
    this.buffer.push("\x1b[?2026l");
  }

  setTitle(title: string): void {
    this.buffer.push(`\x1b]0;${title}\x07`);
  }

  flush(): string {
    const result = this.buffer.join("");
    this.buffer = [];
    return result;
  }

  getBuffer(): string[] {
    return this.buffer;
  }

  hasContent(): boolean {
    return this.buffer.length > 0;
  }
}
