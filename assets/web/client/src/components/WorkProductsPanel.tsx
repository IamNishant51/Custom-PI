import { useState, useEffect, useCallback } from "react";
import Markdown from "./Markdown";
import { showToast } from "./Toast";
import { PanelLoadingSpinner, PanelErrorCard } from "./LoadingSkeleton";

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [productsRes, summaryRes] = await Promise.all([
        fetch("/api/work-products"),
        fetch("/api/work-products?summary=true"),
      ]);
      const productsData = await productsRes.json();
      const summaryData = await summaryRes.json();
      setProducts(productsData.products || []);
      setSummary(summaryData.summary || "");
    } catch {
      setLoadError("Failed to load work products");
      showToast("Failed to load work products", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const actionColors: Record<string, string> = {
    create: "var(--success)",
    modify: "var(--ink)",
    read: "var(--charcoal)",
    delete: "var(--danger)",
  };

  if (loading) return <PanelLoadingSpinner message="Loading work products..." />;
  if (loadError) return <PanelErrorCard message={loadError} onRetry={loadData} />;

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
                    <td><span style={{ color: actionColors[p.action] || "var(--ink)", fontWeight: 500 }}>{p.action}</span></td>
                    <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 12 }}>{p.filePath}</td>
                    <td>{p.agent}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{p.timestamp ? new Date(p.timestamp).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="card-header">Summary</div>
          <Markdown content={summary || "No summary available."} />
        </div>
      )}
    </div>
  );
}
