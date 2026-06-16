import { useState, useEffect, useCallback } from "react";
import { useToast } from "./Toast";
import ThemeSwitcher from "./ThemeSwitcher";
import { PanelLoadingSpinner, PanelErrorCard } from "./LoadingSkeleton";

export default function SettingsPanel() {
  const [settings, setSettings] = useState<any>({});
  const [models, setModels] = useState<any[]>([]);
  const [detectedProviders, setDetectedProviders] = useState<any[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast } = useToast();

  const [form, setForm] = useState({
    defaultModel: "",
    defaultProvider: "",
    defaultThinkingLevel: "off",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [settingsRes, modelsRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/models"),
      ]);
      const settingsData = await settingsRes.json();
      const modelsData = await modelsRes.json();
      setSettings(settingsData);
      setForm({
        defaultModel: settingsData.defaultModel || "",
        defaultProvider: settingsData.defaultProvider || "",
        defaultThinkingLevel: settingsData.defaultThinkingLevel || "off",
      });
      setModels(Array.isArray(modelsData) ? modelsData : []);
    } catch {
      setLoadError("Failed to load settings");
      toast("Failed to load settings", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const detectModels = useCallback(async () => {
    setDetecting(true);
    setDetectedProviders([]);
    try {
      const res = await fetch("/api/models/check", { method: "POST" });
      const d = await res.json();
      setDetectedProviders(d.providers || []);
      if (d.providers?.length > 0) {
        const msg = d.providers.map((p: any) => `${p.provider}: ${p.models.length} models`).join(", ");
        toast(`Found: ${msg}`, "success");
      } else {
        toast("No local AI servers found. Start LM Studio or Ollama.", "error");
      }
    } catch {
      toast("Failed to detect models", "error");
    }
    setDetecting(false);
  }, [toast]);

  const saveSettings = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      toast("Settings saved", "success");
    } catch {
      toast("Failed to save", "error");
    }
    setSaving(false);
  }, [form, toast]);

  if (loading) return <PanelLoadingSpinner message="Loading settings..." />;
  if (loadError) return <PanelErrorCard message={loadError} onRetry={loadData} />;

  return (
    <div>
      <div className="card">
        <div className="card-header">Theme</div>
        <ThemeSwitcher />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Default Model</div>
          <div className="stat-value" style={{ fontSize: 18 }}>{settings.defaultModel || "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Provider</div>
          <div className="stat-value" style={{ fontSize: 18 }}>{settings.defaultProvider || "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Thinking Level</div>
          <div className="stat-value" style={{ fontSize: 18 }}>{settings.defaultThinkingLevel || "off"}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Model Configuration</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 500 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Default Model ID</label>
            <select value={form.defaultModel} onChange={e => setForm(f => ({ ...f, defaultModel: e.target.value }))} style={{ width: "100%" }}>
              <option value="">— Select model —</option>
              {models.map((m: any, i: number) => (
                <option key={i} value={m.id}>{m.id} ({m.provider})</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Default Provider</label>
            <select value={form.defaultProvider} onChange={e => setForm(f => ({ ...f, defaultProvider: e.target.value }))} style={{ width: "100%" }}>
              <option value="">— Auto —</option>
              <option value="lmstudio">LM Studio</option>
              <option value="ollama">Ollama</option>
              <option value="nvidia">NVIDIA</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Default Thinking Level</label>
            <select value={form.defaultThinkingLevel} onChange={e => setForm(f => ({ ...f, defaultThinkingLevel: e.target.value }))} style={{ width: "100%" }}>
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="high">High</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</button>
            <button className="btn btn-ghost" onClick={detectModels} disabled={detecting}>
              {detecting ? "Detecting..." : "Auto-Detect Local Models"}
            </button>
          </div>
        </div>
      </div>

      {detectedProviders.length > 0 && (
        <div className="card">
          <div className="card-header">Detected Local Providers</div>
          {detectedProviders.map((p: any) => (
            <div key={p.provider} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: "var(--success)" }}>
                {p.provider} -- Reachable
              </div>
              {p.models.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>No models found</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {p.models.map((m: any) => (
                    <span
                      key={m.id}
                      onClick={() => setForm(f => ({ ...f, defaultModel: m.id, defaultProvider: p.provider }))}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "var(--radius-pill)",
                        background: "var(--surface-strong)",
                        border: "1px solid var(--hairline)",
                        fontSize: 12,
                        cursor: "pointer",
                        color: form.defaultModel === m.id ? "var(--ink)" : "var(--body)",
                      }}
                    >
                      {m.id}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-header">All Available Models (from config)</div>
        {models.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}>
            <div className="empty-state-desc">No models configured. Run "Auto-Detect" or check ~/.pi/agent/models.json.</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Model ID</th><th>Provider</th><th>API</th></tr>
            </thead>
            <tbody>
              {models.slice(0, 20).map((m: any, i: number) => (
                <tr key={i} className="stagger-item">
                  <td style={{ fontWeight: 600 }}>{m.id}</td>
                  <td>{m.provider}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{m.api || "openai-completions"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
