import { useState, useEffect } from "react";

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [memory, setMemory] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/budget/stats").then(r => r.json()).then(setStats).catch(() => {});
    fetch("/api/memory/stats").then(r => r.json()).then(setMemory).catch(() => {});
    fetch("/api/models").then(r => r.json()).then(setModels).catch(() => {});
    fetch("/api/vault/health").then(r => r.json()).then(d => {
      if (d.ok) setVaultHealth(d.message);
    }).catch(() => {});
  }, []);

  const [vaultHealth, setVaultHealth] = useState("");

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Tokens</div>
          <div className="stat-value" style={{ color: "var(--accent-blue)" }}>
            {stats ? stats.totalTokens?.toLocaleString() : "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Cost</div>
          <div className="stat-value" style={{ color: "var(--accent-green)" }}>
            {stats ? `$${stats.totalCostUsd?.toFixed(4)}` : "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sessions</div>
          <div className="stat-value" style={{ color: "var(--accent-orange)" }}>
            {stats ? stats.totalSessions : "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Memory Entries</div>
          <div className="stat-value" style={{ color: "var(--accent-pink)" }}>
            {memory ? memory.totalEntries : "—"}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Available Models</div>
        {models.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}>
            <div className="empty-state-desc">Loading models...</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Provider</th><th>Model ID</th><th>API</th></tr>
            </thead>
            <tbody>
              {models.slice(0, 10).map((m, i) => (
                <tr key={i}><td>{m.provider}</td><td>{m.id}</td><td>{m.api}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {vaultHealth && (
        <div className="card">
          <div className="card-header">Vault Status</div>
          <div style={{ fontSize: 13, color: "var(--accent-green)" }}>{vaultHealth}</div>
        </div>
      )}
    </div>
  );
}
