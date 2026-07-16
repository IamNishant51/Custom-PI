import fs from "node:fs";
import path from "node:path";
import { THEME } from "../theme/theme";
import { fg, fgBold, dim } from "../theme/colorize";
import { measureWidth, stripAnsi } from "../render/format";

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  children: FileEntry[] | null;
  expanded: boolean;
  depth: number;
}

const HIDDEN_PATTERN = /^\./;
const MAX_PREVIEW_LINES = 3;
const MAX_VISIBLE_ITEMS = 20;

export class FilePicker {
  visible = false;
  root: FileEntry | null = null;
  selectedIndex = 0;
  selectedFiles: Set<string> = new Set();
  onSelect: ((files: string[]) => void) | null = null;
  onCancel: (() => void) | null = null;

  private cwd: string;
  private flatList: FileEntry[] = [];
  private previewCache: Map<string, string[]> = new Map();
  private searchQuery = "";

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  open(startPath?: string): void {
    const dir = startPath ?? this.cwd;
    this.root = this.buildTree(dir, 0);
    this.visible = true;
    this.selectedIndex = 0;
    this.selectedFiles.clear();
    this.searchQuery = "";
    this.rebuildFlatList();
  }

  close(): void {
    this.visible = false;
    this.previewCache.clear();
  }

  private buildTree(dirPath: string, depth: number): FileEntry {
    const name = path.basename(dirPath) || dirPath;
    const entry: FileEntry = {
      name,
      path: dirPath,
      type: "dir",
      children: null,
      expanded: depth === 0,
      depth,
    };
    if (depth === 0) {
      entry.children = this.loadChildren(dirPath, depth + 1);
    }
    return entry;
  }

