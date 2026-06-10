import { stripAnsi, wordWrap } from "./format";
import { BOX } from "./box";

const MARKDOWN_TABLE_RE = /^\|.+\|$/;

export function parseMarkdownTable(lines: string[]): { rows: string[][]; headerLen: number } | null {
  if (lines.length < 2) return null;
  const dataStartIdx = lines[1].trim().startsWith("|") && lines[1].includes("-") ? 1 : -1;
  const headerIdx = dataStartIdx === 1 ? 0 : -1;
  if (headerIdx < 0) return null;
  const numCols = lines[headerIdx].split("|").length - 2;
  if (numCols < 1) return null;
  const rows: string[][] = [];
  for (let r = headerIdx; r < lines.length; r++) {
    const parts = lines[r].split("|");
    if (parts.length < numCols + 2) continue;
    const row: string[] = [];
    for (let c = 0; c < numCols; c++) {
      row.push((parts[c + 1] || "").trim());
    }
    if (r !== 1 || headerIdx !== 0) rows.push(row);
  }
  return { rows, headerLen: numCols };
}

export function renderTableGrid(rows: string[][], boxWidth: number, colorFn: (s: string) => string): string[] {
  if (!rows.length) return [];
  const numCols = rows[0].length;
  const colWidths: number[] = new Array(numCols).fill(0);
  for (const row of rows) {
    for (let c = 0; c < numCols; c++) {
      colWidths[c] = Math.max(colWidths[c], stripAnsi(row[c] || "").length);
    }
  }
  const innerW = boxWidth - 6;
  const totalContent = colWidths.reduce((s, w) => s + w, 0);
  const sepCount = numCols - 1;
  if (totalContent + sepCount < innerW) {
    const extra = Math.floor((innerW - totalContent - sepCount) / numCols);
    for (let c = 0; c < numCols; c++) colWidths[c] += extra;
    let remainder = innerW - totalContent - sepCount - extra * numCols;
    for (let c = 0; remainder > 0 && c < numCols; c++, remainder--) colWidths[c]++;
  }

  const out: string[] = [];
  const sep = colorFn(BOX.v);
  const renderRow = (cells: string[]) => {
    const parts: string[] = [];
    for (let c = 0; c < numCols; c++) {
      const cell = cells[c] || "";
      const cellLen = stripAnsi(cell).length;
      parts.push(cell + " ".repeat(Math.max(0, colWidths[c] - cellLen)));
    }
    return `${sep}  ${parts.join(` ${sep} `)}  ${sep}`;
  };
  const renderSep = () => {
    const segs: string[] = [];
    for (let c = 0; c < numCols; c++) {
      segs.push(BOX.h.repeat(colWidths[c]));
    }
    return colorFn(BOX.ltee + BOX.h) + segs.join(colorFn(BOX.h + BOX.ltee + BOX.h)) + colorFn(BOX.h + BOX.rtee);
  };
  const isSepRow = (row: string[]) => row.every(c => /^[-: ]+$/.test(c));

  for (let r = 0; r < rows.length; r++) {
    if (isSepRow(rows[r])) {
      out.push(renderSep());
    } else {
      out.push(renderRow(rows[r]));
    }
  }
  return out;
}

export function formatBoxContent(text: string, boxWidth: number, colorFn: (s: string) => string, contentColor: (s: string) => string): string[] {
  const lines: string[] = [];
  const rawLines = text.split("\n");

  let i = 0;
  while (i < rawLines.length) {
    if (MARKDOWN_TABLE_RE.test(rawLines[i])) {
      const tableLines: string[] = [];
      while (i < rawLines.length && MARKDOWN_TABLE_RE.test(rawLines[i])) {
        tableLines.push(rawLines[i]);
        i++;
      }
      const parsed = parseMarkdownTable(tableLines);
      if (parsed) {
        const grid = renderTableGrid(parsed.rows, boxWidth, colorFn);
        for (const row of grid) {
          const contentLen = stripAnsi(row).length;
          const padding = Math.max(0, boxWidth - 4 - contentLen);
          lines.push(colorFn(BOX.v) + "  " + row.slice(2, -2).trimEnd() + " ".repeat(padding) + " " + colorFn(BOX.v));
        }
      } else {
        for (const tl of tableLines) {
          const wrapped = wordWrap(tl, boxWidth - 6);
          for (const wl of wrapped) {
            lines.push(colorFn(BOX.v) + "  " + contentColor(wl) + " ".repeat(Math.max(0, boxWidth - 4 - stripAnsi(wl).length)) + " " + colorFn(BOX.v));
          }
        }
      }
    } else {
      const wrapped = wordWrap(rawLines[i], boxWidth - 6);
      for (const wl of wrapped) {
        lines.push(colorFn(BOX.v) + "  " + contentColor(wl) + " ".repeat(Math.max(0, boxWidth - 4 - stripAnsi(wl).length)) + " " + colorFn(BOX.v));
      }
      i++;
    }
  }
  return lines;
}

export { MARKDOWN_TABLE_RE };
