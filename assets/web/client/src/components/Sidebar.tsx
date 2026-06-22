import { useState, useMemo } from "react";
import { View } from "../App";
import {
  AsciiChat, AsciiDashboard, AsciiVault, AsciiBudget, AsciiMemory,
  AsciiWorkProducts, AsciiAgents, AsciiMCP, AsciiSettings, AsciiTeams, AsciiUsers,
  AsciiGraph, AsciiBanner, AsciiGitBranch, AsciiActivity, AsciiRefresh, AsciiNotes,
  AsciiBook, AsciiSearch, AsciiEye, AsciiCalendar,
  AsciiMail, AsciiPalette, AsciiShield, AsciiSliders, AsciiImage, AsciiMic,
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
  { view: "voice", icon: AsciiMic, label: "Voice Agent" },
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

const STORAGE_KEY = "sidebarOrder";

function loadOrder(): typeof NAV_ITEMS {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return NAV_ITEMS;
    const ids = JSON.parse(saved) as string[];
    const idSet = new Set(ids);
    const ordered = ids
      .map((id) => NAV_ITEMS.find((i) => i.view === id))
      .filter((i): i is (typeof NAV_ITEMS)[number] => i !== undefined);
    const appended = NAV_ITEMS.filter((i) => !idSet.has(i.view));
    return ordered.length > 0 ? [...ordered, ...appended] : NAV_ITEMS;
  } catch {
    return NAV_ITEMS;
  }
}

export default function Sidebar({ activeView, onNavigate, wsConnected }: SidebarProps) {
  const [search, setSearch] = useState("");
  const [orderedItems, setOrderedItems] = useState(loadOrder);
  const [draggedView, setDraggedView] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const isDraggable = !search.trim();

  const filtered = useMemo(() => {
    if (!search.trim()) return orderedItems;
    const q = search.toLowerCase();
    return orderedItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || item.view.toLowerCase().includes(q)
    );
  }, [search, orderedItems]);

  const handleDragStart = (e: React.DragEvent<HTMLButtonElement>, view: string) => {
    e.dataTransfer.setData("text/plain", view);
    e.dataTransfer.effectAllowed = "move";
    setDraggedView(view);
  };

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLButtonElement>, targetView: string) => {
    e.preventDefault();
    setDragOverIndex(null);
    const sourceView = e.dataTransfer.getData("text/plain");
    if (!sourceView || sourceView === targetView) return;

    setOrderedItems((prev) => {
      const sourceIdx = prev.findIndex((i) => i.view === sourceView);
      const targetIdx = prev.findIndex((i) => i.view === targetView);
      if (sourceIdx === -1 || targetIdx === -1) return prev;

      const copy = [...prev];
      const [moved] = copy.splice(sourceIdx, 1);
      const newTargetIdx = copy.findIndex((i) => i.view === targetView);
      copy.splice(newTargetIdx, 0, moved);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(copy.map((i) => i.view)));
      return copy;
    });
  };

  const handleDragEnd = () => {
    setDraggedView(null);
    setDragOverIndex(null);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <AsciiBanner />
      </div>
      <div className="sidebar-search">
        <input
          className="sidebar-search-input"
          type="text"
          placeholder="Search views..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search sidebar"
        />
        {search && (
          <button
            className="sidebar-search-clear"
            onClick={() => setSearch("")}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      {search && filtered.length < orderedItems.length && (
        <div className="sidebar-search-count">
          {filtered.length} / {orderedItems.length} matches
        </div>
      )}
      <div className="sidebar-nav" role="navigation" aria-label="Main navigation">
        {filtered.map((item, idx) => {
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              className={`nav-item ${activeView === item.view ? "active" : ""}`}
              onClick={() => onNavigate(item.view)}
              draggable={isDraggable}
              onDragStart={(e) => handleDragStart(e, item.view)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, item.view)}
              onDragEnd={handleDragEnd}
              aria-label={item.label}
              style={{
                opacity: draggedView === item.view ? 0.4 : undefined,
                borderTopColor: dragOverIndex === idx ? "var(--accent)" : undefined,
                borderTopStyle: dragOverIndex === idx ? "solid" : undefined,
                borderTopWidth: dragOverIndex === idx ? "2px" : undefined,
              }}
            >
              <span className="nav-marker">{activeView === item.view ? "[x]" : "[ ]"}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: "16px", color: "var(--mute)", fontSize: 12, textAlign: "center", fontFamily: "var(--font-mono)" }}>
            No matches
          </div>
        )}
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
