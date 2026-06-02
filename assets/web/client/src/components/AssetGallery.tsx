import { useState, useEffect, useCallback, useRef } from "react";

interface AssetInfo {
  filename: string;
  size: number;
  created: string;
}

export default function AssetGallery() {
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const abortRef = useRef<AbortController>(undefined);

  const loadAssets = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setLoading(true);
      const res = await fetch("/api/assets", { signal: controller.signal });
      const data = await res.json();
      if (!controller.signal.aborted) setAssets(data.assets || []);
    } catch {} finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssets();
    return () => { abortRef.current?.abort(); };
  }, [loadAssets]);

  const removeAsset = async (filename: string) => {
    try {
      await fetch(`/api/assets/${encodeURIComponent(filename)}`, { method: "DELETE" });
      setAssets(prev => prev.filter(a => a.filename !== filename));
    } catch {}
  };

  const copyPath = (filename: string) => {
    navigator.clipboard.writeText(filename);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", fontFamily: "var(--font-mono)" }}>
          Generated Assets ({assets.length})
        </span>
        <button onClick={loadAssets} style={{
          background: "transparent", border: "1px solid var(--hairline)", borderRadius: 4,
          padding: "2px 8px", fontSize: 10, color: "var(--mute)", cursor: "pointer",
          fontFamily: "var(--font-mono)",
        }}>↻</button>
      </div>

      {loading && assets.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--mute)", padding: "8px 0" }}>Loading...</div>
      )}

      {!loading && assets.length === 0 && (
        <div style={{
          fontSize: 11, color: "var(--mute)", padding: "12px", textAlign: "center",
          border: "1px dashed var(--hairline)", borderRadius: 8,
        }}>
          No generated assets yet. Use <code style={{ fontSize: 10, background: "var(--surface-soft)", padding: "1px 4px", borderRadius: 3 }}>generate_image</code> with <code style={{ fontSize: 10, background: "var(--surface-soft)", padding: "1px 4px", borderRadius: 3 }}>save: true</code>.
        </div>
      )}

      {assets.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
          gap: 6, maxHeight: 240, overflowY: "auto",
          padding: "4px 0",
        }}>
          {assets.map(asset => (
            <div key={asset.filename} style={{
              position: "relative", borderRadius: 6, overflow: "hidden",
              aspectRatio: "1", background: "var(--surface-soft)",
              border: "1px solid var(--hairline)", cursor: "pointer",
            }}
              onClick={() => setPreview(asset.filename)}
              onMouseEnter={e => { const el = e.currentTarget.querySelector(".asset-actions") as HTMLElement; if (el) el.style.opacity = "1"; }}
              onMouseLeave={e => { const el = e.currentTarget.querySelector(".asset-actions") as HTMLElement; if (el) el.style.opacity = "0"; }}
            >
              <img
                src={`/api/assets/files/${encodeURIComponent(asset.filename)}`}
                alt={asset.filename}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              <div className="asset-actions" style={{
                position: "absolute", top: 2, right: 2, display: "flex", gap: 2,
                opacity: 0, transition: "opacity 0.15s",
              }}>
                <button onClick={e => { e.stopPropagation(); copyPath(asset.filename); }}
                  title="Copy filename"
                  style={{
                    width: 20, height: 20, borderRadius: 4, border: "none",
                    background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>C</button>
                <button onClick={e => { e.stopPropagation(); removeAsset(asset.filename); }}
                  title="Delete"
                  style={{
                    width: 20, height: 20, borderRadius: 4, border: "none",
                    background: "rgba(239,68,68,0.7)", color: "#fff", fontSize: 10,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="subagent-modal-overlay" style={{ zIndex: 2000, cursor: "pointer" }}
          onClick={() => setPreview(null)}>
          <div style={{
            maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12, overflow: "hidden",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6)", cursor: "default",
          }} onClick={e => e.stopPropagation()}>
            <img src={`/api/assets/files/${encodeURIComponent(preview)}`} alt={preview}
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", maxHeight: "80vh" }} />
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 12px", background: "var(--surface-card)",
              borderTop: "1px solid var(--hairline)",
            }}>
              <span style={{ fontSize: 11, color: "var(--mute)", fontFamily: "var(--font-mono)" }}>{preview}</span>
              <button onClick={() => { copyPath(preview); }}
                style={{
                  background: "var(--surface-soft)", border: "1px solid var(--hairline)",
                  borderRadius: 4, padding: "4px 10px", fontSize: 10, color: "var(--ink)",
                  cursor: "pointer", fontFamily: "var(--font-mono)",
                }}>Copy Path</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
