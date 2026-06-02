import { useState, useEffect, useRef } from "react";

interface PendingAssetSelection {
  id: string;
  filenames: string[];
  prompt?: string;
}

interface PendingPostPreview {
  id: string;
  platform: string;
  content: string;
  title?: string;
  platformSpecific?: Record<string, string>;
  assetUrl?: string;
}

interface CooldownInfo {
  platform: string;
  retryAfter: number;
}

export default function PostEditorCanvas({ ws }: { ws: WebSocket | null }) {
  const [assetReq, setAssetReq] = useState<PendingAssetSelection | null>(null);
  const [postPreview, setPostPreview] = useState<PendingPostPreview | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [cooldowns, setCooldowns] = useState<CooldownInfo[]>([]);
  const [answered, setAnswered] = useState(false);
  const mountedRef = useRef(true);
  const cooldownTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!ws) return;
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "asset_selection_request") {
          if (!mountedRef.current) return;
          setAssetReq({ id: data.id, filenames: data.filenames, prompt: data.prompt });
          setSelectedImage(null);
          setAnswered(false);
        }
        if (data.type === "post_preview") {
          if (!mountedRef.current) return;
          setPostPreview({ id: data.id, platform: data.platform, content: data.content, title: data.title, platformSpecific: data.platformSpecific, assetUrl: data.assetUrl });
          setEditText(data.content);
          setAnswered(false);
        }
        if (data.type === "user_question_resolved") {
          if (!mountedRef.current) return;
          setAnswered(true);
          setTimeout(() => { if (mountedRef.current) { setAssetReq(null); setPostPreview(null); } }, 600);
        }
      } catch {}
    };
    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws]);

  useEffect(() => {
    const checkCooldowns = async () => {
      try {
        const r = await fetch("/api/system/rate-limits");
        const data = await r.json();
        if (data.ok && Array.isArray(data.limits)) {
          const active = data.limits
            .filter((l: any) => l.breached && l.retry_after)
            .map((l: any) => ({ platform: l.platform || l.endpoint, retryAfter: l.retry_after }));
          setCooldowns(active);
        }
      } catch {}
    };
    checkCooldowns();
    cooldownTimer.current = setInterval(checkCooldowns, 15000);
    return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
  }, []);

  const sendApprove = () => {
    if (!ws) return;
    if (assetReq && selectedImage) {
      ws.send(JSON.stringify({ type: "user_response", questionId: assetReq.id, response: selectedImage }));
      setAnswered(true);
    }
    if (postPreview) {
      ws.send(JSON.stringify({ type: "post_approved", id: postPreview.id, content: editText }));
      setAnswered(true);
      setTimeout(() => { if (mountedRef.current) setPostPreview(null); }, 600);
    }
  };

  const sendSkip = () => {
    if (!ws) return;
    if (assetReq) {
      ws.send(JSON.stringify({ type: "user_response", questionId: assetReq.id, response: null }));
      setAnswered(true);
    }
    if (postPreview) {
      ws.send(JSON.stringify({ type: "post_skip", id: postPreview.id }));
      setAnswered(true);
    }
  };

  if (!assetReq && !postPreview) return null;

  const hasAsset = !!(assetReq && assetReq.filenames.length > 0);
  const hasPost = postPreview !== null;

  return (
    <div className="post-editor-canvas-overlay" style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.2s ease-out",
    }}>
      <div className="post-editor-canvas" style={{
        background: "var(--surface-card)", border: "1px solid var(--hairline-strong)",
        borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
        width: hasAsset && hasPost ? 900 : 620, maxWidth: "94vw",
        maxHeight: "88vh", display: "flex", flexDirection: "column",
        animation: "slideUp 0.25s ease-out",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 20px", borderBottom: "1px solid var(--hairline)",
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", fontFamily: "var(--font-mono)" }}>
            {hasAsset && hasPost ? "Review & Post" : hasAsset ? "Select Image" : "Review Post"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {cooldowns.map(c => (
              <span key={c.platform} style={{ fontSize: 10, color: "var(--accent-coral)", opacity: 0.7 }}>
                ⏳ {c.platform} cooldown {Math.ceil(c.retryAfter / 60)}m
              </span>
            ))}
            <button
              className="btn btn-small btn-ghost"
              onClick={sendSkip}
              style={{ fontSize: 16, opacity: 0.5, padding: "2px 8px", lineHeight: 1 }}
            >✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{
          display: "flex", flex: 1, overflow: "hidden",
          flexDirection: hasAsset && hasPost ? "row" : "column",
        }}>
          {/* Left: Asset Grid */}
          {hasAsset && (
            <div style={{
              flex: hasPost ? "0 0 45%" : "1", overflow: "auto",
              padding: 16, borderRight: hasPost ? "1px solid var(--hairline)" : "none",
            }}>
              {assetReq!.prompt && (
                <div style={{ fontSize: 11, color: "var(--mute)", marginBottom: 10, fontStyle: "italic" }}>
                  Prompt: {assetReq!.prompt}
                </div>
              )}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
              }}>
                {assetReq!.filenames.map((fname) => {
                  const isSelected = selectedImage === fname;
                  return (
                    <div
                      key={fname}
                      onClick={() => setSelectedImage(fname)}
                      style={{
                        cursor: "pointer", borderRadius: 8, overflow: "hidden",
                        border: isSelected ? "2px solid var(--accent-teal)" : "2px solid transparent",
                        boxShadow: isSelected ? "0 0 12px rgba(90,176,176,0.3)" : "none",
                        transition: "all 0.15s",
                        opacity: answered ? 0.5 : 1,
                        position: "relative",
                      }}
                    >
                      <img
                        src={`/api/assets/files/${encodeURIComponent(fname)}`}
                        alt={fname}
                        style={{ width: "100%", height: 140, objectFit: "cover", display: "block" }}
                      />
                      {isSelected && (
                        <div style={{
                          position: "absolute", top: 6, right: 6,
                          background: "var(--accent-teal)", color: "#000",
                          borderRadius: "50%", width: 22, height: 22,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 700,
                        }}>✓</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Right: Text Editor */}
          {hasPost && (
            <div style={{
              flex: hasAsset ? "0 0 55%" : "1", overflow: "auto",
              padding: 16, display: "flex", flexDirection: "column", gap: 12,
            }}>
              <div style={{ fontSize: 11, color: "var(--mute)", fontFamily: "var(--font-mono)" }}>
                Platform: {postPreview!.platform}
                {postPreview!.title && <span> — Title: {postPreview!.title}</span>}
              </div>

              {/* Inline image if assetUrl present */}
              {postPreview!.assetUrl && (
                <div style={{ borderRadius: 8, overflow: "hidden", maxHeight: 200 }}>
                  <img
                    src={postPreview!.assetUrl}
                    alt="Post asset"
                    style={{ width: "100%", height: "auto", maxHeight: 200, objectFit: "contain", display: "block" }}
                  />
                </div>
              )}

              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                disabled={answered}
                style={{
                  flex: 1, minHeight: 120,
                  background: "var(--surface-soft)", border: "1px solid var(--hairline)",
                  borderRadius: 8, padding: 12, color: "var(--ink)", fontSize: 13,
                  fontFamily: "var(--font-sans)", resize: "vertical", outline: "none",
                  lineHeight: 1.5,
                }}
              />

              <div style={{ fontSize: 11, color: "var(--mute)", textAlign: "right" }}>
                {editText.length} chars
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{
          display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8,
          padding: "12px 20px", borderTop: "1px solid var(--hairline)",
        }}>
          {hasAsset && (
            <button
              className="btn btn-small btn-ghost"
              onClick={() => {
                ws?.send(JSON.stringify({ type: "user_response", questionId: assetReq!.id, response: null }));
                setAnswered(true);
              }}
              disabled={answered}
              style={{ fontSize: 12, padding: "6px 14px", borderRadius: 6 }}
            >Skip</button>
          )}
          <button
            className="btn btn-small btn-ghost"
            onClick={() => {
              ws?.send(JSON.stringify({ type: "regenerate_image", prompt: assetReq?.prompt || "" }));
            }}
            disabled={!!(answered || !assetReq)}
            style={{ fontSize: 12, padding: "6px 14px", borderRadius: 6 }}
          >Regenerate</button>
          <button
            className="btn btn-small btn-primary"
            onClick={sendApprove}
            disabled={answered || (hasAsset && !selectedImage)}
            style={{
              background: "var(--accent-teal)", color: "#000", border: "none",
              padding: "6px 20px", borderRadius: 6, fontWeight: 600, fontSize: 12,
              cursor: "pointer", fontFamily: "var(--font-mono)",
              opacity: answered || (hasAsset && !selectedImage) ? 0.4 : 1,
            }}
          >
            {hasAsset && hasPost ? "Approve & Post" : hasAsset ? "Select" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
