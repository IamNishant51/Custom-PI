import { useState, useEffect } from "react";

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [memory, setMemory] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [vaultHealth, setVaultHealth] = useState("");
  const [vaultKeys, setVaultKeys] = useState<string[]>([]);
  const [mcpConfig, setMcpConfig] = useState<any>(null);
  const [swarmTeams, setSwarmTeams] = useState<any[]>([]);
  const [workProducts, setWorkProducts] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/budget/stats").then(r => r.json()).then(setStats).catch(() => {});
    fetch("/api/memory/stats").then(r => r.json()).then(setMemory).catch(() => {});
    fetch("/api/models").then(r => r.json()).then(setModels).catch(() => {});
    fetch("/api/vault/health").then(r => r.json()).then(d => {
      if (d.ok) setVaultHealth(d.message);
      else setVaultHealth("Locked / Key Required");
    }).catch(() => {});
    fetch("/api/vault/list").then(r => r.json()).then(d => setVaultKeys(d.keys || [])).catch(() => {});
    fetch("/api/mcp/config").then(r => r.json()).then(setMcpConfig).catch(() => {});
    fetch("/api/swarm/teams").then(r => r.json()).then(d => setSwarmTeams(d.teams || [])).catch(() => {});
    fetch("/api/work-products").then(r => r.json()).then(d => setWorkProducts(d.products || [])).catch(() => {});
  }, []);

  const getRelativeTime = (timestamp: string) => {
    try {
      const diff = Date.now() - new Date(timestamp).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "Just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      return new Date(timestamp).toLocaleDateString();
    } catch {
      return "—";
    }
  };

  const getFileBasename = (path: string) => {
    if (!path) return "—";
    const parts = path.split("/");
    return parts[parts.length - 1];
  };

  const getFileDir = (path: string) => {
    if (!path) return "";
    const parts = path.split("/");
    if (parts.length <= 1) return "./";
    return parts.slice(0, -1).join("/") + "/";
  };

  const actionColors: Record<string, { bg: string; fg: string }> = {
    create: { bg: "rgba(16, 185, 129, 0.08)", fg: "#34d399" },
    modify: { bg: "rgba(99, 102, 241, 0.08)", fg: "#818cf8" },
    read: { bg: "rgba(100, 116, 139, 0.08)", fg: "#94a3b8" },
    delete: { bg: "rgba(239, 68, 68, 0.08)", fg: "#f87171" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
      {/* ── System Telemetry Metrics row ── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Model Usage & Cost</div>
          <div className="stat-value">
            {stats ? stats.totalTokens?.toLocaleString() : "—"}
          </div>
          <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
            COST: {stats ? `$${stats.totalCostUsd?.toFixed(4)}` : "—"} ({stats ? stats.totalSessions : 0} sessions)
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Credentials Vault</div>
          <div className="stat-value" style={{ color: vaultKeys.length > 0 ? "var(--success)" : "var(--mute)" }}>
            {vaultKeys.length > 0 ? "SECURE" : "INACTIVE"}
          </div>
          <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
            {vaultKeys.length} secret keys encrypted
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">MCP Integrations</div>
          <div className="stat-value">
            {mcpConfig && mcpConfig.servers ? mcpConfig.servers.length : "0"}
          </div>
          <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
            external tool servers connected
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">RAG Semantic Memory</div>
          <div className="stat-value">
            {memory ? memory.totalEntries : "—"}
          </div>
          <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
            learned fact nodes indexed
          </div>
        </div>
      </div>

      {/* ── Bottom Section columns ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "var(--spacing-lg)" }}>
        {/* Left Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
          {/* Swarms Card */}
          <div className="card">
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Saved Swarm Registries</span>
              <span className="badge badge-purple" style={{ fontSize: 9 }}>{swarmTeams.length} Templates</span>
            </div>
            <div style={{ padding: "var(--spacing-md)", display: "flex", flexDirection: "column", gap: 12 }}>
              {swarmTeams.length === 0 ? (
                <div style={{ padding: "20px 0", textAlign: "center", color: "var(--mute)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                  No saved swarms registered yet. Define swarm objectives in the Sub-agents tab.
                </div>
              ) : (
                swarmTeams.slice(0, 4).map((team, idx) => (
                  <div key={idx} style={{ padding: 12, border: "1px solid var(--hairline)", background: "rgba(255, 255, 255, 0.01)", borderRadius: "var(--radius-sm)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <strong style={{ color: "#fff", fontSize: 13, fontFamily: "var(--font-sans)" }}>{team.name}</strong>
                      <span className="badge badge-gray">{team.agents?.length || 0} Agents</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--mute)", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      "{team.goal}"
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {team.agents?.map((agent: any, aIdx: number) => {
                        let badgeClass = "badge-gray";
                        if (agent.id === "researcher") badgeClass = "badge-cyan";
                        else if (agent.id === "coder") badgeClass = "badge-purple";
                        else if (agent.id === "reviewer") badgeClass = "badge-yellow";
                        return (
                          <span key={aIdx} className={`badge ${badgeClass}`} style={{ fontSize: 8, padding: "2px 6px" }}>
                            {agent.id}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Model Catalog */}
          <div className="card">
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>AI Models Catalog</span>
              <span className="badge badge-cyan" style={{ fontSize: 9 }}>{models.length} Discovered</span>
            </div>
            {models.length === 0 ? (
              <div className="empty-state" style={{ padding: 20 }}>
                <div className="empty-state-desc">Loading AI model endpoints...</div>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>Provider</th><th>Model ID</th><th>API Interface</th></tr>
                </thead>
                <tbody>
                  {models.slice(0, 5).map((m, i) => (
                    <tr key={i}>
                      <td style={{ color: "var(--mute)" }}>{m.provider}</td>
                      <td style={{ color: "#fff", fontWeight: 500 }}>{m.id}</td>
                      <td style={{ fontSize: 11, color: "var(--mute)" }}>{m.api}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Column: Work Products Feed */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
          <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Recent Swarm Deliverables & Changes</span>
              <span className="badge badge-green" style={{ fontSize: 9 }}>{workProducts.length} Modifications</span>
            </div>
            
            <div style={{ flexGrow: 1, padding: "var(--spacing-md)", display: "flex", flexDirection: "column", gap: 12 }}>
              {workProducts.length === 0 ? (
                <div style={{ padding: "40px 0", textAlign: "center", color: "var(--mute)", fontSize: 12, fontFamily: "var(--font-mono)", flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  No deliverables recorded yet. Run agent swarm campaigns to see output modifications.
                </div>
              ) : (
                workProducts.slice(-6).reverse().map((p, i) => {
                  const colors = actionColors[p.action] || { bg: "rgba(255,255,255,0.05)", fg: "var(--mute)" };
                  return (
                    <div key={p.id || i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottom: "1px solid var(--hairline)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "72%" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ 
                            background: colors.bg, 
                            color: colors.fg, 
                            fontSize: 9, 
                            fontWeight: 700, 
                            padding: "2px 6px", 
                            borderRadius: 3,
                            fontFamily: "var(--font-mono)" 
                          }}>
                            {p.action.toUpperCase()}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.filePath}>
                            {getFileBasename(p.filePath)}
                          </span>
                        </div>
                        <span style={{ fontSize: 11, color: "var(--mute)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {getFileDir(p.filePath)}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <span className="badge badge-gray" style={{ fontSize: 8 }}>{p.agent || "system"}</span>
                        <span style={{ fontSize: 10, color: "var(--mute)" }}>{getRelativeTime(p.timestamp)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
