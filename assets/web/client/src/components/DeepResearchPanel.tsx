import { useState } from "react";

export default function DeepResearchPanel() {
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState("moderate");
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    if (!query.trim()) return;
    setStatus("running");
    try {
      const r = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), depth }),
      });
      const d = await r.json();
      setResult(d);
    } catch (e: any) { setResult({ error: e.message }); }
    setStatus("done");
  };

  const renderSection = (title: string, content: string) => (
    <div key={title} style={{ marginBottom: 12 }}>
      <h4 style={{ margin: "0 0 4px", color: "var(--accent)" }}>{title}</h4>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{content}</p>
    </div>
  );

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
