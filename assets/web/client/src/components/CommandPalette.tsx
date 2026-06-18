import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const NAV_ITEMS: { view: string; label: string }[] = [
  { view: "chat", label: "Chat" },
  { view: "dashboard", label: "Dashboard" },
  { view: "vault", label: "Secrets Vault" },
  { view: "budget", label: "Budget" },
  { view: "voice", label: "Voice Agent" },
  { view: "memory", label: "Memory" },
  { view: "knowledge-graph", label: "Knowledge Graph" },
  { view: "pipeline", label: "Pipeline" },
  { view: "health", label: "Health" },
  { view: "work-products", label: "Work Products" },
  { view: "agents", label: "Sub-Agents" },
  { view: "agent-discovery", label: "Agent Discovery" },
  { view: "mcp", label: "MCP Servers" },
  { view: "teams", label: "Teams" },
  { view: "social", label: "Social Accounts" },
  { view: "notes", label: "Notes & Tasks" },
  { view: "contacts", label: "Contacts" },
  { view: "cookbook", label: "Model Cookbook" },
  { view: "research", label: "Deep Research" },
  { view: "compare", label: "Model Compare" },
  { view: "gallery", label: "Image Gallery" },
  { view: "documents", label: "Documents" },
  { view: "email", label: "Email" },
  { view: "canvas-editor", label: "Canvas Editor" },
  { view: "theme", label: "Theme Editor" },
  { view: "login", label: "Login" },
  { view: "admin", label: "Admin" },
  { view: "settings", label: "Settings" },
];

const COMMANDS: { id: string; label: string; action: string }[] = [
  { id: "toggle-sidebar", label: "Toggle Sidebar", action: "toggle_sidebar" },
  { id: "help", label: "Show Keyboard Shortcuts", action: "help" },
  { id: "new-team", label: "Create New Team", action: "navigate:/teams" },
  { id: "new-note", label: "Create New Note", action: "navigate:/notes" },
  { id: "new-contact", label: "Create New Contact", action: "navigate:/contacts" },
];

export default function CommandPalette({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const results = query.trim()
    ? [...NAV_ITEMS, ...COMMANDS].filter(item =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        ("view" in item && item.view?.toLowerCase().includes(query.toLowerCase()))
      ).map(item => "view" in item ? { ...item, type: "nav" as const } : { ...item, type: "command" as const })
    : [];

  const handleSelect = useCallback((item: typeof results[0]) => {
    setOpen(false);
    setQuery("");
    if (item.type === "nav") {
      navigate(`/${(item as typeof NAV_ITEMS[0]).view}`);
    } else {
      const cmd = item as typeof COMMANDS[0];
      if (cmd.action === "toggle_sidebar") onToggleSidebar?.();
      else if (cmd.action === "help") {
        const ev = new KeyboardEvent("keydown", { key: "?" });
        window.dispatchEvent(ev);
      } else if (cmd.action.startsWith("navigate:")) {
        navigate(cmd.action.slice(9));
      }
    }
  }, [navigate, onToggleSidebar]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(p => !p);
        setQuery("");
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  return (
    <div className="command-palette-overlay" onClick={() => { setOpen(false); setQuery(""); }}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          placeholder="Search views and commands..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
            if (e.key === "Enter" && results[selectedIndex]) { handleSelect(results[selectedIndex]); }
            if (e.key === "Escape") { setOpen(false); setQuery(""); }
          }}
          aria-label="Command palette search"
          role="combobox"
          aria-expanded
          aria-haspopup="listbox"
          aria-activedescendant={results[selectedIndex] ? `cp-${selectedIndex}` : undefined}
        />
        {results.length > 0 && (
          <div className="command-palette-list" role="listbox">
            {results.map((item, i) => (
              <button
                key={`${item.type}-${item.type === "nav" ? item.view : item.id}`}
                id={`cp-${i}`}
                className={`command-palette-item ${i === selectedIndex ? "selected" : ""}`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIndex(i)}
                role="option"
                aria-selected={i === selectedIndex}
              >
                <span className="command-palette-item-label">{item.label}</span>
                <span className="command-palette-item-type">{item.type === "nav" ? "View" : "Cmd"}</span>
              </button>
            ))}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className="command-palette-empty">No results</div>
        )}
      </div>
    </div>
  );
}
