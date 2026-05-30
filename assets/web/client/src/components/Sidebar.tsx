import { View } from "../App";

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
  wsConnected: boolean;
}

const NAV_ITEMS: { view: View; icon: string; label: string }[] = [
  { view: "chat", icon: "💬", label: "Chat" },
  { view: "dashboard", icon: "📊", label: "Dashboard" },
  { view: "vault", icon: "🔐", label: "Secrets Vault" },
  { view: "budget", icon: "💰", label: "Budget" },
  { view: "memory", icon: "🧠", label: "Memory" },
  { view: "work-products", icon: "📂", label: "Work Products" },
];

export default function Sidebar({ activeView, onNavigate, wsConnected }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>✦</span>
        <span>CUSTOM-PI</span>
      </div>
      <div className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            className={`nav-item ${activeView === item.view ? "active" : ""}`}
            onClick={() => onNavigate(item.view)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div className="status-dot" style={{ background: wsConnected ? "var(--accent-green)" : "var(--accent-red)" }} />
          {wsConnected ? "Server Connected" : "Disconnected"}
        </div>
      </div>
    </div>
  );
}
