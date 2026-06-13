import { useState, useRef, useCallback, useEffect } from "react";

type Tool = "draw" | "crop";
type Filter = "none" | "grayscale" | "sepia" | "invert" | "brightness";

export default function CanvasEditorPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [tool, setTool] = useState<Tool>("draw");
  const [filter, setFilter] = useState<Filter>("none");
  const [drawing, setDrawing] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropEnd, setCropEnd] = useState<{ x: number; y: number } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const saveState = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    setHistory(h => [...h, c.toDataURL()].slice(-20));
  }, []);

  const loadImage = useCallback((url: string) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const c = canvasRef.current;
      if (!c) return;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      saveState();
    };
    img.src = url;
  }, [saveState]);

  useEffect(() => {
    if (imageUrl) loadImage(imageUrl);
  }, [imageUrl, loadImage]);

  const applyFilter = (f: Filter) => {
    setFilter(f);
    const c = canvasRef.current;
    if (!c || !imgRef.current) return;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(imgRef.current, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    if (f === "grayscale") {
      for (let i = 0; i < d.data.length; i += 4) { const g = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11; d.data[i] = d.data[i + 1] = d.data[i + 2] = g; }
    } else if (f === "sepia") {
      for (let i = 0; i < d.data.length; i += 4) { const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2]; d.data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189); d.data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168); d.data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131); }
    } else if (f === "invert") {
      for (let i = 0; i < d.data.length; i += 4) { d.data[i] = 255 - d.data[i]; d.data[i + 1] = 255 - d.data[i + 1]; d.data[i + 2] = 255 - d.data[i + 2]; }
    } else if (f === "brightness") {
      for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.min(255, d.data[i] * 1.3); d.data[i + 1] = Math.min(255, d.data[i + 1] * 1.3); d.data[i + 2] = Math.min(255, d.data[i + 2] * 1.3); }
    }
    ctx.putImageData(d, 0, 0);
    saveState();
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "draw") return;
    setDrawing(true);
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || tool !== "draw") return;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect();
    ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
    ctx.strokeStyle = "var(--accent)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!drawing) return;
    setDrawing(false);
    saveState();
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "crop") return;
    const r = canvasRef.current!.getBoundingClientRect();
    setCropStart({ x: e.clientX - r.left, y: e.clientY - r.top });
    setCropEnd(null);
  };

  const handleCropMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!cropStart || tool !== "crop") return;
    const r = canvasRef.current!.getBoundingClientRect();
    setCropEnd({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const handleCropMouseUp = () => {
    if (!cropStart || !cropEnd || tool !== "crop") return;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const x = Math.min(cropStart.x, cropEnd.x), y = Math.min(cropStart.y, cropEnd.y);
    const w = Math.abs(cropEnd.x - cropStart.x), h = Math.abs(cropEnd.y - cropStart.y);
    if (w < 5 || h < 5) { setCropStart(null); setCropEnd(null); return; }
    const d = ctx.getImageData(x, y, w, h);
    c.width = w; c.height = h;
    ctx.putImageData(d, 0, 0);
    setCropStart(null); setCropEnd(null);
    saveState();
  };

  const undo = () => {
    if (history.length < 2) return;
    const prev = history[history.length - 2];
    setHistory(h => h.slice(0, -1));
    const img = new Image();
    img.onload = () => { const c = canvasRef.current!; c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d")!.drawImage(img, 0, 0); };
    img.src = prev;
  };

  const download = () => {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement("a");
    a.download = "canvas-export.png";
    a.href = c.toDataURL();
    a.click();
  };

  const tools: Tool[] = ["draw", "crop"];
  const filters: Filter[] = ["none", "grayscale", "sepia", "invert", "brightness"];

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" placeholder="Image URL (paste a URL)" value={imageUrl} onChange={e => setImageUrl(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {tools.map(t => <button key={t} className={`btn ${tool === t ? "btn-primary" : ""}`} onClick={() => setTool(t)}>{t}</button>)}
        <span style={{ color: "var(--mute)", fontSize: 12 }}>|</span>
        {filters.map(f => <button key={f} className={`btn ${filter === f ? "btn-primary" : ""}`} onClick={() => applyFilter(f)}>{f}</button>)}
        <span style={{ color: "var(--mute)", fontSize: 12 }}>|</span>
        <button className="btn" onClick={undo} disabled={history.length < 2}>Undo</button>
        <button className="btn btn-primary" onClick={download}>Download</button>
      </div>
      <div style={{ border: "1px solid var(--hairline)", borderRadius: 8, overflow: "hidden", display: "inline-block", maxWidth: "100%" }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", maxWidth: "100%", cursor: tool === "draw" ? "crosshair" : "default" }}
          onMouseDown={tool === "draw" ? startDrawing : handleCropMouseDown}
          onMouseMove={tool === "draw" ? draw : handleCropMouseMove}
          onMouseUp={tool === "draw" ? stopDrawing : handleCropMouseUp}
          onMouseLeave={stopDrawing}
        />
      </div>
    </div>
  );
}
