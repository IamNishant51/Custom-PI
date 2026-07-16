import { THEME } from "../theme/theme";
import { fg, fgBold, dim } from "../theme/colorize";
import { measureWidth, stripAnsi } from "../render/format";

export interface SessionEntry {
  id: string;
  title: string;
  timestamp: number;
  messageCount: number;
  model?: string;
  preview?: string;
}

interface DateGroup {
  label: string;
  sessions: SessionEntry[];
}

const SESSION_TITLES = [
  "Fix auth middleware errors",
  "Add rate limiting to API",
  "Refactor database layer",
  "Set up CI/CD pipeline",
  "Feature: user dashboard",
  "Deploy to staging",
  "Optimize query performance",
  "Add input validation",
  "Update dependencies",
  "Fix memory leak in worker",
  "Refactor WebSocket handler",
  "Add end-to-end tests",
];

const SESSION_PREVIEWS = [
  "Added JWT validation and error handling for expired tokens",
  "Implemented token bucket algorithm with Redis backend",
  "Extracted repository pattern and added connection pooling",
  "Configured GitHub Actions with build, test, and deploy stages",
  "Built responsive dashboard with real-time analytics widgets",
  "Deployed v2.1.0 to staging with blue-green strategy",
  "Added composite indexes and optimized N+1 queries",
  "Added Zod schemas with custom error messages",
  "Updated lodash, express, and typescript to latest major",
  "Fixed circular references in event emitter cleanup",
  "Split monolithic handler into focused service modules",
  "Added Playwright tests for critical user flows",
];

export class SessionList {
  visible = false;
  sessions: SessionEntry[] = [];
  selectedIndex = 0;
  onSelect: ((session: SessionEntry) => void) | null = null;
  onCancel: (() => void) | null = null;

  private searchMode = false;
  private filterQuery = "";
  private scrollOffset = 0;

  constructor() {
    this.sessions = this.generateSessions();
  }

  open(sessions?: SessionEntry[]): void {
    if (sessions) this.sessions = sessions;
    this.visible = true;
    this.selectedIndex = 0;
    this.filterQuery = "";
    this.searchMode = false;
    this.scrollOffset = 0;
  }

  close(): void {
    this.visible = false;
    this.searchMode = false;
  }

  private generateSessions(): SessionEntry[] {
    const now = Date.now();
    const DAY = 86400000;
    const sessions: SessionEntry[] = [];

    for (let i = 0; i < SESSION_TITLES.length; i++) {
      let offset: number;
      if (i < 3) {
        offset = Math.random() * 4 * 3600000;
      } else if (i < 5) {
        offset = DAY + Math.random() * DAY;
      } else if (i < 8) {
        offset = (2 + Math.floor(Math.random() * 5)) * DAY;
      } else {
        offset = (10 + Math.floor(Math.random() * 20)) * DAY;
      }
      sessions.push({
        id: `session-${i + 1}`,
        title: SESSION_TITLES[i],
        timestamp: now - offset,
        messageCount: 3 + Math.floor(Math.random() * 30),
        model: ["Claude Sonnet 4.5", "GPT-4o", "DeepSeek-R1"][i % 3],
        preview: SESSION_PREVIEWS[i],
      });
    }

    sessions.sort((a, b) => b.timestamp - a.timestamp);
    return sessions;
  }

  private getDateGroups(sessions: SessionEntry[]): DateGroup[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const weekAgo = today - 7 * 86400000;
    const groups: DateGroup[] = [];
    const getGroupLabel = (ts: number): string => {
      if (ts >= today) return "Today";
      if (ts >= yesterday) return "Yesterday";
      if (ts >= weekAgo) return "This Week";
      return "Older";
    };

    let prevLabel = "";
    for (const session of sessions) {
      const label = getGroupLabel(session.timestamp);
      if (label !== prevLabel) {
        groups.push({ label, sessions: [] });
        prevLabel = label;
      }
      groups[groups.length - 1].sessions.push(session);
    }

    return groups;
  }

  private get flatSessions(): SessionEntry[] {
    if (!this.filterQuery && !this.searchMode) return this.sessions;
    const q = (this.filterQuery || "").toLowerCase();
    if (!q) return this.sessions;
    return this.sessions.filter(s =>
      s.title.toLowerCase().includes(q) ||
      (s.preview && s.preview.toLowerCase().includes(q)) ||
      (s.model && s.model.toLowerCase().includes(q))
    );
  }

