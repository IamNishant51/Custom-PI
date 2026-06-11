export interface ThemeColors {
  name: string;
  label: string;
  type: "dark" | "light";
  canvas: string;
  surfaceSoft: string;
  surfaceCard: string;
  surfaceElevated: string;
  surfaceOverlay: string;
  ink: string;
  inkDeep: string;
  body: string;
  mute: string;
  textSecondary: string;
  accent: string;
  accent2: string;
  accent3: string;
  border: string;
  borderFocus: string;
  danger: string;
  warning: string;
  success: string;
  hairline: string;
  hairlineStrong: string;
}

const themes: Record<string, ThemeColors> = {
  dark: {
    name: "dark",
    label: "Dark Matter",
    type: "dark",
    canvas: "#0a0a0a",
    surfaceSoft: "#1a1c20",
    surfaceCard: "#191919",
    surfaceElevated: "#222222",
    surfaceOverlay: "#1e1e1e",
    ink: "#ffffff",
    inkDeep: "#ffffff",
    body: "#dadbdf",
    mute: "#7d8187",
    textSecondary: "#9ea2a8",
    accent: "#ff7a17",
    accent2: "#7c3aed",
    accent3: "#00d7ff",
    border: "#212327",
    borderFocus: "#ff7a17",
    danger: "#ff3b30",
    warning: "#ff9f0a",
    success: "#30d158",
    hairline: "#212327",
    hairlineStrong: "rgba(255, 255, 255, 0.25)",
  },
  light: {
    name: "light",
    label: "Light",
    type: "light",
    canvas: "#f5f5f7",
    surfaceSoft: "#ffffff",
    surfaceCard: "#ffffff",
    surfaceElevated: "#fafafa",
    surfaceOverlay: "#ffffff",
    ink: "#1d1d1f",
    inkDeep: "#000000",
    body: "#424245",
    mute: "#86868b",
    textSecondary: "#6e6e73",
    accent: "#ff7a17",
    accent2: "#7c3aed",
    accent3: "#007aff",
    border: "#d2d2d7",
    borderFocus: "#ff7a17",
    danger: "#ff3b30",
    warning: "#ff9f0a",
    success: "#34c759",
    hairline: "#d2d2d7",
    hairlineStrong: "rgba(0, 0, 0, 0.2)",
  },
  terminal: {
    name: "terminal",
    label: "Terminal",
    type: "dark",
    canvas: "#0c0c0c",
    surfaceSoft: "#141414",
    surfaceCard: "#111111",
    surfaceElevated: "#1a1a1a",
    surfaceOverlay: "#111111",
    ink: "#33ff33",
    inkDeep: "#00ff00",
    body: "#33cc33",
    mute: "#1a7a1a",
    textSecondary: "#269926",
    accent: "#00ff00",
    accent2: "#66ff66",
    accent3: "#99ff99",
    border: "#1a3a1a",
    borderFocus: "#00ff00",
    danger: "#ff3333",
    warning: "#ffcc00",
    success: "#00ff00",
    hairline: "#1a3a1a",
    hairlineStrong: "rgba(0, 255, 0, 0.2)",
  },
  cyberpunk: {
    name: "cyberpunk",
    label: "Cyberpunk",
    type: "dark",
    canvas: "#0a0a1a",
    surfaceSoft: "#12102a",
    surfaceCard: "#0f0d25",
    surfaceElevated: "#1a1735",
    surfaceOverlay: "#0f0d25",
    ink: "#ff00ff",
    inkDeep: "#ff00ff",
    body: "#c0a0e0",
    mute: "#604080",
    textSecondary: "#8060a0",
    accent: "#ff00ff",
    accent2: "#00ffff",
    accent3: "#ff6600",
    border: "#2a1a4a",
    borderFocus: "#ff00ff",
    danger: "#ff0044",
    warning: "#ffaa00",
    success: "#00ff88",
    hairline: "#2a1a4a",
    hairlineStrong: "rgba(255, 0, 255, 0.2)",
  },
  midnight: {
    name: "midnight",
    label: "Midnight",
    type: "dark",
    canvas: "#0d1117",
    surfaceSoft: "#161b22",
    surfaceCard: "#161b22",
    surfaceElevated: "#1c2128",
    surfaceOverlay: "#161b22",
    ink: "#e6edf3",
    inkDeep: "#ffffff",
    body: "#8b949e",
    mute: "#484f58",
    textSecondary: "#6e7681",
    accent: "#58a6ff",
    accent2: "#3fb950",
    accent3: "#d2a8ff",
    border: "#30363d",
    borderFocus: "#58a6ff",
    danger: "#f85149",
    warning: "#d29922",
    success: "#3fb950",
    hairline: "#30363d",
    hairlineStrong: "rgba(255, 255, 255, 0.15)",
  },
};

export function getTheme(name: string): ThemeColors {
  return themes[name] || themes.dark;
}

export function getAllThemes(): Record<string, ThemeColors> {
  return themes;
}

export function applyTheme(theme: ThemeColors): void {
  const root = document.documentElement;
  const vars: [string, string][] = [
    ["--canvas", theme.canvas],
    ["--surface-soft", theme.surfaceSoft],
    ["--surface-card", theme.surfaceCard],
    ["--surface-elevated", theme.surfaceElevated],
    ["--surface-overlay", theme.surfaceOverlay],
    ["--ink", theme.ink],
    ["--ink-deep", theme.inkDeep],
    ["--body", theme.body],
    ["--mute", theme.mute],
    ["--text-secondary", theme.textSecondary],
    ["--accent", theme.accent],
    ["--accent-sunset", theme.accent],
    ["--accent-dusk", theme.accent2],
    ["--accent-teal", theme.accent3],
    ["--border-focus", theme.borderFocus],
    ["--danger", theme.danger],
    ["--warning", theme.warning],
    ["--success", theme.success],
    ["--hairline", theme.hairline],
    ["--hairline-strong", theme.hairlineStrong],
  ];
  for (const [key, val] of vars) {
    root.style.setProperty(key, val);
  }
  root.setAttribute("data-theme", theme.name);
  root.classList.toggle("light", theme.type === "light");
  try {
    localStorage.setItem("custom-pi-theme", theme.name);
  } catch {}
  try {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.canvas);
  } catch {}
}
