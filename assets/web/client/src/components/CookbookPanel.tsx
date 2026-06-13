import { useState, useEffect } from "react";

interface ModelInfo {
  id: string; provider: string; size?: string; quantization?: string;
}

export default function CookbookPanel() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/models")
      .then(r => r.json())
      .then(d => setModels(d.models || []))
      .catch(() => {});
    fetch("/api/model-providers")
      .then(r => r.json())
      .then(d => setProviders(d.providers || []))
      .catch(() => {});
  }, []);

  const filtered = models.filter(m => !search || m.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="panel" style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 8px" }}>Model Cookbook</h2>
      <input className="input" placeholder="Search models..." value={search} onChange={e => setSearch(e.target.value)}
        style={{ width: "100%", marginBottom: 12, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--text)" }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {providers.map(p => (
          <div key={p.provider} style={{ padding: "4px 10px", borderRadius: 12, border: "1px solid var(--hairline)", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.reachable ? "var(--success)" : "var(--danger)" }} />
            {p.provider}{p.models?.length ? ` (${p.models.length})` : ""}
          </div>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--mute)" }}>No models found.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {filtered.map(m => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 12px", border: "1px solid var(--hairline)", borderRadius: 6 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.id}</div>
                <div style={{ fontSize: 11, color: "var(--mute)" }}>{m.provider}{m.size ? ` · ${m.size}` : ""}{m.quantization ? ` · ${m.quantization}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