  private loadChildren(dirPath: string, depth: number): FileEntry[] {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const children: FileEntry[] = [];
      for (const dirent of entries) {
        if (HIDDEN_PATTERN.test(dirent.name)) continue;
        const fullPath = path.join(dirPath, dirent.name);
        if (dirent.isDirectory()) {
          children.push({
            name: dirent.name,
            path: fullPath,
            type: "dir",
            children: null,
            expanded: false,
            depth,
          });
        } else if (dirent.isFile()) {
          children.push({
            name: dirent.name,
            path: fullPath,
            type: "file",
            children: null,
            expanded: false,
            depth,
          });
        }
      }
      children.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return children;
    } catch {
      return [];
    }
  }

  private rebuildFlatList(): void {
    this.flatList = [];
    if (!this.root) return;
    const walk = (node: FileEntry): void => {
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        if (node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)) {
          this.flatList.push(node);
        }
        if (node.type === "dir" && node.children) {
          for (const child of node.children) walk(child);
        }
      } else {
        this.flatList.push(node);
        if (node.type === "dir" && node.expanded && node.children) {
          for (const child of node.children) walk(child);
        }
      }
    };
    walk(this.root);
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.flatList.length - 1));
  }

  private expandNode(node: FileEntry): void {
    if (node.type !== "dir") return;
    if (!node.children) {
      node.children = this.loadChildren(node.path, node.depth + 1);
    }
    node.expanded = true;
    this.rebuildFlatList();
  }

  private collapseNode(node: FileEntry): void {
    if (node.type !== "dir") return;
    node.expanded = false;
    this.rebuildFlatList();
  }

  private getPreview(filePath: string): string[] {
    if (this.previewCache.has(filePath)) {
      return this.previewCache.get(filePath)!;
    }
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").slice(0, MAX_PREVIEW_LINES);
      this.previewCache.set(filePath, lines);
      return lines;
    } catch {
      const lines: string[] = ["(binary or unreadable)"];
      this.previewCache.set(filePath, lines);
      return lines;
    }
  }

  handleInput(char: string): "navigate" | "close" | null {
    if (!this.visible) return null;
    if (char === "Escape") {
      if (this.selectedFiles.size > 0) {
        this.selectedFiles.clear();
        return "navigate";
      }
      this.close();
      if (this.onCancel) this.onCancel();
      return "close";
    }
    if (char === "\n" || char === "\r") {
      const entry = this.flatList[this.selectedIndex];
      if (!entry) return null;
      if (entry.type === "dir") {
        if (entry.expanded) {
          this.collapseNode(entry);
        } else {
          this.expandNode(entry);
        }
        return "navigate";
      }
      if (entry.type === "file") {
        if (!this.selectedFiles.has(entry.path)) {
          this.selectedFiles.add(entry.path);
        }
        if (this.onSelect) {
          this.onSelect(Array.from(this.selectedFiles));
        }
        this.close();
        return "close";
      }
      return null;
    }
    if (char === "\x1b[A") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return "navigate";
    }
    if (char === "\x1b[B") {
      this.selectedIndex = Math.min(this.flatList.length - 1, this.selectedIndex + 1);
      return "navigate";
    }
    if (char === " " || char === "\x1b[C") {
      const entry = this.flatList[this.selectedIndex];
      if (!entry) return null;
      if (entry.type === "dir") {
        if (entry.expanded) {
          this.collapseNode(entry);
        } else {
          this.expandNode(entry);
        }
        return "navigate";
      }
      if (entry.type === "file") {
        if (this.selectedFiles.has(entry.path)) {
          this.selectedFiles.delete(entry.path);
        } else if (this.selectedFiles.size < 5) {
          this.selectedFiles.add(entry.path);
        }
        return "navigate";
      }
      return null;
    }
    if (char === "\x1b[D" || char === "h" || char === "H") {
      const entry = this.flatList[this.selectedIndex];
      if (entry && entry.type === "dir" && entry.expanded) {
        this.collapseNode(entry);
        return "navigate";
      }
      return null;
    }
    if (char === "Backspace" || char === "\x7f") {
      if (this.searchQuery) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.rebuildFlatList();
        return "navigate";
      }
      return null;
    }
    if (char.length === 1 && char.charCodeAt(0) >= 32 && char !== "/") {
      this.searchQuery += char;
      this.rebuildFlatList();
      return "navigate";
    }
    return null;
  }

  render(width: number, _cols: number, rows: number): string[] {
    if (!this.visible || !this.root) return [];
    const ink = THEME.ink;
    const surface = THEME.card;
    const hairline = THEME.hairline;
    const accent = THEME.accent;
    const muted = THEME.muted;
    const info = THEME.info;
    const success = THEME.success;

    const dW = Math.min(64, width - 4);
    const maxItems = Math.min(MAX_VISIBLE_ITEMS, rows - 8);
    const lines: string[] = [];
    const solidBg = `\x1b[48;2;${parseInt(surface.slice(1,3), 16)};${parseInt(surface.slice(3,5), 16)};${parseInt(surface.slice(5,7), 16)}m`;
    const borderClr = `\x1b[38;2;${parseInt(hairline.slice(1,3), 16)};${parseInt(hairline.slice(3,5), 16)};${parseInt(hairline.slice(5,7), 16)}m`;
    const inkFg = `\x1b[38;2;${parseInt(ink.slice(1,3), 16)};${parseInt(ink.slice(3,5), 16)};${parseInt(ink.slice(5,7), 16)}m`;
    const mutedFg = `\x1b[38;2;${parseInt(muted.slice(1,3), 16)};${parseInt(muted.slice(3,5), 16)};${parseInt(muted.slice(5,7), 16)}m`;
    const accentFg = `\x1b[38;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m`;
    const successFg = `\x1b[38;2;${parseInt(success.slice(1,3), 16)};${parseInt(success.slice(3,5), 16)};${parseInt(success.slice(5,7), 16)}m`;
    const infoFg = `\x1b[38;2;${parseInt(info.slice(1,3), 16)};${parseInt(info.slice(3,5), 16)};${parseInt(info.slice(5,7), 16)}m`;

    const title = " Attach Files ";
    lines.push(`${borderClr}\u250c${solidBg}\u2500${accentFg}${title}\x1b[0m${borderClr}${"\u2500".repeat(Math.max(1, dW - measureWidth(title) - 3))}\u2510\x1b[0m`);

    const filterDisplay = `\u{1F50D} ${this.searchQuery || "search files..."}`;
    lines.push(`${solidBg}${inkFg}\u2502${filterDisplay.padEnd(dW - 2)}\u2502\x1b[0m`);

    const treeStart = lines.length;
    const visibleCount = Math.min(maxItems, this.flatList.length);
    const scrollOffset = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxItems / 2), this.flatList.length - maxItems));

    for (let i = 0; i < visibleCount; i++) {
      const idx = scrollOffset + i;
      const entry = this.flatList[idx];
      if (!entry) break;

      const selected = idx === this.selectedIndex;
      const bg = selected ? `\x1b[48;2;${parseInt(accent.slice(1,3), 16)};${parseInt(accent.slice(3,5), 16)};${parseInt(accent.slice(5,7), 16)}m` : solidBg;
      const fgColor = selected ? "\x1b[38;2;255;255;255m" : inkFg;

      const indent = "  ".repeat(Math.max(0, entry.depth));
      const isSelected = this.selectedFiles.has(entry.path);
      const check = isSelected ? "\u25C9" : " ";
      const icon = entry.type === "dir"
        ? (entry.expanded ? "\u25BC" : "\u25B6")
        : "\u2507";
      const nameStr = `${indent}${check}${icon} ${entry.name}`;
      const displayName = nameStr.length > dW - 6 ? nameStr.slice(0, dW - 9) + "..." : nameStr;
      lines.push(`${bg}${fgColor}\u2502 ${displayName}${" ".repeat(Math.max(0, dW - 4 - measureWidth(stripAnsi(displayName))))}\u2502\x1b[0m`);
    }

    if (this.flatList.length === 0) {
      lines.push(`${solidBg}${mutedFg}\u2502 ${"No files found".padEnd(dW - 4)}\u2502\x1b[0m`);
    }

    const treeLines = lines.length - treeStart;
    const previewStart = treeStart + treeLines;

    // Preview panel
    const currentEntry = this.flatList[this.selectedIndex];
    if (currentEntry && currentEntry.type === "file" && treeLines < maxItems) {
      const preview = this.getPreview(currentEntry.path);
      for (let i = 0; i < MAX_PREVIEW_LINES && treeStart + treeLines + i < previewStart + MAX_PREVIEW_LINES; i++) {
        const previewLine = i < preview.length ? preview[i] : "";
        const truncated = previewLine.length > dW - 6 ? previewLine.slice(0, dW - 9) + "..." : previewLine;
        lines.push(`${solidBg}${infoFg}\u2502 ${dim("\u2502 ")}\x1b[0m${fg(THEME.textTertiary, truncated.padEnd(Math.max(0, dW - 7)))}\u2502\x1b[0m`);
      }
    }

    // Fill remaining
    for (let i = lines.length; i < rows - 3; i++) {
      lines.push(`${solidBg}${" ".repeat(dW)}\x1b[0m`);
    }

    // Selected files summary
    if (this.selectedFiles.size > 0) {
      const selectedStr = ` Selected: ${this.selectedFiles.size} file${this.selectedFiles.size > 1 ? "s" : ""} `;
      lines.push(`${solidBg}${successFg}\u2502${selectedStr.padEnd(dW - 2)}\u2502\x1b[0m`);
      for (const f of Array.from(this.selectedFiles).slice(0, 3)) {
        const short = path.relative(this.cwd, f);
        const truncated = short.length > dW - 8 ? "..." + short.slice(-(dW - 11)) : short;
        lines.push(`${solidBg}${fg(THEME.textSecondary, `\u2502   \u25B8 ${truncated}`.padEnd(dW - 1))}\u2502\x1b[0m`);
      }
    }

    const helpText = ` [\u2191\u2193] nav  [\u2192/Space] expand  [\u2190/h] collapse  [Space] select  [Enter] done `;
    lines.push(`${solidBg}${fg(THEME.dim, `\u2502${helpText.padEnd(dW - 2)}`)}\u2502\x1b[0m`);

    lines.push(`${borderClr}\u2514${"\u2500".repeat(dW - 2)}\u2518\x1b[0m`);
    return lines;
  }
}
