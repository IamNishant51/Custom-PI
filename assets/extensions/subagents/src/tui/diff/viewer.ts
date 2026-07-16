import type { DiffViewerState, FileDiff, HunkLine } from "./types";
import { parseDiff } from "./utils";
import { THEME } from "../theme/theme";
import { fg, dim, bold } from "../theme/colorize";
import { measureWidth, stripAnsi } from "../render/format";
import { BOX } from "../types";

export class DiffViewer {
  state: DiffViewerState;
  private directories: string[] = [];
  private filesByDir: Map<string, FileDiff[]> = new Map();
  private expandedDirs: Set<string> = new Set();
  private allDisplayEntries: { type: "dir" | "file"; label: string; dir: string; file?: FileDiff }[] = [];

  constructor() {
    this.state = {
      visible: false,
      files: [],
      selectedFileIndex: 0,
      scrollOffset: 0,
      fileTreeFocused: true,
      searchQuery: "",
    };
  }

  open(diffText: string): void {
    const files = parseDiff(diffText);
    const base = this.commonBaseDir(files.map(f => f.filePath));
    const dirs = new Set<string>();
    const byDir = new Map<string, FileDiff[]>();

    for (const f of files) {
      const rel = base ? f.filePath.replace(base, "") : f.filePath;
      const parts = rel.split("/");
      const dir = parts.length > 1 ? (base || "") + parts.slice(0, -1).join("/") : (base || "");
      if (!dirs.has(dir)) {
        dirs.add(dir);
        byDir.set(dir, []);
      }
      byDir.get(dir)!.push(f);
    }

    this.directories = Array.from(dirs).sort();
    this.filesByDir = byDir;
    for (const d of this.directories) this.expandedDirs.add(d);
    this.rebuildDisplayEntries();

    this.state = {
      visible: true,
      files,
      selectedFileIndex: 0,
      scrollOffset: 0,
      fileTreeFocused: true,
      searchQuery: "",
    };
  }

  close(): void {
    this.state.visible = false;
  }

  private rebuildDisplayEntries(): void {
    this.allDisplayEntries = [];
    for (const dir of this.directories) {
      const files = this.filesByDir.get(dir) || [];
      const dirLabel = dir || "./";
      const collapsed = !this.expandedDirs.has(dir);
      this.allDisplayEntries.push({ type: "dir", label: (collapsed ? "\u25b6 " : "\u25bc ") + dirLabel, dir });

      if (!collapsed) {
        for (const f of files) {
          const name = f.filePath.split("/").pop() || f.filePath;
          this.allDisplayEntries.push({ type: "file", label: name, dir, file: f });
        }
      }
    }
  }

  private commonBaseDir(paths: string[]): string {
    if (paths.length === 0) return "";
    const parts = paths.map(p => p.split("/"));
    const base: string[] = [];
    for (let i = 0; i < parts[0].length - 1; i++) {
      const seg = parts[0][i];
      if (parts.every(p => p[i] === seg)) {
        base.push(seg);
      } else break;
    }
    return base.length > 0 ? base.join("/") + "/" : "";
  }

  getCurrentFile(): FileDiff | null {
    const idx = this.state.selectedFileIndex;
    const fileEntries = this.allDisplayEntries.filter(e => e.type === "file");
    const entry = fileEntries[idx];
    return entry?.file || null;
  }

  handleInput(char: string): "navigate" | "close" | null {
    if (!this.state.visible) return null;

    if (char === "\x1b" || char === "q") {
      this.close();
      return "close";
    }

    if (char === "\t") {
      this.state.fileTreeFocused = !this.state.fileTreeFocused;
      return "navigate";
    }

    if (this.state.fileTreeFocused) {
      return this.handleFileTreeInput(char);
    }
    return this.handleDiffPaneInput(char);
  }

