export function renderCeoLine(log: string, i: number) {
  const lower = log.toLowerCase();
  if (lower.startsWith("team plan") || lower.includes("assembling") || lower.includes("deployed")) {
    return (
      <div key={i} className="ceo-plan-omp">
        <div className="ceo-plan-header">⚙ Plan</div>
        <div className="ceo-plan-body">{log}</div>
      </div>
    );
  }
  if (lower.includes("complete") || lower.startsWith("swarm") || lower.includes("campaign") || lower.includes("final")) {
    return (
      <div key={i} className="ceo-thought-omp summary">
        <div className="ceo-thought-header">✓ Summary</div>
        <div className="ceo-thought-body">{log}</div>
      </div>
    );
  }
  if (lower.startsWith("initialized") || lower.startsWith("launching")) {
    return (
      <div key={i} className="ceo-thought-omp" style={{ opacity: 0.7 }}>
        <div className="ceo-thought-header">⟳ Init</div>
        <div className="ceo-thought-body">{log}</div>
      </div>
    );
  }
  if (lower.includes("error")) {
    return (
      <div key={i} className="ceo-thought-omp" style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(45,27,27,0.4)" }}>
        <div className="ceo-thought-header" style={{ color: "var(--accent-coral)" }}>⚠ Error</div>
        <div className="ceo-thought-body">{log}</div>
      </div>
    );
  }
  return (
    <div key={i} className="ceo-thought-omp">
      <div className="ceo-thought-header">💭 CEO Thought</div>
      <div className="ceo-thought-body">{log}</div>
    </div>
  );
}

export function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
