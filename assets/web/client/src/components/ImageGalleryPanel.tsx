import { useState, useEffect, useRef } from "react";

export default function ImageGalleryPanel() {
  const [images, setImages] = useState<string[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try { const r = await fetch("/api/gallery"); const d = await r.json(); setImages(d.images || []); } catch {}
  };
  useEffect(() => { load(); }, []);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      await fetch("/api/gallery/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, data: base64 }) });
      load();
    };
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const del = async (name: string) => {
    await fetch(`/api/gallery/${encodeURIComponent(name)}`, { method: "DELETE" });
    setViewing(null); load();
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Image Gallery</h2>
        <button className="btn" onClick={() => fileRef.current?.click()}>+ Upload</button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={upload} />
      </div>
      {images.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--mute)" }}>No images yet. Upload one to get started.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
          {images.map(name => (
            <div key={name} onClick={() => setViewing(name)} style={{ cursor: "pointer", borderRadius: 8, overflow: "hidden", border: "1px solid var(--hairline)", aspectRatio: "1", background: "var(--surface)" }}>
              <img src={`/api/gallery/${encodeURIComponent(name)}`} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ))}
        </div>
      )}
      {viewing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 32 }} onClick={() => setViewing(null)}>
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }} onClick={e => e.stopPropagation()}>
            <img src={`/api/gallery/${encodeURIComponent(viewing)}`} alt={viewing} style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: 8 }} />
            <div style={{ position: "absolute", top: -32, right: 0, display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => del(viewing)} style={{ background: "var(--danger)", color: "#fff", border: "none", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Delete</button>
              <button className="btn" onClick={() => setViewing(null)} style={{ background: "var(--surface)", border: "1px solid var(--hairline)", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Close</button>
            </div>
            <div style={{ color: "#fff", fontSize: 12, marginTop: 4, textAlign: "center" }}>{viewing}</div>
          </div>
        </div>
      )}
    </div>
  );
}
