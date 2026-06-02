import {
  MessageSquare, LayoutDashboard, KeyRound, BarChart3,
  Brain, FileText, Users, Puzzle, Settings, Menu,
  Zap, ArrowRight, Send, Play, Check, X, Plus, Trash2,
  Eye, RefreshCw, Share2, GitBranch, Activity, type LucideIcon,
} from "lucide-react";

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function NavIcon({ icon: Icon, size = 14, className, style }: IconProps & { icon: LucideIcon }) {
  return <Icon size={size} className={className} style={style} />;
}

export function ChatIcon(props: IconProps) {
  return <MessageSquare size={14} {...props} />;
}

export function DashboardIcon(props: IconProps) {
  return <LayoutDashboard size={14} {...props} />;
}

export function VaultIcon(props: IconProps) {
  return <KeyRound size={14} {...props} />;
}

export function BudgetIcon(props: IconProps) {
  return <BarChart3 size={14} {...props} />;
}

export function MemoryIcon(props: IconProps) {
  return <Brain size={14} {...props} />;
}

export function WorkProductsIcon(props: IconProps) {
  return <FileText size={14} {...props} />;
}

export function AgentsIcon(props: IconProps) {
  return <Users size={14} {...props} />;
}

export function MCPIcon(props: IconProps) {
  return <Puzzle size={14} {...props} />;
}

export function SettingsIcon(props: IconProps) {
  return <Settings size={14} {...props} />;
}

export function MenuIcon(props: IconProps) {
  return <Menu size={14} {...props} />;
}

export function LightningIcon(props: IconProps) {
  return <Zap size={14} {...props} />;
}

export function ArrowRightIcon(props: IconProps) {
  return <ArrowRight size={14} {...props} />;
}

export function SendIcon(props: IconProps) {
  return <Send size={14} {...props} />;
}

export function PlayIcon(props: IconProps) {
  return <Play size={14} {...props} />;
}

export function CheckIcon(props: IconProps) {
  return <Check size={14} {...props} />;
}

export function XIcon(props: IconProps) {
  return <X size={14} {...props} />;
}

export function PlusIcon(props: IconProps) {
  return <Plus size={14} {...props} />;
}

export function TrashIcon(props: IconProps) {
  return <Trash2 size={14} {...props} />;
}

export function EyeIcon(props: IconProps) {
  return <Eye size={14} {...props} />;
}

export function RefreshIcon(props: IconProps) {
  return <RefreshCw size={14} {...props} />;
}

export function TeamsIcon(props: IconProps) {
  return <Users size={14} {...props} />;
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
