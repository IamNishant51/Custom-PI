import { tokenize, type LineToken } from "./tokenizer";

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string; level: number }
  | { type: "list"; items: Array<{ text: string; ordered: boolean; orderNum?: number }> }
  | { type: "blockquote"; text: string }
  | { type: "code"; code: string; lang: string; lines: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "hr" };

export function parseBlocks(text: string): Block[] {
  const tokens = tokenize(text);
  return groupBlocks(tokens, false);
}

export function parseBlocksStreaming(text: string): Block[] {
  const tokens = tokenize(text);
  return groupBlocks(tokens, true);
}

function groupBlocks(tokens: LineToken[], streaming: boolean): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < tokens.length) {
    const t = tokens[i];

    if (t.type === "empty") {
      i++;
      continue;
    }

    if (t.type === "hr") {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (t.type === "heading") {
      blocks.push({ type: "heading", text: t.text, level: t.level || 1 });
      i++;
      continue;
    }

    if (t.type === "blockquote") {
      const lines: string[] = [];
      while (i < tokens.length && (tokens[i].type === "blockquote" || tokens[i].type === "empty")) {
        if (tokens[i].type !== "empty") lines.push(tokens[i].text);
        i++;
      }
      blocks.push({ type: "blockquote", text: lines.join("\n") });
      continue;
    }

    if (t.type === "list-item") {
      const items: Array<{ text: string; ordered: boolean; orderNum?: number }> = [];
      while (i < tokens.length && tokens[i].type === "list-item") {
        items.push({ text: tokens[i].text, ordered: tokens[i].ordered || false, orderNum: tokens[i].orderNum });
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    if (t.type === "fence") {
      if (t.lang && t.lang.length > 0) {
        const lang = t.lang;
        i++;
        const codeLines: string[] = [];
        while (i < tokens.length) {
          if (tokens[i].type === "fence" && !tokens[i].lang) {
            if (tokens[i].level === t.level) break;
          }
          if (tokens[i].type === "fence" && tokens[i].lang && !streaming) break;
          codeLines.push(tokens[i].text);
          i++;
        }
        blocks.push({ type: "code", code: codeLines.join("\n"), lang, lines: codeLines });
        if (i < tokens.length && tokens[i].type === "fence") i++;
        continue;
      }
      if (streaming) {
        i++;
        const codeLines: string[] = [];
        while (i < tokens.length && tokens[i].type !== "empty") {
          if (tokens[i].type === "fence" && !tokens[i].lang) break;
          codeLines.push(tokens[i].text);
          i++;
        }
        blocks.push({ type: "code", code: codeLines.join("\n"), lang: "", lines: codeLines });
        if (i < tokens.length && tokens[i].type === "fence") i++;
        continue;
      }
      i++;
      continue;
    }

    if (t.type === "table-row") {
      const rows: string[][] = [];
      while (i < tokens.length && tokens[i].type === "table-row") {
        const cells = tokens[i].text.split("|").filter((_, j, a) => j > 0 && j < a.length - 1).map(s => s.trim());
        rows.push(cells);
        i++;
      }
      if (rows.length > 0) blocks.push({ type: "table", rows });
      continue;
    }

    if (t.type === "paragraph") {
      const lines: string[] = [t.text];
      i++;
      while (i < tokens.length && (tokens[i].type === "paragraph" || tokens[i].type === "empty")) {
        if (tokens[i].type === "paragraph") lines.push(tokens[i].text);
        if (tokens[i].type === "empty" && streaming) break;
        if (tokens[i].type === "empty" && i + 1 < tokens.length && tokens[i + 1].type !== "paragraph") break;
        i++;
      }
      blocks.push({ type: "paragraph", text: lines.join("\n") });
      continue;
    }

    i++;
  }

  return blocks;
}
