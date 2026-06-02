import { useState, useEffect, Suspense, lazy, memo } from "react";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import { ToasterProvider } from "./components/Toast";
import { AsciiMenu } from "./components/Icons";
import { ChatProvider, useChat } from "./context/ChatContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

const Dashboard = lazy(() => import("./components/Dashboard"));
const VaultPanel = lazy(() => import("./components/VaultPanel"));
const BudgetPanel = lazy(() => import("./components/BudgetPanel"));
const MemoryPanel = lazy(() => import("./components/MemoryPanel"));
const KnowledgeGraphPanel = lazy(() => import("./components/KnowledgeGraphPanel"));
const PipelinePanel = lazy(() => import("./components/PipelinePanel"));
const HealthPanel = lazy(() => import("./components/HealthPanel"));
const WorkProductsPanel = lazy(() => import("./components/WorkProductsPanel"));
const SubAgentPanel = lazy(() => import("./components/SubAgentPanel"));
const MCPPanel = lazy(() => import("./components/MCPPanel"));
const AgentsPanel = lazy(() => import("./components/AgentsPanel"));
const TeamPanel = lazy(() => import("./components/TeamPanel"));
const SettingsPanel = lazy(() => import("./components/SettingsPanel"));
const SocialPanel = lazy(() => import("./components/SocialPanel"));

export type View = "chat" | "dashboard" | "vault" | "budget" | "memory" | "knowledge-graph" | "pipeline" | "health" | "work-products" | "agents" | "agent-discovery" | "mcp" | "teams" | "settings" | "social";

const PANELFallback = <div style={{ padding: 40, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>;

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

  useEffect(() => {
    if (!ws) return;
    const handler = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "swarm_recovery") setActiveView("agents");
      } catch {}
    };
    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws]);

  return (
    <ErrorBoundary>
      <div className="layout">
        <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
        <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <Sidebar activeView={activeView} onNavigate={(view: View) => { setActiveView(view); setSidebarOpen(false); }} wsConnected={connected} />
        </div>
        <div className="main-area">
          <TopBar activeView={activeView} wsConnected={connected} onMenuClick={() => setSidebarOpen(o => !o)} />
          <div className={`content-area ${activeView === "chat" ? "content-area-chat" : ""}`}>
            <Suspense fallback={PANELFallback}>
              {activeView === "chat" && <ChatView />}
              {activeView === "dashboard" && <Dashboard />}
              {activeView === "vault" && <VaultPanel />}
              {activeView === "budget" && <BudgetPanel />}
              {activeView === "memory" && <MemoryPanel />}
              {activeView === "knowledge-graph" && <KnowledgeGraphPanel />}
              {activeView === "pipeline" && <PipelinePanel />}
              {activeView === "health" && <HealthPanel />}
              {activeView === "work-products" && <WorkProductsPanel />}
              {activeView === "agents" && <SubAgentPanel ws={ws} />}
              {activeView === "agent-discovery" && <AgentsPanel />}
              {activeView === "teams" && <TeamPanel onNavigate={(v) => setActiveView(v as View)} />}
              {activeView === "mcp" && <MCPPanel />}
              {activeView === "settings" && <SettingsPanel />}
              {activeView === "social" && <SocialPanel />}
            </Suspense>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

const TopBar = memo(function TopBar({ activeView, wsConnected, onMenuClick }: { activeView: string; wsConnected: boolean; onMenuClick: () => void }) {
  const labels: Record<string, string> = {
    chat: "Chat", dashboard: "Dashboard", vault: "Secrets Vault",
    budget: "Budget", memory: "Memory", "knowledge-graph": "Knowledge Graph",
    pipeline: "Pipeline", health: "Health & Resources",
    "work-products": "Work Products",
    agents: "Sub-Agents", "agent-discovery": "Agent Discovery", mcp: "MCP Servers",
    teams: "Teams", settings: "Settings", social: "Social Accounts",
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
