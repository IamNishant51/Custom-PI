import { View } from "../App";
import {
  AsciiChat, AsciiDashboard, AsciiVault, AsciiBudget, AsciiMemory,
  AsciiWorkProducts, AsciiAgents, AsciiMCP, AsciiSettings, AsciiTeams, AsciiUsers,
  AsciiGraph, AsciiBanner, AsciiGitBranch, AsciiActivity, AsciiRefresh, AsciiNotes,
  AsciiBook, AsciiSearch, AsciiEye, AsciiCalendar,
  AsciiMail, AsciiPalette, AsciiShield, AsciiSliders, AsciiImage,
} from "./Icons";

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
  wsConnected: boolean;
}

const NAV_ITEMS: { view: View; icon: typeof AsciiChat; label: string }[] = [
  { view: "chat", icon: AsciiChat, label: "Chat" },
  { view: "dashboard", icon: AsciiDashboard, label: "Dashboard" },
  { view: "vault", icon: AsciiVault, label: "Secrets Vault" },
  { view: "budget", icon: AsciiBudget, label: "Budget" },
  { view: "memory", icon: AsciiMemory, label: "Memory" },
  { view: "knowledge-graph", icon: AsciiGraph, label: "Knowledge Graph" },
  { view: "pipeline", icon: AsciiGitBranch, label: "Pipeline" },
  { view: "health", icon: AsciiActivity, label: "Health" },
  { view: "work-products", icon: AsciiWorkProducts, label: "Work Products" },
  { view: "agents", icon: AsciiAgents, label: "Sub-Agents" },
  { view: "agent-discovery", icon: AsciiUsers, label: "Agent Discovery" },
  { view: "mcp", icon: AsciiMCP, label: "MCP Servers" },
  { view: "teams", icon: AsciiTeams, label: "Teams" },
  { view: "social", icon: AsciiRefresh, label: "Social Accounts" },
  { view: "notes", icon: AsciiNotes, label: "Notes & Tasks" },
  { view: "contacts", icon: AsciiUsers, label: "Contacts" },
  { view: "cookbook", icon: AsciiBook, label: "Model Cookbook" },
  { view: "research", icon: AsciiSearch, label: "Deep Research" },
  { view: "compare", icon: AsciiEye, label: "Model Compare" },
  { view: "gallery", icon: AsciiCalendar, label: "Image Gallery" },
  { view: "documents", icon: AsciiWorkProducts, label: "Documents" },
  { view: "email", icon: AsciiMail, label: "Email" },
  { view: "canvas-editor", icon: AsciiSliders, label: "Canvas Editor" },
  { view: "theme", icon: AsciiPalette, label: "Theme Editor" },
  { view: "login", icon: AsciiShield, label: "Login" },
  { view: "admin", icon: AsciiShield, label: "Admin" },
  { view: "settings", icon: AsciiSettings, label: "Settings" },
];

export default function Sidebar({ activeView, onNavigate, wsConnected }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <AsciiBanner />
      </div>
      <div className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              className={`nav-item ${activeView === item.view ? "active" : ""}`}
              onClick={() => onNavigate(item.view)}
            >
              <span className="nav-marker">{activeView === item.view ? "[x]" : "[ ]"}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ padding: "8px 16px", borderTop: "1px solid var(--hairline)", fontSize: 11, color: "var(--mute)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div className="status-dot" style={{ background: wsConnected ? "var(--success)" : "var(--danger)" }} />
          {wsConnected ? "connected" : "offline"}
        </div>
      </div>
    </div>
  );
}
