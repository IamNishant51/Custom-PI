export type LineType =
  | "paragraph" | "heading" | "list-item" | "blockquote"
  | "fence" | "table-row" | "hr" | "empty";

export interface LineToken {
  type: LineType;
  text: string;
  level?: number;
  ordered?: boolean;
  orderNum?: number;
  lang?: string;
  indent?: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^(\s*[-*_]\s*){3,}$/;
const UNORDERED_LIST_RE = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED_LIST_RE = /^(\s*)(\d+)\.\s+(.*)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^(```+|~~~+)\s*(\w*)\s*$/;
const TABLE_RE = /^\|.+\|$/;
const EMPTY_RE = /^\s*$/;

export function tokenizeLine(line: string): LineToken {
  if (EMPTY_RE.test(line)) return { type: "empty", text: "" };

  const hMatch = line.match(HEADING_RE);
  if (hMatch) return { type: "heading", text: hMatch[2], level: hMatch[1].length };

  if (HR_RE.test(line)) return { type: "hr", text: "" };

  const uMatch = line.match(UNORDERED_LIST_RE);
  if (uMatch) return { type: "list-item", text: uMatch[3], ordered: false, indent: Math.floor(uMatch[1].length / 2) };

  const oMatch = line.match(ORDERED_LIST_RE);
  if (oMatch) return { type: "list-item", text: oMatch[3], ordered: true, orderNum: parseInt(oMatch[2], 10), indent: Math.floor(oMatch[1].length / 2) };

  const bqMatch = line.match(BLOCKQUOTE_RE);
  if (bqMatch) return { type: "blockquote", text: bqMatch[1] };

  const fMatch = line.match(FENCE_RE);
  if (fMatch) return { type: "fence", text: "", level: fMatch[1].length, lang: fMatch[2] || undefined };

  if (TABLE_RE.test(line)) return { type: "table-row", text: line };

  return { type: "paragraph", text: line };
}

export function tokenize(text: string): LineToken[] {
  return text.split("\n").map(tokenizeLine);
}
