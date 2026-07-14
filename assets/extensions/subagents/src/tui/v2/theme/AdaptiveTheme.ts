/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */

export interface SemanticTokens {
  canvas: string;
  surface: string;
  elevated: string;
  overlay: string;
  popup: string;

  ink: string;
  inkSecondary: string;
  inkTertiary: string;
  inkInverse: string;

  accent: string;
  accentHover: string;
  success: string;
  warning: string;
  error: string;
  info: string;

  hairline: string;
  border: string;
  borderFocus: string;
  borderActive: string;

  codeBg: string;
  codeText: string;
  codeComment: string;
  codeKeyword: string;
  codeString: string;
  codeNumber: string;
  codeFunction: string;

  agentRunning: string;
  agentSuccess: string;
  agentError: string;
  agentWaiting: string;

  scrollbarTrack: string;
  scrollbarThumb: string;
}

const DARK_TOKENS: SemanticTokens = {
  canvas: "#0d0d0d",
  surface: "#1a1c20",
  elevated: "#222222",
  overlay: "#1e1e1e",
  popup: "#191919",

  ink: "#ffffff",
  inkSecondary: "#9ea2a8",
  inkTertiary: "#6a6e74",
  inkInverse: "#0d0d0d",

  accent: "#ff7a17",
  accentHover: "#e66a00",
  success: "#30d158",
  warning: "#ff9f0a",
  error: "#ff3b30",
  info: "#5ac8fa",

  hairline: "#212327",
  border: "#2c2f34",
  borderFocus: "#ff7a17",
  borderActive: "#5ac8fa",

  codeBg: "#1e1e1e",
  codeText: "#d4d4d4",
  codeComment: "#6a9955",
  codeKeyword: "#c586c0",
  codeString: "#ce9178",
  codeNumber: "#b5cea8",
  codeFunction: "#dcdcaa",

  agentRunning: "#ff7a17",
  agentSuccess: "#30d158",
  agentError: "#ff3b30",
  agentWaiting: "#7d8187",

  scrollbarTrack: "#1a1c20",
  scrollbarThumb: "#3a3c40",
};

const LIGHT_TOKENS: SemanticTokens = {
  canvas: "#ffffff",
  surface: "#f8f9fa",
  elevated: "#ffffff",
  overlay: "#ffffff",
  popup: "#ffffff",

  ink: "#1a1a2e",
  inkSecondary: "#4a4a6a",
  inkTertiary: "#8a8a9a",
  inkInverse: "#ffffff",

  accent: "#d9441c",
  accentHover: "#b83a18",
  success: "#1e7d32",
  warning: "#e65100",
  error: "#c62828",
  info: "#0277bd",

  hairline: "#e0e0e0",
  border: "#d0d0d0",
  borderFocus: "#d9441c",
  borderActive: "#0277bd",

  codeBg: "#f5f5f5",
  codeText: "#2d2d2d",
  codeComment: "#6a9955",
  codeKeyword: "#c586c0",
  codeString: "#ce9178",
  codeNumber: "#b5cea8",
  codeFunction: "#dcdcaa",

  agentRunning: "#d9441c",
  agentSuccess: "#1e7d32",
  agentError: "#c62828",
  agentWaiting: "#8a8a9a",

  scrollbarTrack: "#f0f0f0",
  scrollbarThumb: "#d0d0d0",
};

export interface AdaptiveThemeOptions {
  mode: "auto" | "light" | "dark";
  truecolor: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
}

export interface AdaptiveTheme {
  mode: "auto" | "light" | "dark";
  truecolor: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  tokens: SemanticTokens;
  background: "light" | "dark";
  
  // Elevation system
  elevation: {
    canvas: { bg: string; border: string; borderWidth: number };
    surface: { bg: string; border: string; borderWidth: number };
    elevated: { bg: string; border: string; borderWidth: number };
    overlay: { bg: string; border: string; borderWidth: number; shadow: boolean };
    popup: { bg: string; border: string; borderWidth: number; shadow: boolean };
  };

  // Methods
  getToken(key: keyof SemanticTokens): string;
  getElevation(level: "canvas" | "surface" | "elevated" | "overlay" | "popup"): {
    bg: string;
    border: string;
    borderWidth: number;
    shadow?: boolean;
  };
  setMode(mode: "auto" | "light" | "dark"): void;
  setReducedMotion(enabled: boolean): void;
  setHighContrast(enabled: boolean): void;
}

