import { stripAnsi, measureWidth } from "./format";

export const BOX = {
  tl: "╔", tr: "╗", bl: "╚", br: "╝",
  h: "═", v: "║",
  ltee: "╠", rtee: "╣",
  itl: "┌", itr: "┐", ibl: "└", ibr: "┘",
};

export function boxTop(title: string, width: number, colorFn: (s: string) => string, accentFn: (s: string) => string): string {
  const titleText = ` ${title} `;
  const titleLen = measureWidth(stripAnsi(titleText));
  const lineLen = Math.max(0, width - 2 - titleLen - 1);
  const leftPad = 3;
  const rightPad = Math.max(0, lineLen - leftPad);
  return colorFn(BOX.tl + BOX.h.repeat(leftPad)) + accentFn(titleText) + colorFn(BOX.h.repeat(rightPad) + BOX.tr);
}

export function boxBottom(width: number, colorFn: (s: string) => string): string {
  return colorFn(BOX.bl + BOX.h.repeat(Math.max(0, width - 2)) + BOX.br);
}

export function boxLine(content: string, width: number, colorFn: (s: string) => string): string {
  const contentLen = measureWidth(stripAnsi(content));
  const padding = Math.max(0, width - 4 - contentLen);
  return colorFn(BOX.v) + "  " + content + " ".repeat(padding) + " " + colorFn(BOX.v);
}

export function boxDivider(width: number, colorFn: (s: string) => string): string {
  return colorFn(BOX.ltee + BOX.h.repeat(Math.max(0, width - 2)) + BOX.rtee);
}

export function boxEmpty(width: number, colorFn: (s: string) => string): string {
  return colorFn(BOX.v) + " ".repeat(Math.max(0, width - 2)) + colorFn(BOX.v);
}

export function innerBoxTop(title: string, width: number, colorFn: (s: string) => string, accentFn: (s: string) => string): string {
  const titleText = ` ${title} `;
  const titleLen = measureWidth(stripAnsi(titleText));
  const remaining = Math.max(0, width - 2 - titleLen);
  return colorFn(BOX.itl + BOX.h) + accentFn(titleText) + colorFn(BOX.h.repeat(remaining) + BOX.itr);
}

export function innerBoxBottom(width: number, colorFn: (s: string) => string): string {
  return colorFn(BOX.ibl + BOX.h.repeat(Math.max(0, width - 2)) + BOX.ibr);
}

export function innerBoxLine(content: string, width: number, colorFn: (s: string) => string): string {
  const contentLen = measureWidth(stripAnsi(content));
  const pad = Math.max(0, width - 3 - contentLen);
  return colorFn(BOX.v) + " " + content + " ".repeat(pad) + colorFn(BOX.v);
}