  private handleFileTreeInput(char: string): "navigate" | null {
    const fileEntries = this.allDisplayEntries.filter(e => e.type === "file");

    if (char === "j" || char === "\x1b[B") {
      if (this.state.selectedFileIndex < fileEntries.length - 1) {
        this.state.selectedFileIndex++;
        this.state.scrollOffset = 0;
      }
      return "navigate";
    }

    if (char === "k" || char === "\x1b[A") {
      if (this.state.selectedFileIndex > 0) {
        this.state.selectedFileIndex--;
        this.state.scrollOffset = 0;
      }
      return "navigate";
    }

    if (char === " ") {
      const entry = this.getEntryAtSelection();
      if (entry?.type === "dir") {
        if (this.expandedDirs.has(entry.dir)) {
          this.expandedDirs.delete(entry.dir);
        } else {
          this.expandedDirs.add(entry.dir);
        }
        this.rebuildDisplayEntries();
      }
      return "navigate";
    }

    if (char === "r") {
      const file = this.getCurrentFile();
      if (file) {
        file.reviewed = !file.reviewed;
      }
      return "navigate";
    }

    if (char === "/") {
      this.state.searchQuery = "";
      return "navigate";
    }

    if (char === "\n" || char === "\r") {
      const file = this.getCurrentFile();
      if (file) {
        process.stdout.write(`\x1b]8;;file://${file.filePath}\x1b\\${file.filePath}\x1b]8;;\x1b\\\n`);
      }
      return "navigate";
    }

    return null;
  }

  private handleDiffPaneInput(char: string): "navigate" | null {
    if (char === "j" || char === "\x1b[B") {
      this.state.scrollOffset++;
      return "navigate";
    }

    if (char === "k" || char === "\x1b[A") {
      if (this.state.scrollOffset > 0) {
        this.state.scrollOffset--;
      }
      return "navigate";
    }

    if (char === "r") {
      const file = this.getCurrentFile();
      if (file) {
        file.reviewed = !file.reviewed;
      }
      return "navigate";
    }

    if (char === "/") {
      this.state.searchQuery = "";
      return "navigate";
    }

    return null;
  }

  private getEntryAtSelection(): { type: "dir" | "file"; label: string; dir: string; file?: FileDiff } | null {
    const fileEntries = this.allDisplayEntries.filter(e => e.type === "file");
    const entry = fileEntries[this.state.selectedFileIndex];
    if (!entry) return null;
    const entryIdx = this.allDisplayEntries.indexOf(entry);
    return this.allDisplayEntries[entryIdx] || null;
  }

  render(width: number, _cols: number, rows: number): string[] {
    if (!this.state.visible || this.state.files.length === 0) return [];

    const availableContentHeight = rows - 4;
    if (availableContentHeight < 4) return [];

    const outerBorderX = 2;
    const innerGap = 2;
    const availPanels = width - outerBorderX * 2 - innerGap;
    const leftPanelWidth = Math.max(20, Math.floor(availPanels * 0.3));
    const rightPanelWidth = availPanels - leftPanelWidth;

    const leftPanel = this.buildFileTreePanel(leftPanelWidth, availableContentHeight);
    const rightPanel = this.buildDiffPanel(rightPanelWidth, availableContentHeight);
    const panelRows = Math.max(leftPanel.length, rightPanel.length);

    const output: string[] = [];
    output.push(this.renderHeader(width));

    for (let i = 0; i < panelRows; i++) {
      const leftRow = i < leftPanel.length ? leftPanel[i] : this.blankLine(leftPanelWidth);
      const rightRow = i < rightPanel.length ? rightPanel[i] : this.blankLine(rightPanelWidth);
      output.push(`${BOX.v}${leftRow}${" ".repeat(innerGap)}${rightRow}${BOX.v}`);
    }

    output.push(this.renderFooter(width));
    output.push(`${BOX.bl}${BOX.h.repeat(width - 2)}${BOX.br}`);

    return output;
  }

  private blankLine(width: number): string {
    return " ".repeat(width);
  }

