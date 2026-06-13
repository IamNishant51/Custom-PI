import { useState, useEffect } from "react";

type AdminTab = "logs" | "performance" | "auth";

interface Token { id: string; name: string; created_at: string; }

export default function AdminPanel() {
  const [tab, setTab] = useState<AdminTab>("logs");
  const [logs, setLogs] = useState<any[]>([]);
  const [perf, setPerf] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokenName, setTokenName] = useState("");

  const fetchLogs = async () => {
    try { const r = await fetch("/api/admin/logs"); const d = await r.json(); setLogs(d.logs || []); } catch {}
  };
  const fetchPerf = async () => {
    try { const r = await fetch("/api/admin/performance"); setPerf(await r.json()); } catch {}
  };
  const fetchMe = async () => {
    try { const r = await fetch("/api/auth/me"); setMe(await r.json()); } catch {}
  };
  const fetchTokens = async () => {
    try { const r = await fetch("/api/auth/tokens"); const d = await r.json(); setTokens(d.tokens || []); } catch {}
  };

  useEffect(() => {
    if (tab === "logs") fetchLogs();
    else if (tab === "performance") fetchPerf();
    else { fetchMe(); fetchTokens(); }
  }, [tab]);

  const createToken = async () => {
    if (!tokenName.trim()) return;
    await fetch("/api/auth/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tokenName }) });
    setTokenName(""); fetchTokens();
  };

  const deleteToken = async (id: string) => {
    await fetch(`/api/auth/tokens/${id}`, { method: "DELETE" });
    fetchTokens();
  };

  const tabs: { key: AdminTab; label: string }[] = [
    { key: "logs", label: "Logs" },
    { key: "performance", label: "Performance" },
    { key: "auth", label: "Auth" },
  ];

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabs.map(t => (
          <button key={t.key} className={`btn ${tab === t.key ? "btn-primary" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === "logs" && (
        <div style={{ maxHeight: 500, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {logs.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--mute)" }}>No logs.</div>
          ) : (
            logs.map((l, i) => (
              <pre key={i} style={{ margin: 0, padding: "4px 8px", fontSize: 11, fontFamily: "monospace", background: i % 2 === 0 ? "var(--surface)" : "transparent", borderRadius: 2, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {JSON.stringify(l)}
              </pre>
            ))
          )}
        </div>
      )}

      {tab === "performance" && (
        <div>
          {!perf ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--mute)" }}>Loading...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="stat-card">
                <div className="stat-label">Avg Duration</div>
                <div className="stat-value" style={{ fontSize: 20 }}>{(perf.avg_duration_ms || 0).toFixed(1)}ms</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Slowest Request</div>
                <div className="stat-value" style={{ fontSize: 20 }}>{(perf.slowest_duration_ms || 0).toFixed(1)}ms</div>
                {perf.slowest_path && <div style={{ fontSize: 11, color: "var(--mute)", fontFamily: "monospace", marginTop: 4 }}>{perf.slowest_path}</div>}
              </div>
              {perf.endpoints && (
                <div>
                  <div className="card-header" style={{ marginBottom: 8 }}>Endpoints</div>
                  <table className="data-table">
                    <thead><tr><th>Path</th><th>Count</th><th>Avg</th><th>Slowest</th></tr></thead>
                    <tbody>
                      {perf.endpoints.map((ep: any) => (
                        <tr key={ep.path}><td style={{ fontFamily: "monospace", fontSize: 12 }}>{ep.path}</td><td>{ep.count}</td><td>{(ep.avg_ms || 0).toFixed(0)}ms</td><td>{(ep.slowest_ms || 0).toFixed(0)}ms</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "auth" && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">Session</div>
            {me ? (
              <pre style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text)", margin: 0 }}>{JSON.stringify(me, null, 2)}</pre>
            ) : (
              <div style={{ color: "var(--mute)" }}>Not authenticated</div>
            )}
          </div>
          <div className="card">
            <div className="card-header">API Tokens</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input className="input" placeholder="Token name" value={tokenName} onChange={e => setTokenName(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={createToken}>Create</button>
            </div>
            {tokens.map(t => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--hairline)" }}>
                <div><div style={{ fontSize: 13 }}>{t.name}</div><div style={{ fontSize: 11, color: "var(--mute)" }}>{t.created_at}</div></div>
                <button className="btn" onClick={() => deleteToken(t.id)} style={{ color: "var(--danger)" }}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
