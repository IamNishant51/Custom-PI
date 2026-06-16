import { useState, useEffect, useRef } from "react";
import { showToast } from "./Toast";
import { PanelLoadingSpinner, PanelErrorCard } from "./LoadingSkeleton";

interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  color?: string;
}

function ProgressBar({ value, max, label, color }: ProgressBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const barColor = pct > 90 ? "var(--danger)" : pct > 75 ? "var(--warning)" : (color || "var(--primary)");
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span>{label}</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 4, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

interface TrendPoint {
  date: string;
  tokens: number;
  costUsd: number;
}

interface TrendSparklineProps {
  data: TrendPoint[];
  height?: number;
  width?: number;
}

function TrendSparkline({ data, height = 40, width = 200 }: TrendSparklineProps) {
  if (!data || data.length < 2) return <span style={{ color: "var(--muted)" }}>Insufficient data</span>;
  const values = data.map(d => d.costUsd);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth={2} />
      {values.map((v, i) => {
        const x = (i / (values.length - 1)) * width;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return <circle key={i} cx={x} cy={y} r={2.5} fill="var(--primary)" />;
      })}
    </svg>
  );
}

interface BudgetStats {
  totalSessions: number;
  totalTokens: number;
  totalCostUsd: number;
  dailyTokens: number;
  dailyCostUsd: number;
  today: string;
}

interface ModelCost {
  modelId: string;
  provider: string;
  tokens: number;
  costUsd: number;
  calls: number;
}

interface SessionInfo {
  sessionId: string;
  tokens: number;
  costUsd: number;
  calls: number;
  lastActive: string;
}

interface BudgetDetails {
  models: ModelCost[];
  sessions: SessionInfo[];
  dailyTrend: TrendPoint[];
  totalCostUsd: number;
  totalTokens: number;
}

interface BudgetConfig {
  maxSessionTokens: number;
  maxDailyTokens: number;
  maxSessionCostUsd?: number;
  maxDailyCostUsd?: number;
  warningThreshold: number;
}

