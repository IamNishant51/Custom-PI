export type VimMode = "normal" | "insert" | "visual";
export type VimAction =
  | "moveLeft" | "moveRight" | "moveUp" | "moveDown"
  | "moveWordLeft" | "moveWordRight"
  | "moveLineStart" | "moveLineEnd"
  | "insertMode" | "appendMode" | "insertLineStart"
  | "normalMode" | "visualMode"
  | "deleteChar" | "deleteLine" | "deleteWord"
  | "yankLine" | "pasteAfter" | "pasteBefore"
  | "undo" | "redo"
  | "submit" | "escape"
  | "backspace" | "deleteForward"
  | "home" | "end"
  | "pageUp" | "pageDown";

export interface UndoEntry {
  text: string;
  cursor: number;
}

export class VimState {
  mode: VimMode = "normal";
  pendingKeys: string[] = [];
  lastMotion: string = "";
  register: string = '"';
  insertCount = 0;

  /** Undo stack: most recent entry at the end */
  undoStack: UndoEntry[] = [];
  /** Redo stack: most recent entry at the end */
  redoStack: UndoEntry[] = [];
  /** Clipboard register for yank/delete operations */
  clipboard: string = "";

  /** Maximum entries kept in undo/redo stacks */
  readonly maxUndoDepth = 100;

  reset(): void {
    this.pendingKeys = [];
  }

  /** Push current state onto the undo stack (clears redo stack on new change) */
  pushUndo(text: string, cursor: number): void {
    this.undoStack.push({ text, cursor });
    if (this.undoStack.length > this.maxUndoDepth) {
      this.undoStack.shift();
    }
    // Any new change invalidates the redo stack
    this.redoStack = [];
  }

  /** Pop the most recent undo entry and push the current state onto redo */
  popUndo(currentText: string, currentCursor: number): UndoEntry | null {
    const entry = this.undoStack.pop();
    if (entry) {
      this.redoStack.push({ text: currentText, cursor: currentCursor });
    }
    return entry ?? null;
  }

  /** Pop the most recent redo entry and push the current state back onto undo */
  popRedo(currentText: string, currentCursor: number): UndoEntry | null {
    const entry = this.redoStack.pop();
    if (entry) {
      this.undoStack.push({ text: currentText, cursor: currentCursor });
    }
    return entry ?? null;
  }
}

const NORMAL_BINDINGS: Record<string, VimAction> = {
  "h": "moveLeft",
  "j": "moveDown",
  "k": "moveUp",
  "l": "moveRight",
  "w": "moveWordRight",
  "b": "moveWordLeft",
  "0": "moveLineStart",
  "$": "moveLineEnd",
  "i": "insertMode",
  "a": "appendMode",
  "I": "insertLineStart",
  "A": "moveLineEnd",
  "v": "visualMode",
  "x": "deleteChar",
  "dd": "deleteLine",
  "dw": "deleteWord",
  "yy": "yankLine",
  "p": "pasteAfter",
  "P": "pasteBefore",
  "u": "undo",
  "r": "redo",
  "Enter": "submit",
  "Escape": "normalMode",
  "Backspace": "backspace",
};

const INSERT_BINDINGS: Record<string, VimAction> = {
  "Escape": "normalMode",
  "Enter": "submit",
  "Backspace": "backspace",
  "Delete": "deleteForward",
  "Home": "home",
  "End": "end",
  "PageUp": "pageUp",
  "PageDown": "pageDown",
};

export class VimInputHandler {
  state: VimState;

  constructor() {
    this.state = new VimState();
  }

  handleKey(key: string, text: string, cursor: number): { text: string; cursor: number; action?: VimAction } {
    if (this.state.mode === "insert") {
      const action = INSERT_BINDINGS[key];
      if (action === "normalMode") {
        this.state.mode = "normal";
        return { text, cursor, action };
      }
      if (action === "submit") {
        this.state.mode = "normal";
        return { text, cursor, action };
      }
      if (action === "backspace") {
        if (cursor > 0) {
          text = text.slice(0, cursor - 1) + text.slice(cursor);
          cursor--;
        }
        return { text, cursor, action };
      }
      if (action === "deleteForward") {
        if (cursor < text.length) {
          text = text.slice(0, cursor) + text.slice(cursor + 1);
        }
        return { text, cursor, action };
      }
      if (action === "home") {
        return { text, cursor: 0, action };
      }
      if (action === "end") {
        return { text, cursor: text.length, action };
      }
      if (action === "pageUp" || action === "pageDown") {
        return { text, cursor, action };
      }

      if (key.length === 1) {
        text = text.slice(0, cursor) + key + text.slice(cursor);
        cursor++;
      }
      return { text, cursor };
    }

    if (this.state.mode === "normal") {
      this.state.pendingKeys.push(key);
      const combo = this.state.pendingKeys.join("");

      const action = NORMAL_BINDINGS[combo];
      if (action) {
        this.state.pendingKeys = [];
        return this.executeNormalAction(action, text, cursor);
      }

      const partialMatch = Object.keys(NORMAL_BINDINGS).some(k => k.startsWith(combo) && k !== combo);
      if (!partialMatch) {
        this.state.pendingKeys = [key];
        const fallback = NORMAL_BINDINGS[key];
        if (fallback) {
          this.state.pendingKeys = [];
          return this.executeNormalAction(fallback, text, cursor);
        }
        this.state.pendingKeys = [];
      }

      return { text, cursor };
    }

    if (this.state.mode === "visual") {
      if (key === "Escape") {
        this.state.mode = "normal";
      }
      return { text, cursor };
    }

    return { text, cursor };
  }

