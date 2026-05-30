import { useState, useEffect, Suspense, memo } from "react";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import Dashboard from "./components/Dashboard";
import VaultPanel from "./components/VaultPanel";
import BudgetPanel from "./components/BudgetPanel";
import MemoryPanel from "./components/MemoryPanel";
import WorkProductsPanel from "./components/WorkProductsPanel";
import SubAgentPanel from "./components/SubAgentPanel";
import MCPPanel from "./components/MCPPanel";
import SettingsPanel from "./components/SettingsPanel";
import { ToasterProvider } from "./components/Toast";
import { AsciiMenu } from "./components/Icons";

export type View = "chat" | "dashboard" | "vault" | "budget" | "memory" | "work-products" | "agents" | "mcp" | "settings";

export default function App() {
  const [activeView, setActiveView] = useState<View>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let closed = false;

    function connect() {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws`);
      socket.onopen = () => { if (!closed) setWs(socket); };
      socket.onclose = () => {
        if (!closed) {
          setWs(null);
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
      socket.onerror = () => socket.close();
    }

    connect();
    return () => { closed = true; clearTimeout(reconnectTimer); };
  }, []);

  const navigate = (view: View) => {
    setActiveView(view);
    setSidebarOpen(false);
  };

  return (
    <ToasterProvider>
      <div className="layout">
        <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
        <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <Sidebar activeView={activeView} onNavigate={navigate} wsConnected={ws !== null} />
        </div>
        <div className="main-area">
          <TopBar activeView={activeView} wsConnected={ws !== null} onMenuClick={() => setSidebarOpen(o => !o)} />
          <div className="content-area">
            <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>}>
              <ViewRenderer activeView={activeView} ws={ws} />
            </Suspense>
          </div>
        </div>
      </div>
    </ToasterProvider>
  );
}

const ViewRenderer = memo(function ViewRenderer({ activeView, ws }: { activeView: View; ws: WebSocket | null }) {
  switch (activeView) {
    case "chat": return <ChatView ws={ws} />;
    case "dashboard": return <Dashboard />;
    case "vault": return <VaultPanel />;
    case "budget": return <BudgetPanel />;
    case "memory": return <MemoryPanel />;
    case "work-products": return <WorkProductsPanel />;
    case "agents": return <SubAgentPanel ws={ws} />;
    case "mcp": return <MCPPanel />;
    case "settings": return <SettingsPanel />;
    default: return <Dashboard />;
  }
});

const TopBar = memo(function TopBar({ activeView, wsConnected, onMenuClick }: { activeView: string; wsConnected: boolean; onMenuClick: () => void }) {
  const labels: Record<string, string> = {
    chat: "Chat", dashboard: "Dashboard", vault: "Secrets Vault",
    budget: "Budget", memory: "Memory", "work-products": "Work Products",
    agents: "Sub-Agents", mcp: "MCP Servers", settings: "Settings",
  };
  return (
    <div className="topbar">
      <button className="hamburger" onClick={onMenuClick}><AsciiMenu /></button>
      <span className="topbar-title">{labels[activeView] || activeView}</span>
      <div className="topbar-status">
        <div className={`status-dot ${wsConnected ? "pulse" : ""}`} style={{ background: wsConnected ? "var(--success)" : "var(--danger)" }} />
        <span>{wsConnected ? "Connected" : "Disconnected"}</span>
      </div>
    </div>
  );
});
