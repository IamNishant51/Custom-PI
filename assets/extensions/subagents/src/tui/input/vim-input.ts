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

export class VimState {
  mode: VimMode = "normal";
  pendingKeys: string[] = [];
  lastMotion: string = "";
  register: string = '"';
  insertCount = 0;

  reset(): void {
    this.pendingKeys = [];
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
      case "deleteChar":
        if (cursor < text.length) {
          text = text.slice(0, cursor) + text.slice(cursor + 1);
        }
        this.state.lastMotion = "x";
        return { text, cursor, action };
      case "deleteLine":
        text = "";
        cursor = 0;
        this.state.lastMotion = "dd";
        return { text, cursor, action };
      case "backspace":
        if (cursor > 0) {
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
      case "undo":
        return { text, cursor, action };
      case "redo":
        return { text, cursor, action };
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
