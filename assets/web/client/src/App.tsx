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
import { ChatProvider, useChat } from "./context/ChatContext";

export type View = "chat" | "dashboard" | "vault" | "budget" | "memory" | "work-products" | "agents" | "mcp" | "settings";

export default function App() {
  return (
    <ChatProvider>
      <ToasterProvider>
        <AppContent />
      </ToasterProvider>
    </ChatProvider>
  );
}

function AppContent() {
  const [activeView, setActiveView] = useState<View>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { ws, connected } = useChat();

  const navigate = (view: View) => {
    setActiveView(view);
    setSidebarOpen(false);
  };

  return (
    <div className="layout">
      <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <Sidebar activeView={activeView} onNavigate={navigate} wsConnected={connected} />
      </div>
      <div className="main-area">
        <TopBar activeView={activeView} wsConnected={connected} onMenuClick={() => setSidebarOpen(o => !o)} />
        <div className={`content-area ${activeView === "chat" ? "content-area-chat" : ""}`}>
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>}>
            <div style={{ display: activeView === "chat" ? "flex" : "none", flex: 1, flexDirection: "column", height: "100%", width: "100%" }}>
              <ChatView />
            </div>
            <div style={{ display: activeView === "dashboard" ? "block" : "none", height: "100%", width: "100%" }}>
              <Dashboard />
            </div>
            <div style={{ display: activeView === "vault" ? "block" : "none", height: "100%", width: "100%" }}>
              <VaultPanel />
            </div>
            <div style={{ display: activeView === "budget" ? "block" : "none", height: "100%", width: "100%" }}>
              <BudgetPanel />
            </div>
            <div style={{ display: activeView === "memory" ? "block" : "none", height: "100%", width: "100%" }}>
              <MemoryPanel />
            </div>
            <div style={{ display: activeView === "work-products" ? "block" : "none", height: "100%", width: "100%" }}>
              <WorkProductsPanel />
            </div>
            <div style={{ display: activeView === "agents" ? "block" : "none", height: "100%", width: "100%" }}>
              <SubAgentPanel ws={ws} />
            </div>
            <div style={{ display: activeView === "mcp" ? "block" : "none", height: "100%", width: "100%" }}>
              <MCPPanel />
            </div>
            <div style={{ display: activeView === "settings" ? "block" : "none", height: "100%", width: "100%" }}>
              <SettingsPanel />
            </div>
          </Suspense>
        </div>
      </div>
    </div>
  );
}

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
