export type StyleFlags = {
  fg?: number;
  bg?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
};

export interface Cell {
  char: number;
  style: number;
  width: number;
  dirty: boolean;
}

export interface ThemeColors {
  banner: string[];
  accent: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  canvas: string;
  surface: string;
  card: string;
  hairline: string;
  ink: string;
  muted: string;
  dim: string;
  userBubble: string;
  assistantBubble: string;
  userBubbleBorder: string;
  assistantBubbleBorder: string;
  agentRunning: string;
  agentSuccess: string;
  agentError: string;
  agentWaiting: string;
}

export type AgentState = "pending" | "running" | "success" | "error" | "warning" | "spawning" | "calling_tool" | "complete";

export type VimMode = "normal" | "insert" | "visual";

export interface VimState {
  mode: VimMode;
  pendingKeys: string[];
  lastMotion: string;
  register: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  toolCalls?: number;
  duration?: number;
  collapsed?: boolean;
  agentName?: string;
}

export interface SpinnerConfig {
  frames: string[];
  interval: number;
}

export const THEME: ThemeColors = {
  banner: ["#ff0087", "#ff00ff", "#af5fff", "#5f00ff", "#00ffff", "#00d7ff"],
  accent: "#ff7a17",
  success: "#30d158",
  warning: "#ff9f0a",
  error: "#ff3b30",
  info: "#5ac8fa",
  canvas: "#0a0a0a",
  surface: "#1a1c20",
  card: "#191919",
  hairline: "#212327",
  ink: "#ffffff",
  muted: "#7d8187",
  dim: "#4e5257",
  userBubble: "#1a1c20",
  assistantBubble: "#191919",
  userBubbleBorder: "#212327",
  assistantBubbleBorder: "#2c2f34",
  agentRunning: "#ff7a17",
  agentSuccess: "#30d158",
  agentError: "#ff3b30",
  agentWaiting: "#7d8187",
};

export const SPINNERS = {
  dots: { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], interval: 80 },
  pulse: { frames: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"], interval: 100 },
  bounce: { frames: ["█", "▇", "▆", "▅", "▄", "▃", "▂", "▁"], interval: 60 },
  breathe: { frames: ["◐", "◓", "◑", "◒"], interval: 200 },
  arc: { frames: ["◜", "◝", "◞", "◟"], interval: 100 },
  star: { frames: ["✦", "✧", "⋆"], interval: 150 },
};

export const BOX = {
  tl: "╭", tr: "╮", bl: "╰", br: "╯",
  h: "─", v: "│",
  ltee: "├", rtee: "┤",
  itl: "┌", itr: "┐", ibl: "└", ibr: "┘",
};

export function hexToAnsi(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
}
