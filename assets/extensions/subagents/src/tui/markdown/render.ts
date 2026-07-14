import { THEME } from "../theme/theme";
import { fg, fgBold, dim, bgFg } from "../theme/colorize";
import { measureWidth } from "../utils/measure-text";
import { parseInline, type StyledSegment } from "./inline";
import { parseBlocks, parseBlocksStreaming, type Block } from "./block";
import { highlightBlock, highlightAsync } from "./highlight";
import { BOX } from "../types";
import { wordWrap, truncateToWidth, visibleWidth } from "../render/format";

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
    if (styled) {
      lines.push(...wordWrap(styled, width));
    }
  }
  return lines;
}

function renderHeading(text: string, level: number, width: number): string[] {
  const styled = renderInline(text, width);
  const wrapped = wordWrap(styled || "", width);
  const ruler = dim("\u2500".repeat(width));
  const result: string[] = [];
  if (level === 1) {
    result.push(ruler);
    result.push(...wrapped.map(l => fgBold(THEME.accent, l)));
    result.push(ruler);
  } else if (level === 2) {
    result.push(...wrapped.map(l => fgBold(THEME.accent, l)));
    result.push(ruler);
  } else {
    result.push(...wrapped.map(l => fgBold(THEME.ink, l)));
  }
  return result;
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
    const wrapped = wordWrap(styled || "", contentWidth);
    if (wrapped.length > 0) {
      lines.push(fg(THEME.muted, prefix) + wrapped[0]);
      const indent = " ".repeat(indentWidth);
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(indent + wrapped[j]);
      }
    }
  }
  return lines;
}

function renderBlockquote(text: string, width: number): string[] {
  const lines: string[] = [];
  const contentWidth = Math.max(1, width - 4);
  for (const line of text.split("\n")) {
    const styled = renderInline(line, contentWidth);
    const wrapped = wordWrap(styled || "", contentWidth);
    const leftBar = fg(THEME.hairline, "\u2502 ");
    lines.push(...wrapped.map(wl => leftBar + wl));
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
      const truncated = visibleWidth(line) > innerWidth ? truncateToWidth(line, innerWidth) : line;
      result.push(`  ${truncated}`);
    }
  } else {
    if (lang) {
      highlightAsync(code, lang);
    }
    for (const line of lines) {
      const truncated = visibleWidth(line) > innerWidth ? truncateToWidth(line, innerWidth) : line;
      result.push(`  ${dim(truncated)}`);
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
      const cleanCell = cell.length > w ? cell.slice(0, Math.max(1, w - 3)) + "..." : cell;
      const padded = cleanCell.padEnd(w);
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
