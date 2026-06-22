import { useLocation, useNavigate } from "react-router-dom";

const LABELS: Record<string, string> = {
  chat: "Chat", dashboard: "Dashboard", vault: "Secrets Vault",
  budget: "Budget", memory: "Memory", "knowledge-graph": "Knowledge Graph",
  pipeline: "Pipeline", health: "Health & Resources",
  "work-products": "Work Products",
  agents: "Sub-Agents", "agent-discovery": "Agent Discovery", mcp: "MCP Servers",
  teams: "Teams", settings: "Settings", social: "Social Accounts",
  notes: "Notes & Tasks", contacts: "Contacts", cookbook: "Model Cookbook",
  research: "Deep Research", compare: "Model Comparison",
  gallery: "Image Gallery", documents: "Documents",
  email: "Email", "canvas-editor": "Canvas Editor", theme: "Theme Editor",
  login: "Login", admin: "Admin", voice: "Voice Agent",
};

export default function Breadcrumbs() {
  const location = useLocation();
  const navigate = useNavigate();
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length <= 1) return null;
  
  const crumbs = parts.map((part, i) => {
    const path = "/" + parts.slice(0, i + 1).join("/");
    const label = LABELS[part] || part.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return { label, path, isLast: i === parts.length - 1 };
  });

  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--text-secondary)", padding: "4px 16px" }}>
      {crumbs.map((crumb, i) => (
        <span key={crumb.path} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {i > 0 && <span style={{ color: "var(--text-tertiary)" }}>/</span>}
          {crumb.isLast ? (
            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{crumb.label}</span>
          ) : (
            <button onClick={() => navigate(crumb.path)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontSize: "13px" }}>
              {crumb.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}
