import { useState, useEffect } from "react";
import { useToast } from "./Toast";

interface MemoryEntry {
  id: string;
  content: string;
  type: string;
  importance: number;
  project: string;
  score?: number;
}

export default function MemoryPanel() {
  const [stats, setStats] = useState<any>(null);
  const [results, setResults] = useState<MemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [storeContent, setStoreContent] = useState("");
  const [storeType, setStoreType] = useState("fact");
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/memory/stats").then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch("/api/memory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, k: 10 }),
      });
      const d = await res.json();
      setResults(d.results || []);
    } catch { toast("Search failed", "error"); }
    setSearching(false);
  };

  const store = async () => {
    if (!storeContent.trim()) return;
    try {
      const res = await fetch("/api/memory/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: storeContent, type: storeType }),
      });
      const d = await res.json();
      if (d.id) {
        toast("Memory stored", "success");
        setStoreContent("");
        fetch("/api/memory/stats").then(r => r.json()).then(setStats).catch(() => {});
      }
    } catch { toast("Failed to store", "error"); }
  };

  return (
    <div>
      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat-card">
          <div className="stat-label">Total Entries</div>
          <div className="stat-value" style={{ color: "var(--accent-blue)", fontSize: 20 }}>{stats?.totalEntries || "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">By Type</div>
          <div style={{ fontSize: 11, marginTop: 4, color: "var(--text-secondary)" }}>
            {stats?.byType ? Object.entries(stats.byType).map(([k, v]) => `${k}: ${v}`).join(", ") : "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Importance</div>
          <div className="stat-value" style={{ color: "var(--accent-orange)", fontSize: 20 }}>{stats?.averageImportance || "—"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">Store Memory</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea className="chat-input" rows={3} placeholder="What to remember..." value={storeContent} onChange={e => setStoreContent(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <select value={storeType} onChange={e => setStoreType(e.target.value)} style={{ flex: 1 }}>
                <option value="fact">Fact</option>
                <option value="decision">Decision</option>
                <option value="preference">Preference</option>
                <option value="pattern">Pattern</option>
                <option value="skill">Skill</option>
              </select>
              <button className="btn btn-primary" onClick={store}>Store</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Search Memory</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" placeholder="Search query..." value={query} onChange={e => setQuery(e.target.value)} style={{ flex: 1 }} onKeyDown={e => e.key === "Enter" && search()} />
            <button className="btn btn-primary" onClick={search} disabled={searching}>{searching ? "..." : "Search"}</button>
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="card">
          <div className="card-header">Search Results</div>
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Type</th><th>Content</th><th>Relevance</th></tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={r.id || i}>
                  <td>{i + 1}</td>
                  <td><span style={{ color: r.type === "decision" ? "var(--accent-orange)" : r.type === "skill" ? "var(--accent-green)" : "var(--accent-blue)" }}>{r.type}</span></td>
                  <td style={{ maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.content}</td>
                  <td>{r.score ? `${(r.score * 100).toFixed(0)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