function lerpColor(c1: string, c2: string, t: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${clamp(r1 + (r2 - r1) * t).toString(16).padStart(2, "0")}${clamp(g1 + (g2 - g1) * t).toString(16).padStart(2, "0")}${clamp(b1 + (b2 - b1) * t).toString(16).padStart(2, "0")}`;
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const a = [r, g, b].map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function adjustForContrast(tokens: SemanticTokens, background: string, targetRatio = 4.5): SemanticTokens {
  const bgLum = luminance(background);
  const adjusted: Partial<SemanticTokens> = {};
  
  for (const [key, value] of Object.entries(tokens)) {
    const tokenKey = key as keyof SemanticTokens;
    const lum = luminance(tokens[tokenKey]);
    if (contrastRatio(bgLum, lum) < targetRatio) {
      // Adjust by lightening or darkening
      const r = parseInt(tokens[tokenKey].slice(1, 3), 16);
      const g = parseInt(tokens[tokenKey].slice(3, 5), 16);
      const b = parseInt(tokens[tokenKey].slice(5, 7), 16);
      
      if (bgLum > 0.5) {
        // Light background - darken text
        adjusted[tokenKey] = `#${Math.max(0, r - 40).toString(16).padStart(2, "0")}${Math.max(0, g - 40).toString(16).padStart(2, "0")}${Math.max(0, b - 40).toString(16).padStart(2, "0")}`;
      } else {
        // Dark background - lighten text
        adjusted[tokenKey] = `#${Math.min(255, r + 40).toString(16).padStart(2, "0")}${Math.min(255, g + 40).toString(16).padStart(2, "0")}${Math.min(255, b + 40).toString(16).padStart(2, "0")}`;
      }
    }
  }
  
  return { ...tokens, ...adjusted };
}

export class AdaptiveTheme implements AdaptiveTheme {
  mode: "auto" | "light" | "dark" = "auto";
  truecolor: boolean = false;
  reducedMotion: boolean = false;
  highContrast: boolean = false;
  tokens: SemanticTokens = DARK_TOKENS;
  background: "light" | "dark" = "dark";
  private baseTokens: SemanticTokens = DARK_TOKENS;

  constructor(options: Partial<AdaptiveThemeOptions> = {}) {
    this.mode = options.mode ?? "auto";
    this.truecolor = options.truecolor ?? false;
    this.reducedMotion = options.reducedMotion ?? false;
    this.highContrast = options.highContrast ?? false;
    this._detectBackground();
    this._rebuildTokens();
  }

  private _detectBackground(): void {
    if (this.mode === "light") {
      this.background = "light";
      this.baseTokens = LIGHT_TOKENS;
      return;
    }
    if (this.mode === "dark") {
      this.background = "dark";
      this.baseTokens = DARK_TOKENS;
      return;
    }

    // Auto-detect via OSC 11 query (async in real implementation)
    // For now, use heuristics
    const term = process.env.TERM || "";
    const colorterm = process.env.COLORTERM || "";
    
    if (term.includes("light") || colorterm === "truecolor" && !term.includes("dark")) {
      this.background = "light";
      this.baseTokens = LIGHT_TOKENS;
    } else {
      this.background = "dark";
      this.baseTokens = DARK_TOKENS;
    }
  }

  private _rebuildTokens(): void {
    const base = this.background === "dark" ? DARK_TOKENS : LIGHT_TOKENS;
    this.baseTokens = base;
    
    if (this.highContrast) {
      this.tokens = adjustForContrast(base, base.canvas, 7);
    } else {
      this.tokens = { ...base };
    }
  }

  getToken(key: keyof SemanticTokens): string {
    return this.tokens[key];
  }

  getElevation(level: "canvas" | "surface" | "elevated" | "overlay" | "popup"): {
    bg: string;
    border: string;
    borderWidth: number;
    shadow?: boolean;
  } {
    const bgKey = level === "canvas" ? "canvas" : level === "surface" ? "surface" : 
                  level === "elevated" ? "elevated" : level === "overlay" ? "overlay" : "popup";
    
    const borderMap = {
      canvas: "hairline",
      surface: "hairline",
      elevated: "border",
      overlay: "border",
      popup: "borderFocus",
    };

    return {
      bg: this.tokens[bgKey as keyof SemanticTokens],
      border: this.tokens[borderMap[level as keyof typeof borderMap] as keyof SemanticTokens],
      borderWidth: level === "canvas" ? 0 : 1,
      shadow: level === "overlay" || level === "popup",
    };
  }

  setMode(mode: "auto" | "light" | "dark"): void {
    this.mode = mode;
    this._detectBackground();
    this._rebuildTokens();
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  setHighContrast(enabled: boolean): void {
    this.highContrast = enabled;
    this._rebuildTokens();
  }

  setTruecolor(enabled: boolean): void {
    this.truecolor = enabled;
  }
}

export function createTheme(options?: Partial<AdaptiveThemeOptions>): AdaptiveTheme {
  return new AdaptiveTheme(options);
}

export const defaultTheme = new AdaptiveTheme({ mode: "auto", truecolor: false, reducedMotion: false, highContrast: false });