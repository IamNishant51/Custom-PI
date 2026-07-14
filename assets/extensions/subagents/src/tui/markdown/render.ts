import { THEME } from "../theme/theme";
import { fg, fgBold, dim, bgFg } from "../theme/colorize";
import { measureWidth } from "../utils/measure-text";
import { parseInline, type StyledSegment } from "./inline";
import { parseBlocks, parseBlocksStreaming, type Block } from "./block";
import { highlightBlock, highlightAsync } from "./highlight";
import { BOX } from "../types";

export interface RenderOptions {
  width: number;
  streaming?: boolean;
}

export function render(text: string, options: RenderOptions): string[] {
  const blocks = options.streaming
    ? parseBlocksStreaming(text)
    : parseBlocks(text);
  return renderBlocks(blocks, options);
}

export function renderBlocks(blocks: Block[], options: RenderOptions): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    const rendered = renderBlock(block, options);
    for (const line of rendered) {
      lines.push(line);
    }
  }
  return lines;
}

function renderBlock(block: Block, options: RenderOptions): string[] {
  switch (block.type) {
    case "paragraph": return renderParagraph(block.text, options.width);
    case "heading": return renderHeading(block.text, block.level, options.width);
    case "list": return renderList(block.items, options.width);
    case "blockquote": return renderBlockquote(block.text, options.width);
    case "code": return renderCode(block.code, block.lang, block.lines, options.width);
    case "table": return renderTable(block.rows, options.width);
    case "hr": return [dim("\u2500".repeat(options.width))];
  }
}

function renderParagraph(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const styled = renderInline(line, width);
    if (styled) lines.push(styled);
  }
  return lines;
}

function renderHeading(text: string, level: number, width: number): string[] {
  const styled = renderInline(text, width);
  const ruler = dim("\u2500".repeat(width));
  if (level === 1) {
    return [ruler, fgBold(THEME.accent, styled || ""), ruler];
  }
  if (level === 2) {
    return [fgBold(THEME.accent, styled || ""), ruler];
  }
  return [fgBold(THEME.ink, styled || "")];
}

function renderList(items: Array<{ text: string; ordered: boolean; orderNum?: number }>, width: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const marker = item.ordered ? `${item.orderNum || i + 1}.` : "\u25cf";
    const prefix = `  ${marker} `;
    const indentWidth = measureWidth(prefix);
    const contentWidth = Math.max(1, width - indentWidth);
    const styled = renderInline(item.text, contentWidth);
    lines.push(fg(THEME.muted, prefix) + (styled || ""));
  }
  return lines;
}

function renderBlockquote(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const styled = renderInline(line, Math.max(1, width - 4));
    lines.push(fg(THEME.hairline, "\u2502 ") + (styled || ""));
  }
  return lines;
}

function renderCode(code: string, lang: string, lines: string[], width: number): string[] {
  const result: string[] = [];
  const innerWidth = Math.max(1, width - 4);

  const topBorder = fg(THEME.hairline, `${BOX.tl}${BOX.h.repeat(innerWidth + 2)}${BOX.tr}`);
  const bottomBorder = fg(THEME.hairline, `${BOX.bl}${BOX.h.repeat(innerWidth + 2)}${BOX.br}`);
  result.push(topBorder);

  const cached = highlightBlock(code, lang);
  if (cached && cached !== code) {
    for (const line of cached.split("\n")) {
      result.push(`  ${line}`);
    }
  } else {
    for (const line of lines) {
      const trimmed = line.length > innerWidth ? line.slice(0, innerWidth) : line;
      result.push(`  ${dim(trimmed)}`);
    }
  }

  result.push(bottomBorder);
  return result;
}

function renderTable(rows: string[][], width: number): string[] {
  if (rows.length === 0) return [];
  const colCount = Math.max(...rows.map(r => r.length));
  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    colWidths[c] = Math.max(...rows.map(r => measureWidth(r[c] || "")));
  }
  const totalWidth = colWidths.reduce((s, w) => s + w + 3, 1);
  if (totalWidth > width - 4) {
    const ratio = (width - 4) / totalWidth;
    for (let c = 0; c < colCount; c++) {
      colWidths[c] = Math.max(3, Math.floor(colWidths[c] * ratio));
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map((cell, c) => {
      const w = colWidths[c] || 10;
      const padded = cell.padEnd(w);
      if (r === 0) return fgBold(THEME.ink, padded);
      return fg(THEME.ink, padded);
    });
    lines.push(fg(THEME.hairline, "\u2502 ") + cells.join(fg(THEME.hairline, " \u2502 ")) + fg(THEME.hairline, " \u2502"));
  }
  return lines;
}

function renderInline(text: string, width: number): string {
  if (!text) return "";
  const segments = parseInline(text);
  let result = "";
  for (const seg of segments) {
    const truncated = seg.text.length > width ? seg.text.slice(0, Math.max(1, width - 3)) + "..." : seg.text;
    if (seg.code) {
      result += bgFg(THEME.surfaceElevated, THEME.ink, truncated);
    } else if (seg.link) {
      result += `\x1b[4m${fg(THEME.link, truncated)}\x1b[0m${dim(` (${seg.link})`)}`;
    } else if (seg.bold && seg.italic) {
      result += fgBold(THEME.ink, `\x1b[3m${truncated}\x1b[0m`);
    } else if (seg.bold) {
      result += fgBold(THEME.ink, truncated);
    } else if (seg.italic) {
      result += `\x1b[3m${fg(THEME.ink, truncated)}\x1b[0m`;
    } else {
      result += fg(THEME.ink, truncated);
    }
  }
  return result;
}