  handleInput(char: string): "navigate" | "close" | null {
    if (!this.visible) return null;

    if (this.searchMode) {
      if (char === "Escape") {
        this.searchMode = false;
        this.filterQuery = "";
        this.selectedIndex = 0;
        return "navigate";
      }
      if (char === "\n" || char === "\r") {
        this.searchMode = false;
        if (this.filterQuery) {
          const filtered = this.flatSessions;
          this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, filtered.length - 1));
        }
        return "navigate";
      }
      if (char === "Backspace" || char === "\x7f") {
        this.filterQuery = this.filterQuery.slice(0, -1);
        this.selectedIndex = 0;
        return "navigate";
      }
      if (char.length === 1 && char.charCodeAt(0) >= 32) {
        this.filterQuery += char;
        this.selectedIndex = 0;
        return "navigate";
      }
      return null;
    }

    if (char === "Escape") {
      this.close();
      if (this.onCancel) this.onCancel();
      return "close";
    }
    if (char === "/") {
      this.searchMode = true;
      this.filterQuery = "";
      return "navigate";
    }
    if (char === "\n" || char === "\r") {
      const sessions = this.flatSessions;
      const session = sessions[this.selectedIndex];
      if (session && this.onSelect) this.onSelect(session);
      this.close();
      return "close";
    }
    if (char === "\x1b[A") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.ensureVisible();
      return "navigate";
    }
    if (char === "\x1b[B") {
      const sessions = this.flatSessions;
      this.selectedIndex = Math.min(sessions.length - 1, this.selectedIndex + 1);
      this.ensureVisible();
      return "navigate";
    }
    if (char === "g") {
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      return "navigate";
    }
    if (char === "G") {
      const sessions = this.flatSessions;
      this.selectedIndex = sessions.length - 1;
      this.ensureVisible();
      return "navigate";
    }
    return null;
  }

  private ensureVisible(): void {
    const sessions = this.flatSessions;
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    }
    const maxItems = Math.min(14, 30 - 8);
    if (this.selectedIndex >= this.scrollOffset + maxItems) {
      this.scrollOffset = this.selectedIndex - maxItems + 1;
    }
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, sessions.length - maxItems)));
  }

  render(width: number, _cols: number, rows: number): string[] {
    if (!this.visible) return [];
    const ink = THEME.ink;
    const surface = THEME.card;
    const hairline = THEME.hairline;
    const accent = THEME.accent;
    const muted = THEME.muted;
    const info = THEME.info;
    const success = THEME.success;
    const warning = THEME.warning;

    const dW = Math.min(64, width - 4);
    const maxItems = Math.min(14, rows - 8);
    const lines: string[] = [];
    const solidBg = `\x1b[48;2;${parseInt(surface.slice(1,3), 16)};${parseInt(surface.slice(3,5), 16)};${parseInt(surface.slice(5,7), 16)}m`;
    const borderClr = `\x1b[38;2;${parseInt(hairline.slice(1,3), 16)};${parseInt(hairline.slice(3,5), 16)};${parseInt(hairline.slice(5,7), 16)}m`;
    const inkFg = `\x1b[38;2;${parseInt(ink.slice(1,3), 16)};${parseInt(ink.slice(3,5), 16)};${parseInt(ink.slice(5,7), 16)}m`;
    const mutedFg = `\x1b[38;2;${parseInt(muted.slice(1,3), 16)};${parseInt(muted.slice(3,5), 16)};${parseInt(muted.slice(5,7), 16)}m`;
    const accentFg = `\x1b[38;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m`;
    const infoFg = `\x1b[38;2;${parseInt(info.slice(1,3), 16)};${parseInt(info.slice(3,5), 16)};${parseInt(info.slice(5,7), 16)}m`;

    const title = " Sessions ";
    lines.push(`${borderClr}\u250c${solidBg}\u2500${accentFg}${title}\x1b[0m${borderClr}${"\u2500".repeat(Math.max(1, dW - measureWidth(title) - 3))}\u2510\x1b[0m`);

    // Search bar
    if (this.searchMode) {
      const searchLine = `\u{1F50D} ${this.filterQuery || ""}\u258c`;
      lines.push(`${solidBg}${accentFg}\u2502${searchLine.padEnd(dW - 2)}\u2502\x1b[0m`);
    } else {
      const filterDisplay = `\u{1F50D} ${this.filterQuery || "search sessions..."}`;
      lines.push(`${solidBg}${inkFg}\u2502${filterDisplay.padEnd(dW - 2)}\u2502\x1b[0m`);
    }

    const sessions = this.flatSessions;
    const groups = this.getDateGroups(sessions);
    let globalIdx = 0;
    let renderedCount = 0;

    // Flatten groups into display with headers
    interface DisplayItem {
      type: "header" | "session";
      label?: string;
      session?: SessionEntry;
      globalIndex: number;
    }
    const displayItems: DisplayItem[] = [];
    for (const group of groups) {
      displayItems.push({ type: "header", label: group.label, globalIndex: -1 });
      for (const s of group.sessions) {
        displayItems.push({ type: "session", session: s, globalIndex: globalIdx++ });
      }
    }

    for (let i = this.scrollOffset; i < displayItems.length && renderedCount < maxItems; i++) {
      const item = displayItems[i];
      if (item.type === "header") {
        const headerBg = `\x1b[48;2;${parseInt(THEME.canvas.slice(1,3), 16)};${parseInt(THEME.canvas.slice(3,5), 16)};${parseInt(THEME.canvas.slice(5,7), 16)}m`;
        lines.push(`${headerBg}${infoFg}\u2502 ${fgBold(THEME.textSecondary, item.label!)}${" ".repeat(Math.max(0, dW - 4 - measureWidth(item.label!)))}\u2502\x1b[0m`);
        renderedCount++;
        continue;
      }

      const session = item.session!;
      const isSelected = item.globalIndex === this.selectedIndex;
      const bg = isSelected ? `\x1b[48;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m` : solidBg;
      const fgColor = isSelected ? "\x1b[38;2;255;255;255m" : inkFg;

      const ts = new Date(session.timestamp);
      const timeStr = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const dateStr = session.timestamp >= Date.now() - 86400000
        ? timeStr
        : ts.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });
      const msgStr = `${session.messageCount} msg${session.messageCount > 1 ? "s" : ""}`;
      const modelStr = session.model ? ` ${session.model}` : "";

      const titleStr = session.title;
      const metaStr = `${dateStr}  ${msgStr}${modelStr}`;
      const truncatedTitle = titleStr.length > dW - 14 ? titleStr.slice(0, dW - 17) + "..." : titleStr;
      const dot = isSelected ? "\u25C9" : "\u25CB";

      lines.push(`${bg}${fgColor}\u2502 ${dot} ${truncatedTitle}${" ".repeat(Math.max(0, dW - 6 - measureWidth(truncatedTitle)))}\u2502\x1b[0m`);
      renderedCount++;

      if (isSelected && session.preview && renderedCount < maxItems) {
        const preview = session.preview;
        const truncatedPreview = preview.length > dW - 10 ? preview.slice(0, dW - 13) + "..." : preview;
        lines.push(`${solidBg}${fg(THEME.textTertiary, `\u2502   ${truncatedPreview}`.padEnd(dW - 2))}\u2502\x1b[0m`);
        renderedCount++;
      }

      // Show metadata on next line for non-selected if space allows
      if (!isSelected && renderedCount < maxItems) {
        const metaDisplay = `${mutedFg}${dateStr}\x1b[0m ${fg(THEME.textTertiary, msgStr)}`;
        lines.push(`${solidBg}\u2502  ${" ".repeat(2)}${metaDisplay}${" ".repeat(Math.max(0, dW - 8 - measureWidth(dateStr) - measureWidth(msgStr)))}\u2502\x1b[0m`);
        renderedCount++;
      }
    }

    if (sessions.length === 0) {
      lines.push(`${solidBg}${mutedFg}\u2502 ${"No sessions found".padEnd(dW - 4)}\u2502\x1b[0m`);
    }

    // Fill
    for (let i = lines.length; i < rows - 3; i++) {
      lines.push(`${solidBg}${" ".repeat(dW)}\x1b[0m`);
    }

    const totalSessions = this.sessions.length;
    const pct = totalSessions > 0 ? Math.round((this.selectedIndex / Math.max(1, totalSessions - 1)) * 100) : 0;
    const pctText = ` ${pct}% `;
    const helpText = this.searchMode
      ? " type to search  [Enter] done  [Esc] cancel "
      : " [/] search  [\u2191\u2193] navigate  [Enter] resume  [g/G] top/bottom  [Esc] close ";
    const statusBar = `${borderClr}\u2514${solidBg}${fg(THEME.dim, helpText.padEnd(dW - measureWidth(pctText) - 2))}\x1b[0m${solidBg}${fg(THEME.muted, pctText)}\x1b[0m${borderClr}\u2518\x1b[0m`;
    lines.push(statusBar);

    return lines;
  }
}
