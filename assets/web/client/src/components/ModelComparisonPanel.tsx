import { useState, useEffect, useCallback } from "react";
import { PanelLoadingSpinner, PanelErrorCard } from "./LoadingSkeleton";

interface ModelOption { id: string; provider: string; }
interface ModelResult { model: string; provider: string; response: string; latencyMs: number; error?: string; }

export default function ModelComparisonPanel() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState<ModelResult[]>([]);
  const [running, setRunning] = useState(false);
  const [blindMode, setBlindMode] = useState(false);
  const [promptId, setPromptId] = useState(0);
  const [voteStats, setVoteStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [modelsRes, voteRes] = await Promise.all([
        fetch("/api/models"),
        fetch("/api/models/vote-stats"),
      ]);
      const modelsData = await modelsRes.json();
      const voteData = await voteRes.json();
      const all = (modelsData.models || []).map((m: any) => ({ id: m.id, provider: m.api || "unknown" }));
      setModels(all);
      setVoteStats(voteData.rankings || []);
    } catch {
      setLoadError("Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const compare = async () => {
    if (!prompt.trim() || selected.length < 2) return;
    setRunning(true); setResults([]);
    const res: ModelResult[] = [];
    for (const modelId of selected) {
      const start = Date.now();
      try {
        const r = await fetch("/api/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: prompt }], stream: false }),
        });
        const d = await r.json();
        res.push({
          model: modelId,
          provider: models.find(m => m.id === modelId)?.provider || "?",
          response: d.choices?.[0]?.message?.content || d.content || JSON.stringify(d),
          latencyMs: Date.now() - start,
        });
      } catch (e: any) {
        res.push({ model: modelId, provider: "?", response: "", latencyMs: Date.now() - start, error: e.message });
      }
    }
    setResults(res); setRunning(false);
    setPromptId(prev => prev + 1);
  };

  const vote = async (winner: string, loser: string | null) => {
    await fetch("/api/models/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptId: `p_${promptId}`, winner, loser }) });
    const d = await fetch("/api/models/vote-stats").then(r => r.json());
    setVoteStats(d.rankings || []);
  };

  if (loading) return <PanelLoadingSpinner message="Loading models..." />;
  if (loadError) return <PanelErrorCard message={loadError} onRetry={loadData} />;

  return (
    <div className="panel" style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 12px" }}>Model Comparison</h2>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "var(--mute)", marginBottom: 6 }}>Select 2+ models:</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {models.map(m => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, border: `1px solid ${selected.includes(m.id) ? "var(--accent)" : "var(--hairline)"}`, cursor: "pointer", fontSize: 12 }}>
              <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
              <span style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.id}</span>
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <textarea className="input" placeholder="Enter prompt to compare across selected models..." value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
          style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--text)", resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button className="btn" onClick={compare} disabled={running || selected.length < 2 || !prompt.trim()}>
          {running ? "Running..." : `Compare (${selected.length} models)`}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={blindMode} onChange={e => setBlindMode(e.target.checked)} />
          Blind mode (hide model names)
        </label>
      </div>
      {results.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {results.map((r, i) => (
              <div key={i} style={{ flex: "1 1 300px", padding: 12, border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--surface)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <strong>{blindMode ? `Model ${String.fromCharCode(65 + i)}` : r.model}</strong>
                  <span style={{ fontSize: 11, color: "var(--mute)" }}>{r.latencyMs}ms</span>
                </div>
                {r.error ? (
                  <div style={{ color: "var(--danger)", fontSize: 13 }}>{r.error}</div>
                ) : (
                  <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 300, overflowY: "auto" }}>{r.response}</div>
                )}
                {!r.error && (
                  <div style={{ display: "flex", gap: 4, marginTop: 8, borderTop: "1px solid var(--hairline)", paddingTop: 6 }}>
                    <button className="btn" onClick={() => vote(r.model, null)} style={{ fontSize: 11, padding: "2px 8px" }}>👍 Best</button>
                    {results.filter(x => x.model !== r.model && !x.error).map(other => (
                      <button key={other.model} className="btn" onClick={() => vote(r.model, other.model)} style={{ fontSize: 10, padding: "2px 6px" }}>vs {blindMode ? "?" : other.model.split("/").pop()}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {voteStats.length > 0 && (
            <div style={{ marginTop: 16, padding: 12, border: "1px solid var(--hairline)", borderRadius: 8 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Vote Rankings</h4>
              {voteStats.map((s: any, i: number) => (
                <div key={s.model} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
                  <span>#{i + 1} {s.model.split("/").pop()}</span>
                  <span>{s.wins}W / {s.losses}L — {s.winRate}%</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
