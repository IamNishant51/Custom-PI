import { useState, useEffect } from "react";
import { showToast } from "./Toast";
import { PanelLoadingSpinner, PanelErrorCard } from "./LoadingSkeleton";

export default function HealthPanel() {
  const [services, setServices] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [rateLimits, setRateLimits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [servicesRes, metricsRes, limitsRes] = await Promise.all([
        fetch("/api/health/services"),
        fetch("/api/system/resources"),
        fetch("/api/system/rate-limits"),
      ]);
      const [servicesData, metricsData, limitsData] = await Promise.all([
        servicesRes.json(),
        metricsRes.json(),
        limitsRes.json(),
      ]);
      setServices(servicesData.services || []);
      setMetrics(metricsData);
      setRateLimits(limitsData.limits || []);
    } catch {
      setLoadError("Failed to load health data");
      showToast("Failed to load health data", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {loading ? (
        <PanelLoadingSpinner message="Loading health data..." />
      ) : loadError ? (
        <PanelErrorCard message={loadError} onRetry={loadData} />
      ) : (
        <>
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="stat-card">
              <div className="stat-label">CPU</div>
              <div className="stat-value" style={{ fontSize: 20 }}>{metrics?.cpu?.percent ?? "—"}%</div>
              <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 4 }}>{metrics?.cpu?.cores ?? "—"} cores</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Memory</div>
              <div className="stat-value" style={{ fontSize: 20 }}>{metrics?.memory?.percent ?? "—"}%</div>
              <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 4 }}>{metrics?.memory?.used ?? "—"}/{metrics?.memory?.total ?? "—"} MB</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Rate Limited</div>
              <div className="stat-value" style={{ fontSize: 20, color: rateLimits.some(r => r.breached) ? "var(--danger)" : "var(--success)" }}>
                {rateLimits.filter(r => r.breached).length}
              </div>
              <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 4 }}>{rateLimits.length} services tracked</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">External Service Health</div>
            {services.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--mute)" }}>No services monitored yet.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>Service</th><th>Status</th><th>Latency</th><th>Jitter</th><th>Consecutive Failures</th></tr>
                </thead>
                <tbody>
                  {services.map((s: any) => (
                    <tr key={s.service_name}>
                      <td style={{ fontWeight: 500 }}>{s.service_name}</td>
                      <td>
                        <span className={`badge ${s.status === "healthy" ? "badge-green" : "badge-gray"}`}
                          style={{ color: s.status === "healthy" ? "var(--success)" : "var(--danger)" }}>
                          {s.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{(s.latency_ms || 0).toFixed(0)}ms</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{(s.jitter_ms || 0).toFixed(0)}ms</td>
                      <td>{s.consecutive_failures || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