  private renderHeader(width: number): string {
    const fileCount = this.state.files.length;
    const label = ` Diff `;
    const status = `working tree`;
    const count = `${fileCount} file${fileCount !== 1 ? "s" : ""}`;
    const rightContent = ` ${status} \u2014\u2014\u2014 ${count} `;
    const available = width - 4;
    const leftFill = Math.max(0, available - measureWidth(label) - measureWidth(rightContent));
    const midFill = BOX.h.repeat(leftFill);
    return ` ${BOX.itl}${BOX.h}${fg(THEME.accent, bold("Diff"))}${midFill}${fg(THEME.muted, rightContent)}${BOX.h}${BOX.itr}`;
  }

  private buildFileTreePanel(width: number, maxHeight: number): string[] {
    const rows: string[] = [];
    const innerW = width - 2;

    const commonDir = this.commonBaseDir(this.state.files.map(f => f.filePath)) || "Files";
    const title = ` ${commonDir} `;
    const titlePad = Math.max(0, innerW - measureWidth(title));
    rows.push(`${BOX.itl}${BOX.h}${fg(THEME.muted, title)}${BOX.h.repeat(titlePad)}${BOX.itr}`);

    const selectedFileIdx = this.state.selectedFileIndex;
    let visibleIdx = 0;
    const fileCount = this.allDisplayEntries.filter(e => e.type === "file").length;

    for (const entry of this.allDisplayEntries) {
      if (rows.length >= maxHeight - 1) break;

      if (entry.type === "dir") {
        const icon = this.expandedDirs.has(entry.dir) ? fg(THEME.info, "\u25bc") : fg(THEME.muted, "\u25b6");
        const dirName = entry.label.replace(/^[▶▼] /, "");
        const line = ` ${icon} ${fg(THEME.ink, dirName)}`;
        const trimmed = this.fixedWidth(line, innerW);
        rows.push(`${BOX.v}${trimmed}${BOX.v}`);
        continue;
      }

      if (entry.type === "file") {
        const file = entry.file!;
        const isSelected = this.state.fileTreeFocused && visibleIdx === selectedFileIdx;

        const statusIcon = file.reviewed
          ? fg(THEME.success, "\u25c9")
          : fg(THEME.muted, "\u25cb");

        const reviewLabel = file.reviewed
          ? ` ${fg(THEME.success, dim("(reviewed)"))}`
          : "";

        const statusColor = file.status === "added" ? THEME.success
          : file.status === "deleted" ? THEME.error
          : THEME.ink;

        const nameColored = fg(statusColor, entry.label);
        const prefix = isSelected ? fg(THEME.accent, "\u276f") : " ";
        const line = `${prefix} ${statusIcon} ${nameColored}${reviewLabel}`;
        const trimmed = this.fixedWidth(line, innerW);
        rows.push(`${BOX.v}${trimmed}${BOX.v}`);
        visibleIdx++;
      }
    }

    while (rows.length < maxHeight - 1) {
      rows.push(`${BOX.v}${" ".repeat(innerW)}${BOX.v}`);
    }

    if (fileCount > 0) {
      if (this.state.fileTreeFocused) {
        rows.push(`${BOX.v} ${dim("\u2191\u2195 navigate")}  ${dim("[/] search")}${" ".repeat(Math.max(0, innerW - 22))}${BOX.v}`);
      } else {
        rows.push(`${BOX.v} ${dim("[Tab] focus")}${" ".repeat(Math.max(0, innerW - 12))}${BOX.v}`);
      }
    }

    rows.push(`${BOX.ibl}${BOX.h.repeat(innerW)}${BOX.ibr}`);

    while (rows.length < maxHeight) {
      rows.push(`${BOX.v}${" ".repeat(innerW)}${BOX.v}`);
    }

    return rows;
  }

