import { useState, useEffect, useRef, useCallback } from "react";
import { PanelLoadingSpinner, PanelErrorCard } from "./LoadingSkeleton";

type ToastMsg = { text: string; type: "success" | "error" } | null;

export default function ImageGalleryPanel() {
  const [images, setImages] = useState<string[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMsg>(null);
  const [previewError, setPreviewError] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const showToast = (text: string, type: "success" | "error") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const r = await fetch("/api/gallery");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setImages(d.images || []);
      setPreviewError(new Set());
    } catch (e: any) {
      setLoadError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast("File too large (max 10MB)", "error");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const r = await fetch("/api/gallery/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, data: base64 }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || "Upload failed");
      }
      showToast("Image uploaded", "success");
      await loadData();
    } catch (err: any) {
      showToast(err.message || "Upload failed", "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (name: string) => {
    setConfirmDelete(null);
    setDeleting(name);
    try {
      const r = await fetch(`/api/gallery/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
      showToast("Image deleted", "success");
      if (viewing === name) setViewing(null);
      await loadData();
    } catch (err: any) {
      showToast(err.message || "Delete failed", "error");
    } finally {
      setDeleting(null);
    }
  };

  const handleImgError = (name: string) => {
    setPreviewError(prev => new Set(prev).add(name));
  };

  return (
    <div className="panel" style={{ padding: 16, position: "relative" }}>
      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: toast.type === "success" ? "var(--success)" : "var(--danger)",
          color: "#fff", padding: "8px 16px", borderRadius: 8,
          fontFamily: "var(--font-mono)", fontSize: 12,
          animation: "slideIn 0.15s ease",
        }}>{toast.text}</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Image Gallery</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {uploading && <span className="loading-spinner" />}
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading..." : "+ Upload"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={upload} />
        </div>
      </div>
      {loading ? (
        <PanelLoadingSpinner message="Loading images..." />
      ) : loadError ? (
        <PanelErrorCard message={loadError} onRetry={loadData} />
      ) : images.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-marker">~</div>
          <div className="empty-state-title">No images yet</div>
          <div className="empty-state-desc">Upload an image to get started.</div>
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 12,
        }}>
          {images.map(name => (
            <div
              key={name}
              style={{
                borderRadius: 8, overflow: "hidden",
                border: "1px solid var(--hairline)",
                background: "var(--surface-card)",
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onClick={() => !deleting && setViewing(name)}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--hairline-strong)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--hairline)")}
            >
              <div style={{ aspectRatio: "1", background: "var(--surface-soft)", position: "relative" }}>
                {previewError.has(name) ? (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--mute)", fontSize: 12, fontFamily: "var(--font-mono)",
                  }}>
                    Preview unavailable
                  </div>
                ) : (
                  <img
                    src={`/api/gallery/${encodeURIComponent(name)}`}
                    alt={name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={() => handleImgError(name)}
                  />
                )}
              </div>
              <div style={{
                padding: "6px 8px", fontSize: 11, color: "var(--mute)",
                fontFamily: "var(--font-mono)", overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
                borderTop: "1px solid var(--hairline)",
              }}>
                {name}
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: 32,
          }}
          onClick={() => { setViewing(null); setConfirmDelete(null); }}
        >
          <div
            style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh", minWidth: 300 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 8,
            }}>
              <span style={{ color: "#fff", fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {viewing}
              </span>
              <div style={{ display: "flex", gap: 6, marginLeft: 12 }}>
                {confirmDelete === viewing ? (
                  <>
                    <button
                      className="btn"
                      onClick={() => handleDelete(viewing)}
                      disabled={deleting === viewing}
                      style={{
                        background: "var(--danger)", color: "#fff", border: "none",
                        padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12,
                      }}
                    >
                      {deleting === viewing ? "Deleting..." : "Confirm"}
                    </button>
                    <button
                      className="btn"
                      onClick={() => setConfirmDelete(null)}
                      style={{
                        background: "transparent", border: "1px solid rgba(255,255,255,0.3)",
                        padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12, color: "#fff",
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn"
                      onClick={() => setConfirmDelete(viewing)}
                      style={{
                        background: "rgba(255,59,48,0.2)", color: "#ff3b30", border: "1px solid rgba(255,59,48,0.3)",
                        padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12,
                      }}
                    >
                      Delete
                    </button>
                    <button
                      className="btn"
                      onClick={() => { setViewing(null); setConfirmDelete(null); }}
                      style={{
                        background: "transparent", border: "1px solid rgba(255,255,255,0.3)",
                        padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12, color: "#fff",
                      }}
                    >
                      Close
                    </button>
                  </>
                )}
              </div>
            </div>
            <img
              src={`/api/gallery/${encodeURIComponent(viewing)}`}
              alt={viewing}
              style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: 8, display: "block" }}
              onError={e => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
