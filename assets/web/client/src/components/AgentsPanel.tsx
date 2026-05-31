import { useState, useEffect, useCallback } from "react";
import { useToast } from "./Toast";
import { AsciiRefresh, AsciiEye } from "./Icons";

interface DiscoveredAgent {
  name: string;
  command: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

function AgentCard({ agent }: { agent: DiscoveredAgent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`card ${agent.available ? "" : "card-dim"}`} style={{ marginBottom: 8 }}>
      <div className="card-header" style={{ cursor: "pointer" }} onClick={() => setExpanded(o => !o)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className={`status-dot pulse-${agent.available ? "ok" : "mute"}`} style={{ width: 10, height: 10, background: agent.available ? "var(--success)" : "var(--hairline)" }} />
          <span style={{ fontWeight: 600, opacity: agent.available ? 1 : 0.5 }}>{agent.name}</span>
          {agent.available ? (
            <span className="badge badge-ok">installed</span>
          ) : (
            <span className="badge badge-mute">not found</span>
          )}
          {agent.version && <span className="badge" style={{ background: "var(--surface2)", color: "var(--text)" }}>{agent.version}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--mute)" }}>{expanded ? "[-]" : "[+]"}</span>
        </div>
      </div>
      {expanded && (
        <div className="card-body" style={{ borderTop: "1px solid var(--hairline)" }}>
          {agent.path && (
            <div className="field-row"><label>Path</label><code style={{ fontSize: 12, wordBreak: "break-all" }}>{agent.path}</code></div>
          )}
          <div className="field-row"><label>Command</label><code>{agent.command}</code></div>
          {agent.version && <div className="field-row"><label>Version</label><code>{agent.version}</code></div>}
        </div>
      )}
    </div>
  );
}

export default function AgentsPanel() {
  const [agents, setAgents] = useState<DiscoveredAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/agents/discover");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setAgents(d.agents || []);
    } catch (e: any) {
      setError(e.message || "Failed to discover agents");
      toast("Failed to discover agents", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, []);

  const available = agents.filter(a => a.available);
  const unavailable = agents.filter(a => !a.available);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Agent Discovery</h2>
        <button className="btn btn-sm" onClick={fetchAgents} disabled={loading}>
          {loading ? "Scanning..." : "Rescan"}
        </button>
      </div>

      <div style={{ padding: "8px 0" }}>
        <div className="stat-row">
          <div className="stat"><span className="stat-value" style={{ color: "var(--success)" }}>{available.length}</span><span className="stat-label">Available</span></div>
          <div className="stat"><span className="stat-value">{agents.length}</span><span className="stat-label">Known</span></div>
          <div className="stat"><span className="stat-value" style={{ color: "var(--mute)" }}>{unavailable.length}</span><span className="stat-label">Not Installed</span></div>
        </div>
      </div>

      {error && (
        <div className="card card-error" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <span style={{ color: "var(--danger)" }}>Failed to discover agents: {error}</span>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: 32, textAlign: "center" }}>
          <div className="loading-spinner" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 13, color: "var(--mute)" }}>Checking installed CLI agents...</div>
        </div>
      )}

      {!loading && !error && (
        <>
          {available.length > 0 && (
            <>
              <div className="section-label">Installed ({available.length})</div>
              {available.map(a => <AgentCard key={a.name} agent={a} />)}
            </>
          )}

          {unavailable.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 20 }}>Not Installed ({unavailable.length})</div>
              {unavailable.map(a => <AgentCard key={a.name} agent={a} />)}
            </>
          )}
        </>
      )}
    </div>
  );
}
