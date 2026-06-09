import { useState, useEffect } from "react";
import { showToast } from "./Toast";

export default function BudgetPanel() {
  const [stats, setStats] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ maxSessionTokens: 500000, maxDailyTokens: 2000000, warningThreshold: 0.8 });

  const fetchData = () => {
    fetch("/api/budget/stats").then(r => r.json()).then(setStats).catch(() => showToast("Failed to load budget stats", "error"));
    fetch("/api/budget/config").then(r => r.json()).then(d => { setConfig(d); setForm({ maxSessionTokens: d.maxSessionTokens, maxDailyTokens: d.maxDailyTokens, warningThreshold: d.warningThreshold || 0.8 }); }).catch(() => showToast("Failed to load budget config", "error"));
  };

  useEffect(() => { fetchData(); }, []);

  const saveConfig = async () => {
    try {
      await fetch("/api/budget/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setEditMode(false);
      fetchData();
    } catch { showToast("Failed to save budget config", "error"); }
  };

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Tokens</div>
          <div className="stat-value">{stats?.totalTokens?.toLocaleString() || "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Cost</div>
          <div className="stat-value">${stats?.totalCostUsd?.toFixed(4) || "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Today Tokens</div>
          <div className="stat-value">{stats?.dailyTokens?.toLocaleString() || "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Today Cost</div>
          <div className="stat-value">${stats?.dailyCostUsd?.toFixed(4) || "—"}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Budget Configuration</div>
        {editMode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 400 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Max Session Tokens</label>
<input type="number" value={form.maxSessionTokens} onChange={e => setForm(f => ({ ...f, maxSessionTokens: parseInt(e.target.value) || 0 }))} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Max Daily Tokens</label>
<input type="number" value={form.maxDailyTokens} onChange={e => setForm(f => ({ ...f, maxDailyTokens: parseInt(e.target.value) || 0 }))} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Warning Threshold</label>
              <input type="number" step="0.1" min="0" max="1" value={form.warningThreshold} onChange={e => setForm(f => ({ ...f, warningThreshold: parseFloat(e.target.value) || 0.8 }))} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={saveConfig}>Save</button>
              <button className="btn btn-ghost" onClick={() => setEditMode(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13 }}>
            <div style={{ marginBottom: 6 }}>Max Session Tokens: <strong>{(config?.maxSessionTokens || 500000).toLocaleString()}</strong></div>
            <div style={{ marginBottom: 6 }}>Max Daily Tokens: <strong>{(config?.maxDailyTokens || 2000000).toLocaleString()}</strong></div>
            <div style={{ marginBottom: 12 }}>Warning at: <strong>{((config?.warningThreshold || 0.8) * 100).toFixed(0)}%</strong></div>
            <button className="btn btn-ghost" onClick={() => setEditMode(true)}>Edit</button>
          </div>
        )}
      </div>
    </div>
  );
}
