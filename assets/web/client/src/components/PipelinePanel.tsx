import { useState, useEffect, useCallback } from "react";
import { PanelLoadingSpinner, PanelErrorCard } from "./LoadingSkeleton";

export default function PipelinePanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const r = await fetch("/api/pipeline/status");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setData(d);
    } catch (e: any) {
      setLoadError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <PanelLoadingSpinner message="Loading pipeline..." />;
  if (loadError) return <PanelErrorCard message={loadError} onRetry={loadData} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-header">Deployment Pipeline</div>
        {!data?.deployments?.length ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--mute)" }}>No deployments yet</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>ID</th><th>Branch</th><th>Target</th><th>Stage</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.deployments.map((d: any) => (
                <tr key={d.id}>
                  <td style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}>{d.id.slice(0, 16)}</td>
                  <td>{d.branch}</td>
                  <td><span className="badge badge-purple">{d.target}</span></td>
                  <td>{d.stages?.[d.currentStage] || d.currentStage}/{d.stages?.length || "?"}</td>
                  <td>
                    <span className={`badge ${d.stageStatus === "completed" ? "badge-green" : d.stageStatus === "failed" || d.stageStatus === "rolled_back" ? "" : "badge-yellow"}`}
                      style={{ color: d.stageStatus === "failed" ? "var(--danger)" : d.stageStatus === "rolled_back" ? "var(--warning)" : "inherit" }}>
                      {d.stageStatus}
                    </span>
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
