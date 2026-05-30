import { useState, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import Dashboard from "./components/Dashboard";
import VaultPanel from "./components/VaultPanel";
import BudgetPanel from "./components/BudgetPanel";
import MemoryPanel from "./components/MemoryPanel";
import WorkProductsPanel from "./components/WorkProductsPanel";
import { Toaster } from "./components/Toast";

export type View = "chat" | "dashboard" | "vault" | "budget" | "memory" | "work-products";

export default function App() {
  const [activeView, setActiveView] = useState<View>("chat");
  const [ws, setWs] = useState<WebSocket | null>(null);

  const connectWs = useCallback(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws`;
    const socket = new WebSocket(wsUrl);
    socket.onopen = () => setWs(socket);
    socket.onclose = () => {
      setWs(null);
      setTimeout(connectWs, 2000);
    };
    socket.onerror = () => socket.close();
  }, []);

  return (
    <div className="layout">
      <Sidebar activeView={activeView} onNavigate={setActiveView} wsConnected={ws !== null} />
      <div className="main-area">
        <TopBar activeView={activeView} wsConnected={ws !== null} />
        <div className="content-area">
          {activeView === "chat" && <ChatView ws={ws} onConnect={connectWs} />}
          {activeView === "dashboard" && <Dashboard />}
          {activeView === "vault" && <VaultPanel />}
          {activeView === "budget" && <BudgetPanel />}
          {activeView === "memory" && <MemoryPanel />}
          {activeView === "work-products" && <WorkProductsPanel />}
        </div>
      </div>
      <Toaster />
    </div>
  );
}

function TopBar({ activeView, wsConnected }: { activeView: string; wsConnected: boolean }) {
  const labels: Record<string, string> = {
    chat: "Chat", dashboard: "Dashboard", vault: "Secrets Vault",
    budget: "Budget", memory: "Memory", "work-products": "Work Products",
  };
  return (
    <div className="topbar">
      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{labels[activeView] || activeView}</span>
      <div className="topbar-status">
        <div className="status-dot" style={{ background: wsConnected ? "var(--accent-green)" : "var(--accent-red)" }} />
        <span>{wsConnected ? "Connected" : "Disconnected"}</span>
      </div>
    </div>
  );
}