  private buildDiffPanel(width: number, maxHeight: number): string[] {
    const rows: string[] = [];
    const innerW = width - 2;

    const file = this.getCurrentFile();
    if (!file) {
      for (let i = 0; i < maxHeight; i++) {
        rows.push(`${BOX.v}${" ".repeat(innerW)}${BOX.v}`);
      }
      return rows;
    }

    const fileName = file.filePath.split("/").pop() || file.filePath;
    const title = ` ${fileName} `;
    const titlePad = Math.max(0, innerW - measureWidth(title));
    rows.push(`${BOX.itl}${BOX.h}${fg(THEME.accent, title)}${BOX.h.repeat(titlePad)}${BOX.itr}`);

    const scroll = this.state.fileTreeFocused ? 0 : this.state.scrollOffset;
    const visibleRows = maxHeight - 2;

    let lineIdx = 0;
    let rendered = 0;

    for (const hunk of file.hunks) {
      if (rendered >= visibleRows) break;
      const hunkHeader = ` ${fg(THEME.muted, dim(hunk.header))}`;
      if (lineIdx >= scroll) {
        rows.push(`${BOX.v}${this.fixedWidth(hunkHeader, innerW)}${BOX.v}`);
        rendered++;
      }
      lineIdx++;

      if (rendered >= visibleRows) break;

      for (const dline of hunk.lines) {
        if (rendered >= visibleRows) break;
        if (lineIdx >= scroll) {
          const colored = this.renderDiffLine(dline, innerW);
          rows.push(`${BOX.v}${this.fixedWidth(colored, innerW)}${BOX.v}`);
          rendered++;
        }
        lineIdx++;
      }
    }

    while (rows.length < maxHeight - 1) {
      rows.push(`${BOX.v}${" ".repeat(innerW)}${BOX.v}`);
    }

    if (!this.state.fileTreeFocused && file.hunks.length > 0) {
      rows[rows.length - 1] = `${BOX.v} ${dim("\u2191\u2195 scroll")}${" ".repeat(Math.max(0, innerW - 10))}${BOX.v}`;
    }

    rows.push(`${BOX.ibl}${BOX.h.repeat(innerW)}${BOX.ibr}`);

    while (rows.length < maxHeight) {
      rows.push(`${BOX.v}${" ".repeat(innerW)}${BOX.v}`);
    }

    return rows;
  }

  private renderDiffLine(line: HunkLine, width: number): string {
    const oldNum = line.oldLineNum !== undefined ? `${line.oldLineNum}` : "";
    const newNum = line.newLineNum !== undefined ? `${line.newLineNum}` : "";
    const numStr = oldNum.padStart(4) + newNum.padStart(5);
    const numPart = dim(numStr === "     " ? "     " : numStr);

    let content: string;
    if (line.type === "add") {
      content = fg(THEME.success, `+${line.content}`);
    } else if (line.type === "del") {
      content = fg(THEME.error, `-${line.content}`);
    } else {
      content = line.content;
    }

    return `${numPart} ${content}`;
  }

  private fixedWidth(text: string, width: number): string {
    const plain = stripAnsi(text);
    const w = measureWidth(plain);
    if (w > width) {
      let vis = 0;
      let out = "";
      let inAnsi = false;
      for (const ch of text) {
        if (ch === "\x1b") { inAnsi = true; out += ch; continue; }
        if (inAnsi) { out += ch; if (/[a-zA-Z]/.test(ch)) inAnsi = false; continue; }
        const cw = measureWidth(ch);
        if (vis + cw > width - 1) break;
        out += ch;
        vis += cw;
      }
      return out;
    }
    return text + " ".repeat(width - w);
  }

  private renderFooter(width: number): string {
    const sep = ` ${dim("\u2502")} `;
    const left = `${fg(THEME.muted, "[Tab]")} switch focus`;
    const mid = `${fg(THEME.muted, "[r]")} mark reviewed`;
    const right = `${fg(THEME.muted, "[Esc]")} close`;

    const parts = [left, mid, right];
    const joined = parts.join(sep);
    const plain = stripAnsi(joined);
    const available = width - 4;
    const leftPad = Math.max(0, available - measureWidth(plain));

    const padStr = " ".repeat(leftPad);
    return `${BOX.v} ${padStr}${joined} ${BOX.v}`;
  }

  toggleVisibility(): void {
    this.state.visible = !this.state.visible;
  }
}