export default function BudgetPanel() {
  const [stats, setStats] = useState<BudgetStats | null>(null);
  const [details, setDetails] = useState<BudgetDetails | null>(null);
  const [config, setConfig] = useState<BudgetConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ maxSessionTokens: 500000, maxDailyTokens: 2000000, maxSessionCostUsd: 2, maxDailyCostUsd: 5, warningThreshold: 0.8 });
  const wsRef = useRef<WebSocket | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [statsRes, detailsRes, configRes] = await Promise.all([
        fetch("/api/budget/stats"),
        fetch("/api/budget/details"),
        fetch("/api/budget/config"),
      ]);
      const statsData = await statsRes.json();
      const detailsData = await detailsRes.json();
      const configData = await configRes.json();
      setStats(statsData);
      setDetails(detailsData);
      setConfig(configData);
      setForm({
        maxSessionTokens: configData.maxSessionTokens,
        maxDailyTokens: configData.maxDailyTokens,
        maxSessionCostUsd: configData.maxSessionCostUsd || 2,
        maxDailyCostUsd: configData.maxDailyCostUsd || 5,
        warningThreshold: configData.warningThreshold || 0.8,
      });
    } catch {
      setLoadError("Failed to load budget data");
      showToast("Failed to load budget data", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProto}//${location.host}/ws`);
    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as Record<string, unknown>;
        if (msg.type === "cost" || msg.type === "budget") fetchData();
      } catch {}
    };
    ws.onclose = () => setTimeout(fetchData, 5000);
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  const saveConfig = async () => {
    try {
      await fetch("/api/budget/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setEditMode(false);
      fetchData();
      showToast("Budget config saved", "success");
    } catch { showToast("Failed to save budget config", "error"); }
  };

  const statCards = !stats ? [] : [
    { label: "Total Cost", value: `$${stats.totalCostUsd.toFixed(4)}`, sub: `${stats.totalTokens.toLocaleString()} tokens` },
    { label: "Today Cost", value: `$${stats.dailyCostUsd.toFixed(4)}`, sub: `${stats.dailyTokens.toLocaleString()} tokens today` },
    { label: "Sessions", value: stats.totalSessions, sub: "total sessions" },
    { label: "Avg Cost / Session", value: stats.totalSessions ? `$${(stats.totalCostUsd / stats.totalSessions).toFixed(4)}` : "—", sub: "per session avg" },
  ];

  const modelColors: Record<string, string> = {};
  const palette = ["var(--primary)", "var(--warning)", "var(--danger)", "var(--success)", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

  return (
    <div>
      {loading ? (
        <PanelLoadingSpinner message="Loading budget data..." />
      ) : loadError ? (
        <PanelErrorCard message={loadError} onRetry={fetchData} />
      ) : (
        <>
          {statCards.length > 0 && (
            <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
              {statCards.map((c, i) => (
                <div className="stat-card" key={i}>
                  <div className="stat-label">{c.label}</div>
                  <div className="stat-value">{c.value}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{c.sub}</div>
                </div>
              ))}
            </div>
          )}

          {config && stats && (
            <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <ProgressBar value={stats.dailyTokens} max={config.maxDailyTokens} label="Daily Token Usage" color="var(--primary)" />
              </div>
              <div style={{ flex: 1 }}>
                <ProgressBar value={stats.dailyCostUsd} max={config.maxDailyCostUsd || 5} label="Daily Cost Budget" color="var(--warning)" />
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">Cost by Model</div>
              {details?.models?.length ? (
                <div>
                  {details.models.slice(0, 6).map((m, i) => {
                    modelColors[m.modelId] = modelColors[m.modelId] || palette[i % palette.length];
                    const maxCost = details.models[0]?.costUsd || 1;
                    return (
                      <div key={m.modelId} style={{ marginBottom: 10, fontSize: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontWeight: 600 }}>{m.modelId.split("/").pop()}</span>
                          <span>${m.costUsd.toFixed(4)} ({m.calls} calls)</span>
                        </div>
                        <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(m.costUsd / maxCost) * 100}%`, background: modelColors[m.modelId], borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: "var(--muted)", fontSize: 13 }}>No cost data yet</div>
              )}
            </div>
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">Daily Trend (30d)</div>
              {details?.dailyTrend && details.dailyTrend.length > 1 ? (
                <div style={{ textAlign: "center" }}>
                  <TrendSparkline data={details.dailyTrend} height={50} width={260} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    <span>{details.dailyTrend[0]?.date}</span>
                    <span>{details.dailyTrend[details.dailyTrend.length - 1]?.date}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    Last 7d: ${details.dailyTrend.slice(-7).reduce((s, d) => s + d.costUsd, 0).toFixed(4)}
                  </div>
                </div>
              ) : (
                <div style={{ color: "var(--muted)", fontSize: 13 }}>Need 2+ days of data</div>
              )}
            </div>
          </div>

          {details?.sessions && details.sessions.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">Recent Sessions</div>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Session</th>
                    <th style={{ textAlign: "right", padding: "6px 8px" }}>Tokens</th>
                    <th style={{ textAlign: "right", padding: "6px 8px" }}>Cost</th>
                    <th style={{ textAlign: "right", padding: "6px 8px" }}>Calls</th>
                    <th style={{ textAlign: "right", padding: "6px 8px" }}>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {details.sessions.slice(0, 8).map(s => (
                    <tr key={s.sessionId} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: 11 }}>{s.sessionId.slice(0, 16)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px" }}>{s.tokens.toLocaleString()}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px" }}>${s.costUsd.toFixed(4)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px" }}>{s.calls}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", color: "var(--muted)", fontSize: 11 }}>{new Date(s.lastActive).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <div className="card-header">Budget Configuration</div>
            {editMode ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 500 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Max Session Tokens</label>
                  <input type="number" value={form.maxSessionTokens} onChange={e => setForm(f => ({ ...f, maxSessionTokens: parseInt(e.target.value) || 0 }))} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Max Daily Tokens</label>
                  <input type="number" value={form.maxDailyTokens} onChange={e => setForm(f => ({ ...f, maxDailyTokens: parseInt(e.target.value) || 0 }))} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Max Daily Cost ($)</label>
                  <input type="number" step="0.5" min="0" value={form.maxDailyCostUsd} onChange={e => setForm(f => ({ ...f, maxDailyCostUsd: parseFloat(e.target.value) || 0 }))} />
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>Max Session Tokens: <strong>{(config?.maxSessionTokens || 500000).toLocaleString()}</strong></div>
                  <div>Max Daily Tokens: <strong>{(config?.maxDailyTokens || 2000000).toLocaleString()}</strong></div>
                  <div>Max Daily Cost: <strong>${(config?.maxDailyCostUsd || 5).toFixed(2)}</strong></div>
                  <div>Warning at: <strong>{((config?.warningThreshold || 0.8) * 100).toFixed(0)}%</strong></div>
                </div>
                <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setEditMode(true)}>Edit</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
