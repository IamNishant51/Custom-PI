export type ColorMode = "truecolor" | "256" | "16" | "monochrome";

let _mode: ColorMode = "truecolor";
let _resolved = false;

function detectColorMode(): ColorMode {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return "monochrome";
  }
  const term = process.env.TERM || "";
  const colorterm = process.env.COLORTERM || "";
  if (
    colorterm === "truecolor" ||
    colorterm === "24bit" ||
    term.includes("truecolor") ||
    term.includes("24bit")
  ) {
    return "truecolor";
  }
  if (term.includes("256") || term.includes("xterm") || term.includes("screen")) {
    return "256";
  }
  return "16";
}

export function getColorMode(): ColorMode {
  if (!_resolved) {
    _mode = detectColorMode();
    _resolved = true;
  }
  return _mode;
}

export function resetColorMode(): void {
  _resolved = false;
}

export function useTruecolor(): boolean {
  return getColorMode() === "truecolor";
}

export function isMonochrome(): boolean {
  return getColorMode() === "monochrome";
}
