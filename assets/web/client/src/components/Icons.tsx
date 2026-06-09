import {
  MessageSquare, LayoutDashboard, KeyRound, BarChart3,
  Brain, FileText, Users, Puzzle, Settings, Menu,
  Play, Check, X, Plus, Trash2,
  Eye, RefreshCw, Share2, GitBranch, Activity,
} from "lucide-react";

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const BANNER = [
  "  \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u256c\u2551   \u256c\u2551 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2551   \u2588\u2588\u2588\u2551      \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u256c\u2551",
  " \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d \u256c\u2551   \u256c\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u256c\u2555\u2550\u2550\u255d\u2588\u2588\u2555\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551      \u2588\u2588\u2555\u2550\u2550\u2588\u2588\u2557\u256c\u2551",
  " \u256c\u2551      \u256c\u2551   \u256c\u2551\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557    \u256c\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u256c\u2551",
  " \u256c\u2551      \u256c\u2551   \u256c\u2551 \u255a\u2550\u2550\u2550\u2550\u2588\u2588\u2551    \u256c\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2551\u255a\u2550\u2550\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2555\u2550\u2550\u2550\u255d \u256c\u2551",
  " \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d    \u256c\u2551   \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2551 \u255a\u2550\u2550 \u256c\u2551      \u2588\u2588\u2551     \u256c\u2551",
  "  \u255a\u2550\u2550\u2550\u2550\u2550\u255d  \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d     \u255a\u2550\u255d    \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u255d     \u255a\u2550\u255d     \u255a\u2550\u255d",
];

const BANNER_COLORS = [
  "#ff0087",
  "#ff00ff",
  "#af5fff",
  "#5f00ff",
  "#00ffff",
  "#00d7ff",
];

export function AsciiBanner() {
  return (
    <pre style={{
      fontFamily: "monospace",
      fontSize: 7,
      lineHeight: 1.1,
      margin: 0,
      padding: "4px 0",
      textAlign: "center",
      whiteSpace: "pre",
      overflow: "hidden",
    }}>
      {BANNER.map((line, i) => (
        <span key={i} style={{ display: "block", color: BANNER_COLORS[i] }}>{line}</span>
      ))}
    </pre>
  );
}

export function AsciiChat(props?: IconProps) { return <MessageSquare size={14} {...props} />; }
export function AsciiDashboard(props?: IconProps) { return <LayoutDashboard size={14} {...props} />; }
export function AsciiVault(props?: IconProps) { return <KeyRound size={14} {...props} />; }
export function AsciiBudget(props?: IconProps) { return <BarChart3 size={14} {...props} />; }
export function AsciiMemory(props?: IconProps) { return <Brain size={14} {...props} />; }
export function AsciiWorkProducts(props?: IconProps) { return <FileText size={14} {...props} />; }
export function AsciiAgents(props?: IconProps) { return <Users size={14} {...props} />; }
export function AsciiMCP(props?: IconProps) { return <Puzzle size={14} {...props} />; }
export function AsciiSettings(props?: IconProps) { return <Settings size={14} {...props} />; }
export function AsciiTeams(props?: IconProps) { return <Users size={14} {...props} />; }
export function AsciiUsers(props?: IconProps) { return <Users size={14} {...props} />; }
export function AsciiGraph(props?: IconProps) { return <Share2 size={14} {...props} />; }
export function AsciiEye(props?: IconProps) { return <Eye size={14} {...props} />; }
export function AsciiTrash(props?: IconProps) { return <Trash2 size={14} {...props} />; }
export function AsciiRefresh(props?: IconProps) { return <RefreshCw size={14} {...props} />; }
export function AsciiMenu(props?: IconProps) { return <Menu size={14} {...props} />; }
export function AsciiPlus(props?: IconProps) { return <Plus size={14} {...props} />; }
export function AsciiCheck(props?: IconProps) { return <Check size={14} {...props} />; }
export function AsciiX(props?: IconProps) { return <X size={14} {...props} />; }
export function AsciiPlay(props?: IconProps) { return <Play size={14} {...props} />; }
export function AsciiGitBranch(props?: IconProps) { return <GitBranch size={14} {...props} />; }
export function AsciiActivity(props?: IconProps) { return <Activity size={14} {...props} />; }
