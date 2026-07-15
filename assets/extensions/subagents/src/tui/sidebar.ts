import * as fs from "fs";
import * as path from "path";
import { THEME } from "./theme/theme";

export type SidebarTab = "files" | "memory" | "agents";

export interface SidebarState {
  visible: boolean;
  width: number;
  activeTab: SidebarTab;
  files: FileEntry[];
  expandedDirs: Set<string>;
  scrollOffset: number;
}

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
}

export class SidebarPanel {
  state: SidebarState = {
    visible: false,
    width: 28,
    activeTab: "files",
    files: [],
    expandedDirs: new Set(),
    scrollOffset: 0,
  };

  private workspaceRoot = "";

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  toggle(): void {
    this.state.visible = !this.state.visible;
    if (this.state.visible) this.scanFiles();
  }

  show(): void {
    this.state.visible = true;
    this.scanFiles();
  }

  hide(): void {
    this.state.visible = false;
  }

  switchTab(tab: SidebarTab): void {
    this.state.activeTab = tab;
    this.state.scrollOffset = 0;
    if (tab === "files") this.scanFiles();
  }

  private scanFiles(): void {
    if (!this.workspaceRoot) return;
    const entries: FileEntry[] = [];
    try {
      this._walkDir(this.workspaceRoot, entries, 0, 3);
    } catch {}
    this.state.files = entries;
  }

  private _walkDir(dir: string, entries: FileEntry[], depth: number, maxDepth: number): void {
    if (depth > maxDepth) return;
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const sorted = items.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const item of sorted) {
        if (item.name.startsWith(".") || item.name === "node_modules") continue;
        const fullPath = path.join(dir, item.name);
        entries.push({ name: item.name, path: fullPath, isDir: item.isDirectory(), depth });
        if (item.isDirectory() && this.state.expandedDirs.has(fullPath)) {
          this._walkDir(fullPath, entries, depth + 1, maxDepth);
        }
      }
    } catch {}
  }

  handleInput(char: string): "navigate" | "toggleDir" | "close" | null {
    if (!this.state.visible) return null;
    if (char === "Escape" || char === "\x02") { // Escape or Ctrl+B
      this.hide();
      return "close";
    }
    if (char === "\x1b[A") { this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 1); return "navigate"; }
    if (char === "\x1b[B") { this.state.scrollOffset = Math.min(this.state.files.length - 1, this.state.scrollOffset + 1); return "navigate"; }
    if (char === "1") { this.switchTab("files"); return "navigate"; }
    if (char === "2") { this.switchTab("memory"); return "navigate"; }
    if (char === "3") { this.switchTab("agents"); return "navigate"; }
    if (char === "\n" || char === "\r") {
      const file = this.state.files[this.state.scrollOffset];
      if (file && file.isDir) {
        if (this.state.expandedDirs.has(file.path)) this.state.expandedDirs.delete(file.path);
        else this.state.expandedDirs.add(file.path);
        this.scanFiles();
        return "toggleDir";
      }
    }
    return null;
  }

  render(): string[] {
    if (!this.state.visible) return [];
    const w = this.state.width;
    const ink = THEME.ink;
    const muted = THEME.muted;
    const hairline = THEME.hairline;
    const accent = THEME.accent;
    const surface = THEME.card;
    const canvas = THEME.canvas;

    const lines: string[] = [];
    const bg = `\x1b[48;2;${parseInt(surface.slice(1,3), 16)};${parseInt(surface.slice(3,5), 16)};${parseInt(surface.slice(5,7), 16)}m`;
    const mutedFg = `\x1b[38;2;${parseInt(muted.slice(1,3), 16)};${parseInt(muted.slice(3,5), 16)};${parseInt(muted.slice(5,7), 16)}m`;
    const accentFg = `\x1b[38;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m`;
    const inkFg = `\x1b[38;2;${parseInt(ink.slice(1,3), 16)};${parseInt(ink.slice(3,5), 16)};${parseInt(ink.slice(5,7), 16)}m`;

    // Tab bar
    const tabs = [
      { key: "1", label: "Files", id: "files" },
      { key: "2", label: "Memory", id: "memory" },
      { key: "3", label: "Agents", id: "agents" },
    ] as const;
    let tabLine = "";
    for (const tab of tabs) {
      const active = this.state.activeTab === tab.id;
      const tBg = active ? bg : `\x1b[48;2;${parseInt(canvas.slice(1,3), 16)};${parseInt(canvas.slice(3,5), 16)};${parseInt(canvas.slice(5,7), 16)}m`;
      const tFg = active ? accentFg : mutedFg;
      tabLine += `${tBg}${tFg} ${tab.label} `;
    }
    lines.push(`${bg}${mutedFg}\u250c${"\u2500".repeat(w - 2)}\u2510\x1b[0m`);
    lines.push(`${tabLine}\x1b[0m`);

    if (this.state.activeTab === "files") {
      const visible = this.state.files.slice(this.state.scrollOffset, this.state.scrollOffset + 100);
      for (const file of visible) {
        const indent = "  ".repeat(file.depth + 1);
        const icon = file.isDir
          ? (this.state.expandedDirs.has(file.path) ? "\u25bc " : "\u25b6 ")
          : "\u{1F4C4} ";
        const fg = file.isDir ? accentFg : inkFg;
        lines.push(`${bg}${fg}${indent}${icon}${file.name.slice(0, w - indent.length - 4)}\x1b[0m`);
      }
      if (visible.length === 0) {
        lines.push(`${bg}${mutedFg}  (empty)\x1b[0m`);
      }
    } else if (this.state.activeTab === "memory") {
      lines.push(`${bg}${mutedFg}  Recent memories appear here\x1b[0m`);
    } else if (this.state.activeTab === "agents") {
      lines.push(`${bg}${mutedFg}  Agent list appears here\x1b[0m`);
    }

    return lines;
  }
}
