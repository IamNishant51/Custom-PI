import { usePostApproval } from "../hooks/usePostApproval";

interface PostPreview {
  id: string;
  platform: string;
  content: string;
  title?: string;
  platformSpecific?: string;
  assetUrl?: string;
}

const PLATFORM_STYLES: Record<string, { name: string; icon: string; maxLen: number; bg: string; border: string; accent: string }> = {
  twitter:    { name: "Twitter / X",    icon: "X",  maxLen: 280, bg: "#0f1419", border: "#2f3336", accent: "#1d9bf0" },
  reddit:     { name: "Reddit",         icon: "R",  maxLen: 40000, bg: "#0f1117", border: "#343536", accent: "#ff4500" },
  bluesky:    { name: "Bluesky",        icon: "B",  maxLen: 300, bg: "#1a1a2e", border: "#2a2a3e", accent: "#0085ff" },
  discord:    { name: "Discord",        icon: "D",  maxLen: 2000, bg: "#2b2d31", border: "#3c3f45", accent: "#5865f2" },
  telegram:   { name: "Telegram",       icon: "T",  maxLen: 4096, bg: "#17212b", border: "#253441", accent: "#26a5e4" },
};

function PostCard({ platform, content, title, platformSpecific, assetUrl }: PostPreview) {
  const style = PLATFORM_STYLES[platform] || PLATFORM_STYLES.twitter;
  const charsLeft = style.maxLen - content.length;
  const isOver = charsLeft < 0;

  return (
    <div style={{
      background: style.bg,
      border: `1px solid ${style.border}`,
      borderRadius: 12,
      maxWidth: 520,
      fontFamily: platform === "twitter" ? "'Segoe UI', system-ui, sans-serif" : "var(--font-sans)",
      animation: "slideUp 0.2s ease-out",
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px 10px", borderBottom: `1px solid ${style.border}` }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6, background: style.accent,
          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)",
        }}>{style.icon}</div>
        <span style={{ color: "#e4e4e4", fontSize: 13, fontWeight: 600 }}>{style.name}</span>
        {platformSpecific && <span style={{ color: style.accent, fontSize: 11, marginLeft: "auto", fontFamily: "var(--font-mono)" }}>{platformSpecific}</span>}
      </div>

      <div style={{ padding: "12px 16px 10px" }}>
        {title && (
          <div style={{ color: "#e4e4e4", fontSize: 15, fontWeight: 700, marginBottom: 8, lineHeight: 1.3 }}>{title}</div>
        )}
        <div style={{
          color: "#e4e4e4", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap",
          fontFamily: platform === "twitter" ? "'Segoe UI', system-ui, sans-serif" : "var(--font-sans)",
        }}>{content}</div>
      </div>

      {assetUrl && (
        <div style={{
          borderTop: `1px solid ${style.border}`,
          borderBottom: `1px solid ${style.border}`,
          background: "#000",
        }}>
          <img src={`/api/assets/files/${encodeURIComponent(assetUrl)}`} alt="Post image"
            style={{
              width: "100%", maxHeight: 400, objectFit: "contain",
              display: "block", background: "#000",
            }} />
        </div>
      )}

      <div style={{
        display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4,
        padding: "8px 16px 12px",
      }}>
        <span style={{
          fontSize: 11, fontFamily: "var(--font-mono)",
          color: isOver ? "#f87171" : charsLeft < 20 ? "#fbbf24" : "#6a6e74",
        }}>
          {isOver ? `+${Math.abs(charsLeft)} over limit` : `${charsLeft} chars remaining`}
        </span>
        <span style={{ fontSize: 10, color: "#4a4e54" }}>/ {style.maxLen}</span>
      </div>
    </div>
  );
}

export default function PostApproval({ ws }: { ws: WebSocket | null }) {
  const { preview, editReq, editText, setEditText, answered, send, reset } = usePostApproval(ws);

  if (!preview && !editReq) return null;

  return (
    <div className="subagent-modal-overlay" style={{ zIndex: 1000 }} onClick={() => {}}>
      <div style={{
        background: "var(--surface-card)",
        border: "1px solid var(--hairline-strong)",
        borderRadius: 16,
        padding: 28,
        maxWidth: preview?.assetUrl ? 620 : 540,
        width: "90%",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        animation: "slideUp 0.25s ease-out",
        maxHeight: "90vh",
        overflowY: "auto",
      }} onClick={e => e.stopPropagation()}>

        {editReq ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6, background: "var(--accent-teal)",
                color: "#000", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
              }}>E</div>
              <span style={{ color: "var(--ink)", fontSize: 14, fontWeight: 600 }}>Edit Post</span>
            </div>
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={6}
              style={{
                width: "100%", background: "var(--surface-soft)", border: "1px solid var(--hairline)",
                borderRadius: 8, padding: "10px 12px", color: "var(--ink)", fontSize: 13,
                fontFamily: "var(--font-sans)", resize: "vertical", outline: "none", marginBottom: 16,
              }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-small btn-ghost" onClick={() => { send("user_answer", { questionId: editReq.id, answer: "(edit cancelled)" }); reset(); }}
                style={{ fontSize: 12, padding: "8px 16px" }}>Cancel</button>
              <button className="btn btn-small btn-primary" onClick={() => { send("user_answer", { questionId: editReq.id, answer: editText }); reset(); }}
                style={{ background: "var(--accent-teal)", color: "#000", border: "none", padding: "8px 20px", borderRadius: 6, fontWeight: 600, fontSize: 12 }}>
                Submit Edit
              </button>
            </div>
          </>
        ) : preview ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6, background: "var(--accent-teal)",
                color: "#000", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
              }}>P</div>
              <span style={{ color: "var(--ink)", fontSize: 14, fontWeight: 600 }}>Post Preview — {PLATFORM_STYLES[preview.platform]?.name || preview.platform}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--mute)", fontFamily: "var(--font-mono)" }}>approval required</span>
            </div>

            <div style={{ marginBottom: 20 }}>
              <PostCard {...preview} />
            </div>

            <div style={{
              display: "flex", gap: 8, justifyContent: "flex-end",
              borderTop: "1px solid var(--hairline)", paddingTop: 16,
            }}>
              <button
                onClick={() => { send("user_answer", { questionId: preview.id, answer: "Skip" }); }}
                disabled={answered}
                style={{
                  padding: "8px 16px", background: "transparent", border: "1px solid var(--hairline)",
                  borderRadius: 6, color: "var(--mute)", fontSize: 12, cursor: "pointer",
                  fontFamily: "var(--font-mono)", opacity: answered ? 0.4 : 1,
                }}
              >Skip</button>
              <button
                onClick={() => { send("user_answer", { questionId: preview.id, answer: "Edit" }); }}
                disabled={answered}
                style={{
                  padding: "8px 16px", background: "var(--surface-soft)", border: "1px solid var(--hairline-strong)",
                  borderRadius: 6, color: "var(--ink)", fontSize: 12, cursor: "pointer",
                  fontFamily: "var(--font-mono)", opacity: answered ? 0.4 : 1,
                }}
              >Edit</button>
              <button
                onClick={() => { send("user_answer", { questionId: preview.id, answer: "Approve" }); }}
                disabled={answered}
                style={{
                  padding: "8px 22px", background: "var(--accent-teal)", border: "none",
                  borderRadius: 6, color: "#000", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  fontFamily: "var(--font-mono)", opacity: answered ? 0.4 : 1,
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = answered ? "0.4" : "0.85"}
                onMouseLeave={e => e.currentTarget.style.opacity = answered ? "0.4" : "1"}
              >Approve & Post</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
