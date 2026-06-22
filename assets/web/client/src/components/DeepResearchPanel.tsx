import { useState, useEffect, useCallback, useRef } from "react";
import { PanelLoadingSpinner, PanelErrorCard } from "./LoadingSkeleton";

const STORAGE_KEY = "custom-pi.deepResearch";

interface SavedState {
  query: string;
  depth: string;
  status: "idle" | "running" | "done";
  result: any;
  timestamp: number;
}

function loadSavedState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object") return null;
    return {
      query: parsed.query || "",
      depth: parsed.depth || "moderate",
      status: parsed.status || "idle",
      result: parsed.result ?? null,
      timestamp: parsed.timestamp || 0,
    };
  } catch {
    return null;
  }
}

function saveState(state: SavedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota exceeded or serialization errors
  }
}

function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function safeSerializeResult(result: any): any {
  if (!result || typeof result !== "object") return result;
  const safe: Record<string, any> = {};
  for (const [key, value] of Object.entries(result)) {
    if (key === "error" && typeof value === "string") {
      safe[key] = value;
    } else if (["summary", "depth"].includes(key) && typeof value === "string") {
      safe[key] = value;
    } else if (["findings", "sources"].includes(key) && Array.isArray(value)) {
      safe[key] = value.filter(v => typeof v === "string" || (v && typeof v === "object"));
    }
  }
  return safe;
}

export default function DeepResearchPanel() {
  const saved = loadSavedState();
  const hasRestoredRef = useRef(false);

  const [query, setQuery] = useState(saved?.query || "");
  const [depth, setDepth] = useState(saved?.depth || "moderate");
  const [status, setStatus] = useState<"idle" | "running" | "done">(saved?.status || "idle");
  const [result, setResult] = useState<any>(saved?.result ?? null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasRestoredRef.current && saved) {
      hasRestoredRef.current = true;
    }
  }, [saved]);

  useEffect(() => {
    if (hasRestoredRef.current && status !== "idle") {
      saveState({ query, depth, status, result: safeSerializeResult(result), timestamp: Date.now() });
    }
  }, [query, depth, status, result]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // No initial data fetch
    } catch (e: any) {
      setLoadError(e.message || "Failed to load");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const run = async () => {
    if (!query.trim()) return;
    clearState();
    setStatus("running");
    setResult(null);
    try {
      const r = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), depth }),
      });
      const d = await r.json();
      setResult(d);
    } catch (e: any) {
      setResult({ error: e.message });
    }
    setStatus("done");
  };

  const clearResearch = () => {
    clearState();
    setQuery("");
    setDepth("moderate");
    setStatus("idle");
    setResult(null);
  };

  const renderSection = (title: string, content: string) => (
    <div key={title} style={{ marginBottom: 12 }}>
      <h4 style={{ margin: "0 0 4px", color: "var(--accent)" }}>{title}</h4>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{content}</p>
    </div>
  );

  if (loading) return <PanelLoadingSpinner message="Loading research..." />;
  if (loadError) return <PanelErrorCard message={loadError} onRetry={loadData} />;

  return (
    <div className="panel" style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 12px" }}>Deep Research</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input className="input" placeholder="Research query..." value={query} onChange={e => setQuery(e.target.value)}
          style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--text)" }} />
        <select value={depth} onChange={e => setDepth(e.target.value)}
          style={{ padding: "8px", borderRadius: 6, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--text)" }}>
          <option value="quick">Quick</option>
          <option value="moderate">Moderate</option>
          <option value="deep">Deep</option>
        </select>
        <button className="btn" onClick={run} disabled={status === "running"}>
          {status === "running" ? "Researching..." : "Go"}
        </button>
        {(status === "done" || status === "running") && (
          <button className="btn btn-secondary" onClick={clearResearch} disabled={status === "running"}>
            Clear
          </button>
        )}
      </div>
      {status === "running" && (
        <div style={{ padding: 32, textAlign: "center", color: "var(--mute)" }}>
          <div className="loading-wave"><span></span><span></span><span></span><span></span></div>
          <div style={{ marginTop: 8 }}>Analyzing sources...</div>
        </div>
      )}
      {result && status === "done" && (
        <div style={{ marginTop: 12 }}>
          {result.error ? (
            <div style={{ color: "var(--danger)", padding: 12, border: "1px solid var(--danger)", borderRadius: 6 }}>{result.error}</div>
          ) : (
            <>
              {result.summary && renderSection("Summary", result.summary)}
              {result.findings && Array.isArray(result.findings) && result.findings.map((f: any) =>
                typeof f === "string" ? renderSection("Finding", f) : renderSection(f.title || "Finding", f.content || f)
              )}
              {result.sources && (
                <div style={{ marginTop: 8 }}>
                  <h4 style={{ margin: "0 0 4px", color: "var(--accent)" }}>Sources</h4>
                  <ul style={{ margin: 0, fontSize: 12 }}>
                    {result.sources.map((s: string, i: number) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {status === "idle" && (
        <div style={{ padding: 32, textAlign: "center", color: "var(--mute)" }}>
          Enter a research topic to begin deep analysis across web sources.
        </div>
      )}
    </div>
  );
}