  private executeNormalAction(action: VimAction, text: string, cursor: number): { text: string; cursor: number; action?: VimAction } {
    switch (action) {
      case "moveLeft":
        return { text, cursor: Math.max(0, cursor - 1), action };
      case "moveRight":
        return { text, cursor: Math.min(text.length, cursor + 1), action };
      case "moveDown":
        return { text, cursor: Math.min(text.length, cursor + 20), action };
      case "moveUp":
        return { text, cursor: Math.max(0, cursor - 20), action };
      case "moveWordRight": {
        const next = text.indexOf(" ", cursor + 1);
        return { text, cursor: next > 0 ? next + 1 : text.length, action };
      }
      case "moveWordLeft": {
        const prev = text.lastIndexOf(" ", cursor - 2);
        return { text, cursor: prev > 0 ? prev + 1 : 0, action };
      }
      case "moveLineStart":
        return { text, cursor: 0, action };
      case "moveLineEnd":
        return { text, cursor: text.length, action };
      case "insertMode":
        this.state.mode = "insert";
        return { text, cursor, action };
      case "appendMode":
        this.state.mode = "insert";
        return { text, cursor: Math.min(text.length, cursor + 1), action };
      case "insertLineStart":
        this.state.mode = "insert";
        return { text, cursor: 0, action };
      case "normalMode":
        return { text, cursor, action };
      case "visualMode":
        this.state.mode = "visual";
        return { text, cursor, action };
      case "deleteChar": {
        if (cursor < text.length) {
          this.state.pushUndo(text, cursor);
          this.state.clipboard = text[cursor];
          text = text.slice(0, cursor) + text.slice(cursor + 1);
        }
        this.state.lastMotion = "x";
        return { text, cursor, action };
      }
      case "deleteLine":
        this.state.pushUndo(text, cursor);
        this.state.clipboard = text;
        text = "";
        cursor = 0;
        this.state.lastMotion = "dd";
        return { text, cursor, action };
      case "deleteWord": {
        this.state.pushUndo(text, cursor);
        // Find end of current/next word
        let end = cursor;
        if (end < text.length && text[end] === " ") {
          // Skip leading spaces
          while (end < text.length && text[end] === " ") end++;
        }
        while (end < text.length && text[end] !== " ") end++;
        this.state.clipboard = text.slice(cursor, end);
        text = text.slice(0, cursor) + text.slice(end);
        this.state.lastMotion = "dw";
        return { text, cursor, action };
      }
      case "backspace":
        if (cursor > 0) {
          this.state.pushUndo(text, cursor);
          text = text.slice(0, cursor - 1) + text.slice(cursor);
          cursor--;
        }
        return { text, cursor, action };
      case "submit":
        this.state.mode = "insert";
        return { text, cursor, action };
      case "home":
        return { text, cursor: 0, action };
      case "end":
        return { text, cursor: text.length, action };
      case "yankLine":
        this.state.clipboard = text;
        this.state.lastMotion = "yy";
        return { text, cursor, action };
      case "pasteAfter": {
        if (this.state.clipboard) {
          this.state.pushUndo(text, cursor);
          const before = text.slice(0, cursor + 1);
          const after = text.slice(cursor + 1);
          text = before + this.state.clipboard + after;
          cursor += this.state.clipboard.length;
        }
        this.state.lastMotion = "p";
        return { text, cursor, action };
      }
      case "pasteBefore": {
        if (this.state.clipboard) {
          this.state.pushUndo(text, cursor);
          const before = text.slice(0, cursor);
          const after = text.slice(cursor);
          text = before + this.state.clipboard + after;
          cursor += this.state.clipboard.length;
        }
        this.state.lastMotion = "P";
        return { text, cursor, action };
      }
      case "undo": {
        const entry = this.state.popUndo(text, cursor);
        if (entry) {
          text = entry.text;
          cursor = entry.cursor;
        }
        this.state.lastMotion = "u";
        return { text, cursor, action };
      }
      case "redo": {
        const entry = this.state.popRedo(text, cursor);
        if (entry) {
          text = entry.text;
          cursor = entry.cursor;
        }
        this.state.lastMotion = "r";
        return { text, cursor, action };
      }
      default:
        return { text, cursor };
    }
  }

  handleData(data: string, text: string, cursor: number): { text: string; cursor: number; action?: VimAction; handled: boolean } {
    const char = data;

    // Arrow keys
    if (data === "\x1b[A") return { text, cursor: Math.max(0, cursor - 20), action: "moveUp", handled: true };
    if (data === "\x1b[B") return { text, cursor: Math.min(text.length, cursor + 20), action: "moveDown", handled: true };
    if (data === "\x1b[C") return { text, cursor: Math.min(text.length, cursor + 1), action: "moveRight", handled: true };
    if (data === "\x1b[D") return { text, cursor: Math.max(0, cursor - 1), action: "moveLeft", handled: true };

    if (data === "\r" || data === "\n") {
      return { ...this.handleKey("Enter", text, cursor), handled: true };
    }
    if (data === "\x7f" || data === "\b") {
      return { ...this.handleKey("Backspace", text, cursor), handled: true };
    }
    if (data === "\x1b" || data === "\x03") {
      return { ...this.handleKey("Escape", text, cursor), handled: true };
    }
    if (data === "\t") {
      return { text: text + "\t", cursor: cursor + 1, handled: true };
    }

    // Printable characters
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      return { ...this.handleKey(data, text, cursor), handled: true };
    }

    return { text, cursor, handled: false };
  }
}
