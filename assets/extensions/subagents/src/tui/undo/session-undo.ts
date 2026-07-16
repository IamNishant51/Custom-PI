import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface UndoAction {
  type: "file_edit" | "file_create" | "file_delete" | "bash";
  timestamp: number;
  description: string;

  filePath?: string;
  originalContent?: string;
  originalHash?: string;

  deletedContent?: string;

  warning?: string;
}

export interface UndoResult {
  success: boolean;
  message: string;
  warning?: string;
}

export class UndoStack {
  private stack: UndoAction[] = [];
  private maxDepth = 50;

  push(action: UndoAction): void {
    this.stack.push(action);
    if (this.stack.length > this.maxDepth) {
      this.stack.shift();
    }
  }

  peek(): UndoAction | null {
    if (this.stack.length === 0) return null;
    return this.stack[this.stack.length - 1] ?? null;
  }

  clear(): void {
    this.stack = [];
  }

  get length(): number {
    return this.stack.length;
  }

  async undo(): Promise<UndoResult> {
    const action = this.stack.pop();
    if (!action) {
      return { success: false, message: "Nothing to undo" };
    }

    try {
      switch (action.type) {
        case "file_edit": {
          if (!action.filePath || action.originalContent === undefined) {
            return { success: false, message: "Incomplete undo action: missing file path or content" };
          }
          await writeFile(action.filePath, action.originalContent, "utf-8");
          return {
            success: true,
            message: `Undid edit: ${action.description}`,
          };
        }

        case "file_create": {
          if (!action.filePath) {
            return { success: false, message: "Incomplete undo action: missing file path" };
          }
          if (existsSync(action.filePath)) {
            await unlink(action.filePath);
          }
          return {
            success: true,
            message: `Undid creation: ${action.description}`,
          };
        }

        case "file_delete": {
          if (!action.filePath || action.deletedContent === undefined) {
            return { success: false, message: "Incomplete undo action: missing file path or content" };
          }
          await writeFile(action.filePath, action.deletedContent, "utf-8");
          return {
            success: true,
            message: `Restored deleted file: ${action.description}`,
          };
        }

        case "bash": {
          return {
            success: true,
            message: `Undo marked for: ${action.description}`,
            warning: action.warning || "Bash commands may have side effects beyond file changes. Manual verification recommended.",
          };
        }

        default:
          return { success: false, message: `Unknown action type: ${(action as UndoAction).type}` };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Undo failed: ${msg}`,
      };
    }
  }
}
