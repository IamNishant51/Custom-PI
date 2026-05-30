import { useState, useEffect } from "react";

interface WorkProduct {
  id: string;
  action: string;
  agent: string;
  filePath: string;
  task: string;
  timestamp: string;
}

export default function WorkProductsPanel() {
  const [products, setProducts] = useState<WorkProduct[]>([]);
  const [summary, setSummary] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "summary">("list");

  useEffect(() => {
    fetch("/api/work-products")
      .then(r => r.json())
      .then(d => setProducts(d.products || []))
      .catch(() => {});
    fetch("/api/work-products?summary=true")
      .then(r => r.json())
      .then(d => setSummary(d.summary || ""))
      .catch(() => {});
  }, []);

  const actionColors: Record<string, string> = {
    create: "var(--accent-green)",
    modify: "var(--accent-orange)",
    read: "var(--accent-blue)",
    delete: "var(--accent-red)",
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={`btn ${viewMode === "list" ? "btn-primary" : "btn-ghost"}`} onClick={() => setViewMode("list")}>List View</button>
        <button className={`btn ${viewMode === "summary" ? "btn-primary" : "btn-ghost"}`} onClick={() => setViewMode("summary")}>Summary</button>
      </div>

      {viewMode === "list" ? (
        <div className="card">
          <div className="card-header">Work Products ({products.length})</div>
          {products.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}>
              <div className="empty-state-desc">No work products recorded yet. Start a chat session to track file operations.</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Action</th><th>File</th><th>Agent</th><th>Time</th></tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={p.id || i}>
                    <td><span style={{ color: actionColors[p.action] || "var(--text-primary)", fontWeight: 600 }}>{p.action}</span></td>
                    <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 12 }}>{p.filePath}</td>
                    <td>{p.agent}</td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.timestamp ? new Date(p.timestamp).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="card-header">Summary</div>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{summary || "No summary available."}</div>
        </div>
      )}
    </div>
  );
}
