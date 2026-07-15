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
  surfaceElevated: string;
  surfaceOverlay: string;
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
  borderFocus: string;
  borderActive: string;
  textSecondary: string;
  textTertiary: string;
  scrollbar: string;
  scrollbarThumb: string;
  link: string;
  gradientStart: string;
  gradientEnd: string;
}

// ── Spacing & Layout Constants ──────────────────────────────────────────

export const SPACING = {
  gutter: 2,
  gutterLg: 4,
  padding: 2,
  paddingSm: 1,
  bubblePadding: 2,
  cardPadding: 2,
  inputPadding: 2,
  minScreenCols: 60,
  minScreenRows: 16,
  maxBubbleWidth: 100,
  maxCardWidth: 120,
  statusBarHeight: 1,
  inputAreaLines: 3,
  headerHeight: 1,
  scrollIndicatorHeight: 1,
} as const;

export type ResponsiveBreakpoint = "compact" | "normal" | "wide";

export function getResponsiveBreakpoint(cols: number): ResponsiveBreakpoint {
  if (cols < 80) return "compact";
  if (cols < 120) return "normal";
  return "wide";
}

export interface LayoutConfig {
  showBanner: boolean;
  bannerCompact: boolean;
  showConversationHeader: boolean;
  showScrollIndicator: boolean;
  showStatusBar: boolean;
  statusBarCompact: boolean;
  agentCardCompact: boolean;
  agentCardMaxOutputLines: number;
  messageSeparation: number;
  messagePaddingTop: number;
  messagePaddingBottom: number;
  containerPaddingLeft: number;
  containerPaddingRight: number;
  inputAreaHeight: number;
  inputAreaCompact: boolean;
}

export const LAYOUT_PRESETS: Record<string, LayoutConfig> = {
  default: {
    showBanner: true, bannerCompact: false,
    showConversationHeader: true, showScrollIndicator: true,
    showStatusBar: true, statusBarCompact: false,
    agentCardCompact: false, agentCardMaxOutputLines: 3,
    messageSeparation: 1, messagePaddingTop: 1, messagePaddingBottom: 1,
    containerPaddingLeft: 2, containerPaddingRight: 2,
    inputAreaHeight: 3, inputAreaCompact: false,
  },
  dense: {
    showBanner: true, bannerCompact: true,
    showConversationHeader: false, showScrollIndicator: true,
    showStatusBar: true, statusBarCompact: true,
    agentCardCompact: true, agentCardMaxOutputLines: 1,
    messageSeparation: 0, messagePaddingTop: 0, messagePaddingBottom: 0,
    containerPaddingLeft: 1, containerPaddingRight: 1,
    inputAreaHeight: 2, inputAreaCompact: true,
  },
  minimal: {
    showBanner: false, bannerCompact: false,
    showConversationHeader: false, showScrollIndicator: false,
    showStatusBar: true, statusBarCompact: true,
    agentCardCompact: true, agentCardMaxOutputLines: 1,
    messageSeparation: 0, messagePaddingTop: 0, messagePaddingBottom: 0,
    containerPaddingLeft: 1, containerPaddingRight: 1,
    inputAreaHeight: 2, inputAreaCompact: true,
  },
};

export interface LayoutRegion {
  name: string;
  startY: number;
  endY: number;
  startX: number;
  endX: number;
  zIndex: number;
}

export interface ConversationHeader {
  modelName: string;
  sessionId: string;
  contextPercent: number;
  messageCount: number;
}

export interface ScrollIndicator {
  visible: boolean;
  olderCount: number;
  newerCount: number;
}

// ── Surface Depth ───────────────────────────────────────────────────────

export type SurfaceLevel = "canvas" | "surface" | "elevated" | "overlay" | "popup";

export interface SurfaceColors {
  canvas: string;
  surface: string;
  elevated: string;
  overlay: string;
  popup: string;
}

// ── Existing Types ──────────────────────────────────────────────────────

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

export { THEME } from "./theme/theme";

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

export interface PulseConfig {
  symbol: string;
  restColor: string;
  gradientColors: string[];
  sweepMs: number;
  breatheMs: number;
  breatheAmplitude: number;
  easing: boolean;
}

export interface TruecolorStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

import { hexToRgb } from "./utils/color";

export function hexToAnsi(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
}

export function hexToTruecolor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export function bgHexToTruecolor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
}
