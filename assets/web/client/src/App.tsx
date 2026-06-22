import { useState, useEffect, Suspense, lazy, memo, useCallback } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import { ToasterProvider } from "./components/Toast";
import { AsciiMenu } from "./components/Icons";
import { ChatProvider, useChat } from "./context/ChatContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./context/ThemeContext";
import { ModalProvider } from "./context/ModalContext";
import ModalContainer from "./components/ModalContainer";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import CommandPalette from "./components/CommandPalette";
import NotificationBell from "./components/NotificationBell";
import UndoBar from "./components/UndoBar";
import OnboardingTour from "./components/OnboardingTour";
import Breadcrumbs from "./components/Breadcrumbs";

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
const VoicePanel = lazy(() => import("./components/VoicePanel"));

export type View = string;

const PANELFallback = <div style={{ padding: 40, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>;

function ViewWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={PANELFallback}>{children}</Suspense>;
}

function ViewRouter() {
  return (
    <Routes>
      <Route path="/" element={<ViewWrapper><ChatView /></ViewWrapper>} />
      <Route path="/chat" element={<ViewWrapper><ChatView /></ViewWrapper>} />
      <Route path="/dashboard" element={<ViewWrapper><Dashboard /></ViewWrapper>} />
      <Route path="/vault" element={<ViewWrapper><VaultPanel /></ViewWrapper>} />
      <Route path="/budget" element={<ViewWrapper><BudgetPanel /></ViewWrapper>} />
      <Route path="/memory" element={<ViewWrapper><MemoryPanel /></ViewWrapper>} />
      <Route path="/knowledge-graph" element={<ViewWrapper><KnowledgeGraphPanel /></ViewWrapper>} />
      <Route path="/pipeline" element={<ViewWrapper><PipelinePanel /></ViewWrapper>} />
      <Route path="/health" element={<ViewWrapper><HealthPanel /></ViewWrapper>} />
      <Route path="/work-products" element={<ViewWrapper><WorkProductsPanel /></ViewWrapper>} />
      <Route path="/agents" element={<ViewWrapper><SubAgentPanelWithWs /></ViewWrapper>} />
      <Route path="/agent-discovery" element={<ViewWrapper><AgentsPanel /></ViewWrapper>} />
      <Route path="/teams" element={<ViewWrapper><TeamPanelWithNav /></ViewWrapper>} />
      <Route path="/mcp" element={<ViewWrapper><MCPPanel /></ViewWrapper>} />
      <Route path="/settings" element={<ViewWrapper><SettingsPanel /></ViewWrapper>} />
      <Route path="/social" element={<ViewWrapper><SocialPanel /></ViewWrapper>} />
      <Route path="/notes" element={<ViewWrapper><NotesPanel /></ViewWrapper>} />
      <Route path="/contacts" element={<ViewWrapper><ContactsPanel /></ViewWrapper>} />
      <Route path="/cookbook" element={<ViewWrapper><CookbookPanel /></ViewWrapper>} />
      <Route path="/research" element={<ViewWrapper><DeepResearchPanel /></ViewWrapper>} />
      <Route path="/compare" element={<ViewWrapper><ModelComparisonPanel /></ViewWrapper>} />
      <Route path="/gallery" element={<ViewWrapper><ImageGalleryPanel /></ViewWrapper>} />
      <Route path="/documents" element={<ViewWrapper><DocumentEditorPanel /></ViewWrapper>} />
      <Route path="/email" element={<ViewWrapper><EmailPanel /></ViewWrapper>} />
      <Route path="/canvas-editor" element={<ViewWrapper><CanvasEditorPanel /></ViewWrapper>} />
      <Route path="/theme" element={<ViewWrapper><ThemeEditorPanel /></ViewWrapper>} />
      <Route path="/login" element={<ViewWrapper><LoginPanel /></ViewWrapper>} />
      <Route path="/admin" element={<ViewWrapper><AdminPanel /></ViewWrapper>} />
      <Route path="/voice" element={<ViewWrapper><VoicePanel /></ViewWrapper>} />
    </Routes>
  );
}

function SubAgentPanelWithWs() {
  const { ws } = useChat();
  return <SubAgentPanel ws={ws} />;
}

function TeamPanelWithNav() {
  const navigate = useNavigate();
  return <TeamPanel onNavigate={(v) => navigate(`/${v}`)} />;
}

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
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const { ws, connected } = useChat();

  const activeView = location.pathname.replace(/^\//, "") || "chat";

  const onNavigate = useCallback((view: string) => {
    navigate(`/${view}`);
    setSidebarOpen(false);
  }, [navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setShortcutsOpen((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!ws) return;
    const handler = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "swarm_recovery") navigate("/agents");
      } catch {}
    };
    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws, navigate]);

  useEffect(() => {
    const saved = localStorage.getItem("lastView");
    if (saved && saved !== activeView && saved !== "") {
      const validViews = ["chat", "dashboard", "vault", "budget", "memory", "knowledge-graph", "pipeline", "health", "work-products", "agents", "agent-discovery", "mcp", "teams", "settings", "social", "notes", "contacts", "cookbook", "research", "compare", "gallery", "documents", "email", "canvas-editor", "theme", "login", "admin", "voice"];
      if (validViews.includes(saved)) {
        navigate("/" + saved, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeView && activeView !== "admin") {
      localStorage.setItem("lastView", activeView);
    }
  }, [activeView]);

  return (
    <ErrorBoundary>
      <div className="layout" role="application" aria-label="Custom-PI Web Client">
        {!online && <div style={{ background: "var(--warning)", color: "#1a1a2e", padding: "8px 16px", fontSize: "14px", textAlign: "center", width: "100%" }}>You are offline — some features may be unavailable</div>}
        <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
        <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <Sidebar activeView={activeView} onNavigate={onNavigate} wsConnected={connected} />
        </div>
        <div className="main-area">
          <Breadcrumbs />
          <TopBar activeView={activeView} wsConnected={connected} onMenuClick={() => setSidebarOpen(o => !o)} />
          <div className={`content-area ${activeView === "chat" ? "content-area-chat" : ""} ${activeView === "voice" ? "content-area-voice" : ""}`}>
            <ViewRouter />
          </div>
        </div>
      </div>
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <CommandPalette onToggleSidebar={() => setSidebarOpen(o => !o)} />
      <UndoBar />
      <OnboardingTour />
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
    email: "Email", "canvas-editor": "Canvas Editor", theme: "Theme Editor",     login: "Login", admin: "Admin", voice: "Voice Agent",
  };
  return (
    <div className="topbar">
      <button className="hamburger" onClick={onMenuClick}><AsciiMenu /></button>
      <span className="topbar-title">{labels[activeView] || activeView}</span>
      <div className="topbar-status">
        <NotificationBell />
        <div id="topbar-actions" style={{ display: "flex", gap: "12px", alignItems: "center", marginRight: "12px" }}></div>
        <div className={`status-dot ${wsConnected ? "pulse" : ""}`} style={{ background: wsConnected ? "var(--success)" : "var(--danger)" }} />
        <span>{wsConnected ? "Connected" : "Disconnected"}</span>
      </div>
    </div>
  );
});
