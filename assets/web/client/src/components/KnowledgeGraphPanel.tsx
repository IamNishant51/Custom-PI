import { useState, useEffect } from "react";

interface Triplet {
  id: string;
  subject_id: string;
  subject_label: string;
  subject_type: string;
  predicate_type: string;
  object_id: string;
  object_label: string;
  object_type: string;
  confidence_score: number;
  created_at: number;
  last_updated: number;
}

interface EntityDetail {
  entity: { id: string; label: string; type: string };
  outgoing: Triplet[];
  incoming: Triplet[];
}

export default function KnowledgeGraphPanel() {
  const [triplets, setTriplets] = useState<Triplet[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [minConf, setMinConf] = useState(0.5);
  const [error, setError] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<EntityDetail | null>(null);
  const [entityLoading, setEntityLoading] = useState(false);

  const fetchTriplets = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/knowledge/triplets?minConfidence=${minConf}&limit=100`);
      const d = await res.json();
      if (d.error) { setError(d.error); setTriplets([]); setCount(0); }
      else { setTriplets(d.triplets || []); setCount(d.count || 0); }
    } catch { setError("Failed to fetch triplets"); }
    setLoading(false);
  };

  useEffect(() => { fetchTriplets(); }, []);

  const fetchEntity = async (id: string) => {
    setEntityLoading(true);
    try {
      const res = await fetch(`/api/knowledge/entity?id=${encodeURIComponent(id)}`);
      const d = await res.json();
      if (d.error) setError(d.error);
      else setSelectedEntity(d);
    } catch { setError("Failed to fetch entity"); }
    setEntityLoading(false);
  };

  const typeColor = (type: string) => {
    const colors: Record<string, string> = {
      tool: "#f87171", file: "#34d399", function: "#818cf8",
      class: "#a78bfa", concept: "#fbbf24", dependency: "#fb923c",
      setting: "#94a3b8", person: "#f472b6",
    };
    return colors[type] || "var(--mute)";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 11, color: "var(--mute)" }}>Min Confidence:</label>
          <input
            type="range" min="0" max="1" step="0.1"
            value={minConf}
            onChange={e => setMinConf(parseFloat(e.target.value))}
            style={{ width: 100 }}
          />
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--mute)", minWidth: 30 }}>
            {Math.round(minConf * 100)}%
          </span>
        </div>
        <button className="btn btn-primary" onClick={fetchTriplets} style={{ padding: "4px 12px", fontSize: 11 }}>
          {loading ? "..." : "Refresh"}
        </button>
        <span style={{ fontSize: 11, color: "var(--mute)", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>
          {count} triplets found
        </span>
      </div>

      {error && <div style={{ color: "var(--danger)", fontSize: 12, padding: 8 }}>{error}</div>}

      {selectedEntity ? (
        <div className="card" style={{ marginBottom: 8 }}>
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              Entity: <strong>{selectedEntity.entity.label}</strong>
              <span className="badge badge-gray" style={{ marginLeft: 8, fontSize: 9 }}>{selectedEntity.entity.type}</span>
            </span>
            <button className="btn btn-primary" onClick={() => setSelectedEntity(null)} style={{ padding: "2px 8px", fontSize: 10 }}>
              Back
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "var(--spacing-md)" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--mute)", marginBottom: 8 }}>Outgoing ({selectedEntity.outgoing.length})</div>
              {selectedEntity.outgoing.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--mute)", padding: 8 }}>No outgoing relationships</div>
              ) : (
                selectedEntity.outgoing.map(t => (
                  <div key={t.id} style={{ fontSize: 11, padding: "6px 8px", borderLeft: "2px solid var(--success)", marginBottom: 4, cursor: "pointer", transition: "background 0.15s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    onClick={() => fetchEntity(t.object_id)}
                  >
                    → <strong>{t.object_label}</strong>
                    <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 8 }}>{t.predicate_type}</span>
                    <span style={{ marginLeft: 6, color: "var(--mute)", fontSize: 9 }}>({Math.round(t.confidence_score * 100)}%)</span>
                  </div>
                ))
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--mute)", marginBottom: 8 }}>Incoming ({selectedEntity.incoming.length})</div>
              {selectedEntity.incoming.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--mute)", padding: 8 }}>No incoming relationships</div>
              ) : (
                selectedEntity.incoming.map(t => (
                  <div key={t.id} style={{ fontSize: 11, padding: "6px 8px", borderLeft: "2px solid var(--warning)", marginBottom: 4, cursor: "pointer", transition: "background 0.15s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    onClick={() => fetchEntity(t.subject_id)}
                  >
                    ← <strong>{t.subject_label}</strong>
                    <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 8 }}>{t.predicate_type}</span>
                    <span style={{ marginLeft: 6, color: "var(--mute)", fontSize: 9 }}>({Math.round(t.confidence_score * 100)}%)</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>
        ) : triplets.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--mute)", fontSize: 12 }}>
            No triplets found. The knowledge graph is empty.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Type</th>
                <th>Predicate</th>
                <th>Object</th>
                <th>Type</th>
                <th>Confidence</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {triplets.map(t => (
                <tr key={t.id}>
                  <td>
                    <span style={{ cursor: "pointer", color: "#fff", fontWeight: 500 }}
                      onClick={() => fetchEntity(t.subject_id)}
                      title="Click to explore"
                    >
                      {t.subject_label}
                    </span>
                  </td>
                  <td><span style={{ color: typeColor(t.subject_type), fontSize: 10 }}>{t.subject_type}</span></td>
                  <td><span style={{ color: "var(--warning)" }}>{t.predicate_type}</span></td>
                  <td>
                    <span style={{ cursor: "pointer", color: "#fff", fontWeight: 500 }}
                      onClick={() => fetchEntity(t.object_id)}
                      title="Click to explore"
                    >
                      {t.object_label}
                    </span>
                  </td>
                  <td><span style={{ color: typeColor(t.object_type), fontSize: 10 }}>{t.object_type}</span></td>
                  <td>
                    <span style={{
                      color: t.confidence_score >= 0.8 ? "var(--success)" : t.confidence_score >= 0.5 ? "var(--warning)" : "var(--danger)",
                      fontFamily: "var(--font-mono)", fontSize: 11
                    }}>
                      {Math.round(t.confidence_score * 100)}%
                    </span>
                  </td>
                  <td style={{ fontSize: 10, color: "var(--mute)", fontFamily: "var(--font-mono)" }}>
                    {new Date(t.last_updated).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}