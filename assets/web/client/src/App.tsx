import { useState, useEffect, Suspense, lazy, memo, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import { ToasterProvider } from "./components/Toast";
import { AsciiMenu } from "./components/Icons";
import { ChatProvider, useChat } from "./context/ChatContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./context/ThemeContext";
import { ModalProvider } from "./context/ModalContext";
import ModalContainer from "./components/ModalContainer";

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
const NotesPanel = lazy(() => import("./components/NotesPanel"));
const ContactsPanel = lazy(() => import("./components/ContactsPanel"));
const CookbookPanel = lazy(() => import("./components/CookbookPanel"));
const DeepResearchPanel = lazy(() => import("./components/DeepResearchPanel"));
const ModelComparisonPanel = lazy(() => import("./components/ModelComparisonPanel"));
const ImageGalleryPanel = lazy(() => import("./components/ImageGalleryPanel"));
const DocumentEditorPanel = lazy(() => import("./components/DocumentEditorPanel"));
const EmailPanel = lazy(() => import("./components/EmailPanel"));
const CanvasEditorPanel = lazy(() => import("./components/CanvasEditorPanel"));
const ThemeEditorPanel = lazy(() => import("./components/ThemeEditorPanel"));
const LoginPanel = lazy(() => import("./components/LoginPanel"));
const AdminPanel = lazy(() => import("./components/AdminPanel"));

export type View = "chat" | "dashboard" | "vault" | "budget" | "memory" | "knowledge-graph" | "pipeline" | "health" | "work-products" | "agents" | "agent-discovery" | "mcp" | "teams" | "settings" | "social" | "notes" | "contacts" | "cookbook" | "research" | "compare" | "gallery" | "documents" | "email" | "canvas-editor" | "theme" | "login" | "admin";

const ALL_VIEWS: View[] = ["chat", "dashboard", "vault", "budget", "memory", "knowledge-graph", "pipeline", "health", "work-products", "agents", "agent-discovery", "mcp", "teams", "settings", "social", "notes", "contacts", "cookbook", "research", "compare", "gallery", "documents", "email", "canvas-editor", "theme", "login", "admin"];

function hashToView(): View {
  const raw = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (ALL_VIEWS.includes(raw as View)) return raw as View;
  return "chat";
}

function viewToHash(v: View) {
  const hash = `#/${v}`;
  if (window.location.hash !== hash) window.location.hash = hash;
}

const PANELFallback = <div style={{ padding: 40, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>;

export default function App() {
  return (
    <ThemeProvider>
      <ChatProvider>
        <ModalProvider>
          <ToasterProvider>
            <AppContent />
          </ToasterProvider>
          <ModalContainer />
        </ModalProvider>
      </ChatProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  const [activeView, setActiveView] = useState<View>(hashToView);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { ws, connected } = useChat();

  const navigate = useCallback((view: View) => {
    setActiveView(view);
    viewToHash(view);
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    const onHash = () => setActiveView(hashToView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!ws) return;
    const handler = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "swarm_recovery") navigate("agents");
      } catch {}
    };
    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws, navigate]);

  return (
    <ErrorBoundary>
      <div className="layout">
        <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
        <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <Sidebar activeView={activeView} onNavigate={navigate} wsConnected={connected} />
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
              {activeView === "teams" && <TeamPanel onNavigate={navigate} />}
              {activeView === "mcp" && <MCPPanel />}
              {activeView === "settings" && <SettingsPanel />}
              {activeView === "social" && <SocialPanel />}
              {activeView === "notes" && <NotesPanel />}
              {activeView === "contacts" && <ContactsPanel />}
              {activeView === "cookbook" && <CookbookPanel />}
              {activeView === "research" && <DeepResearchPanel />}
              {activeView === "compare" && <ModelComparisonPanel />}
              {activeView === "gallery" && <ImageGalleryPanel />}
              {activeView === "documents" && <DocumentEditorPanel />}
              {activeView === "email" && <EmailPanel />}
              {activeView === "canvas-editor" && <CanvasEditorPanel />}
              {activeView === "theme" && <ThemeEditorPanel />}
              {activeView === "login" && <LoginPanel />}
              {activeView === "admin" && <AdminPanel />}
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
    teams: "Teams", settings: "Settings", social: "Social Accounts", notes: "Notes & Tasks", contacts: "Contacts", cookbook: "Model Cookbook", research: "Deep Research", compare: "Model Comparison", gallery: "Image Gallery", documents: "Documents",
    email: "Email", "canvas-editor": "Canvas Editor", theme: "Theme Editor", login: "Login", admin: "Admin",
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
