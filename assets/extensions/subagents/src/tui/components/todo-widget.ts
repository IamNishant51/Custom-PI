import { THEME } from "../theme/theme";
import { fg, fgBold, dim } from "../theme/colorize";
import { truncateToWidth, measureWidth, stripAnsi } from "../render/format";
import { ICONS } from "../theme/icons";

export interface TodoItem {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: "high" | "medium" | "low";
}

export class TodoWidget {
  private items: TodoItem[] = [];
  private allDoneTime = 0;
  private allDoneDuration = 2000;
  private allDoneShown = false;

  setItems(items: TodoItem[]): void {
    this.items = items;
    const allDone = items.length > 0 && items.every(i => i.status === "completed" || i.status === "cancelled");
    if (allDone && !this.allDoneShown) {
      this.allDoneTime = Date.now();
      this.allDoneShown = true;
    } else if (!allDone) {
      this.allDoneShown = false;
    }
  }

  addItem(item: TodoItem): void {
    this.items.push(item);
  }

  updateItem(id: string, updates: Partial<TodoItem>): void {
    const item = this.items.find(i => i.id === id);
    if (item) Object.assign(item, updates);
    const allDone = this.items.length > 0 && this.items.every(i => i.status === "completed" || i.status === "cancelled");
    if (allDone && !this.allDoneShown) {
      this.allDoneTime = Date.now();
      this.allDoneShown = true;
    } else if (!allDone) {
      this.allDoneShown = false;
    }
  }

  clear(): void {
    this.items = [];
    this.allDoneShown = false;
  }

  getItems(): TodoItem[] {
    return this.items;
  }

  render(width: number): string[] {
    if (this.items.length === 0) return [];

    const done = this.items.filter(i => i.status === "completed" || i.status === "cancelled").length;
    const total = this.items.length;

    if (this.allDoneShown) {
      const elapsed = Date.now() - this.allDoneTime;
      if (elapsed < this.allDoneDuration) {
        const summary = `${ICONS.checkmark} ${done}/${total} done`;
        return [fg(THEME.success, summary)];
      }
      if (elapsed >= this.allDoneDuration + 2000) {
        this.items = [];
        this.allDoneShown = false;
        return [];
      }
      return [];
    }

    const lines: string[] = [];
    const maxW = Math.max(20, width - 4);

    for (const item of this.items) {
      if (item.status === "completed" || item.status === "cancelled") continue;
      let icon: string;
      let color: string;
      if (item.status === "in_progress") {
        icon = ICONS.running;
        color = THEME.accent;
      } else if (item.priority === "high") {
        icon = "\u26a0";
        color = THEME.warning;
      } else {
        icon = ICONS.waiting;
        color = THEME.muted;
      }
      const prefix = fg(color, `${icon} `);
      const desc = truncateToWidth(item.description, maxW - 4);
      lines.push(prefix + desc);
    }

    if (lines.length === 0) {
      const summary = `${ICONS.checkmark} ${done}/${total} done`;
      return [fg(THEME.success, summary)];
    }

    return lines;
  }
}
