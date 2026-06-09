import { useAssetSelection } from "../hooks/useAssetSelection";

export default function AssetSelector({ ws }: { ws: WebSocket | null }) {
  const { request, selected, setSelected, answered, send } = useAssetSelection(ws);

  if (!request) return null;

  return (
    <div className="subagent-modal-overlay" style={{ zIndex: 1000 }} onClick={() => {}}>
      <div style={{
        background: "var(--surface-card)",
        border: "1px solid var(--hairline-strong)",
        borderRadius: 16,
        padding: 28,
        maxWidth: 640,
        width: "90%",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        animation: "slideUp 0.25s ease-out",
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 6, background: "var(--accent-teal)",
            color: "#000", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
          }}>A</div>
          <span style={{ color: "var(--ink)", fontSize: 14, fontWeight: 600 }}>Select Generated Asset</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--mute)", fontFamily: "var(--font-mono)" }}>
            {request.filenames.length} images
          </span>
        </div>

        {request.prompt && (
          <div style={{
            fontSize: 12, color: "var(--text-secondary)", marginBottom: 16,
            padding: "8px 12px", background: "var(--surface-soft)", borderRadius: 8,
            border: "1px solid var(--hairline)", fontFamily: "var(--font-sans)",
          }}>
            Prompt: {request.prompt}
          </div>
        )}

        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(request.filenames.length, 2)}, 1fr)`,
          gap: 12, marginBottom: 20,
        }}>
          {request.filenames.map(filename => (
            <div
              key={filename}
              onClick={() => { if (!answered) setSelected(filename); }}
              style={{
                borderRadius: 10, overflow: "hidden", cursor: answered ? "default" : "pointer",
                border: selected === filename ? "3px solid var(--accent-teal)" : "3px solid transparent",
                transition: "border-color 0.15s, opacity 0.15s",
                opacity: answered ? (selected === filename ? 1 : 0.4) : 1,
                background: "var(--surface-soft)",
              }}
            >
              <img
                src={`/api/assets/files/${encodeURIComponent(filename)}`}
                alt={filename}
                style={{
                  width: "100%", height: "auto", display: "block",
                  aspectRatio: "1", objectFit: "cover",
                }}
              />
              <div style={{
                padding: "6px 8px", fontSize: 10, color: "var(--mute)",
                fontFamily: "var(--font-mono)", textAlign: "center",
                borderTop: "1px solid var(--hairline)", background: "var(--surface-card)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {selected === filename ? "✓ SELECTED" : filename}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          display: "flex", gap: 8, justifyContent: "flex-end",
          borderTop: "1px solid var(--hairline)", paddingTop: 16,
        }}>
          <button
            onClick={() => { send("__skip__"); }}
            disabled={answered}
            style={{
              padding: "8px 16px", background: "transparent", border: "1px solid var(--hairline)",
              borderRadius: 6, color: "var(--mute)", fontSize: 12, cursor: "pointer",
              fontFamily: "var(--font-mono)", opacity: answered ? 0.4 : 1,
            }}
          >Skip (no image)</button>
          <button
            onClick={() => { if (selected) send(selected); }}
            disabled={!selected || answered}
            style={{
              padding: "8px 22px", background: selected ? "var(--accent-teal)" : "var(--surface-soft)",
              border: "none", borderRadius: 6,
              color: selected ? "#000" : "var(--mute)", fontSize: 12, fontWeight: 600,
              cursor: (selected && !answered) ? "pointer" : "default",
              fontFamily: "var(--font-mono)", opacity: answered ? 0.4 : 1,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={e => { if (selected && !answered) e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { if (selected && !answered) e.currentTarget.style.opacity = "1"; }}
          >Use Selected</button>
        </div>
      </div>
    </div>
  );
}
