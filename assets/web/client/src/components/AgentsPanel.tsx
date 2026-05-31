import { useState, useEffect, useCallback } from "react";
import { useToast } from "./Toast";

interface DiscoveredAgent {
  name: string;
  command: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

export default function AgentsPanel() {
  const [agents, setAgents] = useState<DiscoveredAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<DiscoveredAgent | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    fetch("/api/agents/discover")
      .then(r => r.json())
      .then(d => setAgents(d.agents || []))
      .catch(() => toast("Failed to discover agents", "error"))
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setSelectedAgent(null);
    fetch("/api/agents/discover")
      .then(r => r.json())
      .then(d => setAgents(d.agents || []))
      .catch(() => toast("Failed to discover agents", "error"))
      .finally(() => setLoading(false));
  }, []);

  const available = agents.filter(a => a.available);
  const unavailable = agents.filter(a => !a.available);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Agent Discovery</h2>
        <button className="btn btn-sm" onClick={refresh} disabled={loading}>
          {loading ? "Scanning..." : "Rescan"}
        </button>
      </div>

      {selectedAgent && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span>{selectedAgent.name}</span>
            <button className="btn btn-xs" onClick={() => setSelectedAgent(null)}>Close</button>
          </div>
          <div className="card-body">
            <div className="field-row"><label>Command</label><code>{selectedAgent.command}</code></div>
            <div className="field-row"><label>Status</label><span style={{ color: selectedAgent.available ? "var(--success)" : "var(--danger)" }}>{selectedAgent.available ? "Available" : "Not Found"}</span></div>
            <div className="field-row"><label>Path</label><code>{selectedAgent.path || "\u2014"}</code></div>
            <div className="field-row"><label>Version</label><code>{selectedAgent.version || "\u2014"}</code></div>
          </div>
        </div>
      )}

      {loading && <div style={{ padding: 20, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>}

      {!loading && (
        <>
          <div className="section-label">Available ({available.length})</div>
          {available.length === 0 && <div className="empty-state">No agents discovered on PATH</div>}
          {available.map(a => (
            <div
              key={a.name}
              className={`list-item ${selectedAgent?.name === a.name ? "active" : ""}`}
              onClick={() => setSelectedAgent(a)}
            >
              <div className="list-item-primary">
                <span className="status-dot" style={{ background: "var(--success)" }} />
                <span>{a.name}</span>
              </div>
              <div className="list-item-secondary">{a.path}</div>
            </div>
          ))}

          {unavailable.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 24 }}>Not Installed ({unavailable.length})</div>
              {unavailable.map(a => (
                <div
                  key={a.name}
                  className={`list-item ${selectedAgent?.name === a.name ? "active" : ""}`}
                  onClick={() => setSelectedAgent(a)}
                >
                  <div className="list-item-primary">
                    <span className="status-dot" style={{ background: "var(--danger)" }} />
                    <span style={{ opacity: 0.5 }}>{a.name}</span>
                  </div>
                  <div className="list-item-secondary"><code>{a.command}</code></div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
