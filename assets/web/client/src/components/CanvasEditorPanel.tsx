import { useState, useRef, useCallback, useEffect } from "react";

type DrawTool = "pen" | "line" | "arrow" | "rect" | "circle" | "text" | "eraser" | "crop";
type Filter = "none" | "grayscale" | "sepia" | "invert" | "blur";
type ExportFormat = "png" | "jpeg" | "webp";
type CropRatio = null | number;

const PRESET_COLORS = [
  "#ffffff", "#ff3b30", "#ff9f0a", "#ffcc02", "#30d158",
  "#5ac8fa", "#007aff", "#5856d6", "#af52de", "#ff2d55",
  "#000000", "#636366", "#8e8e93", "#aeaeb2", "#d1d1d6",
];

const CROP_RATIOS: { label: string; value: CropRatio }[] = [
  { label: "Free", value: null },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
  { label: "3:2", value: 3 / 2 },
];

function drawArrowhead(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, size: number) {
  const a = Math.atan2(toY - fromY, toX - fromX);
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - size * Math.cos(a - Math.PI / 6), toY - size * Math.sin(a - Math.PI / 6));
  ctx.lineTo(toX - size * Math.cos(a + Math.PI / 6), toY - size * Math.sin(a + Math.PI / 6));
  ctx.closePath();
}

export default function CanvasEditorPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [imageUrl, setImageUrl] = useState("");
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [tool, setTool] = useState<DrawTool>("pen");
  const [filter, setFilter] = useState<Filter>("none");
  const [brushSize, setBrushSize] = useState(3);
  const [brushColor, setBrushColor] = useState("#ffffff");
  const [fillShapes, setFillShapes] = useState(false);

  const [drawing, setDrawing] = useState(false);
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);

  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropEnd, setCropEnd] = useState<{ x: number; y: number } | null>(null);
  const [cropRatio, setCropRatio] = useState<CropRatio>(null);

  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [loadingGallery, setLoadingGallery] = useState(false);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [textFontSize, setTextFontSize] = useState(24);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showResizeDialog, setShowResizeDialog] = useState(false);
  const [resizeWidth, setResizeWidth] = useState(800);
  const [resizeHeight, setResizeHeight] = useState(600);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const shapeStart = useRef<{ x: number; y: number } | null>(null);
  const textPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const showToast = (text: string, type: "success" | "error") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => { fetchGallery(); }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === " " && !e.repeat) { e.preventDefault(); setSpaceHeld(true); return; }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        if (e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); }
        if (e.key === "s") { e.preventDefault(); download("png"); }
        return;
      }

      switch (e.key) {
        case "p": setTool("pen"); break;
        case "l": setTool("line"); break;
        case "a": setTool("arrow"); break;
        case "r": setTool("rect"); break;
        case "c": setTool("circle"); break;
        case "t": setTool("text"); break;
        case "e": setTool("eraser"); break;
        case "v": setTool("crop"); break;
        case "f": setFillShapes(v => !v); break;
        case "=": case "+": setZoom(z => Math.min(5, z + 0.25)); break;
        case "-": setZoom(z => Math.max(0.1, z - 0.25)); break;
        case "0": zoomFit(); break;
        case "Escape": setShowColorPicker(false); setShowExportMenu(false); setShowResizeDialog(false); setShowTextInput(false); setShowGallery(false); if (drawing) { setDrawing(false); clearOverlay(); } break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [drawing, history, historyIndex]);

  const fetchGallery = async () => {
    setLoadingGallery(true);
    try {
      const r = await fetch("/api/gallery");
      const d = await r.json();
      setGalleryImages(d.images || []);
    } catch {} finally {
      setLoadingGallery(false);
    }
  };

  const pushHistory = useCallback((dataUrl: string) => {
    setHistory(h => {
      const sliced = h.slice(0, historyIndex + 1);
      sliced.push(dataUrl);
      if (sliced.length > 50) sliced.shift();
      setHistoryIndex(sliced.length - 1);
      return sliced;
    });
  }, [historyIndex]);

  const saveState = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    pushHistory(c.toDataURL());
  }, [pushHistory]);

  const restoreFromDataUrl = useCallback((dataUrl: string) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const img = new Image();
    img.onload = () => {
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const overlay = overlayRef.current;
      if (overlay) { overlay.width = img.naturalWidth; overlay.height = img.naturalHeight; }
      ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
  }, []);

  const loadImageToCanvas = useCallback((url: string) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const c = canvasRef.current;
      if (!c) return;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const overlay = overlayRef.current;
      if (overlay) { overlay.width = img.naturalWidth; overlay.height = img.naturalHeight; }
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      setHistory([]);
      setHistoryIndex(-1);
      pushHistory(c.toDataURL());
      setFilter("none");
      zoomFit();
      showToast("Image loaded", "success");
    };
    img.onerror = () => showToast("Failed to load image", "error");
    img.src = url;
  }, [pushHistory]);

  const zoomFit = useCallback(() => {
    const c = canvasRef.current;
    const container = containerRef.current;
    if (!c || !container) return;
    const padding = 32;
    const availW = container.clientWidth - padding;
    const availH = container.clientHeight - padding;
    if (availW <= 0 || availH <= 0) return;
    const fit = Math.min(availW / c.width, availH / c.height);
    setZoom(Math.max(0.1, Math.min(5, fit)));
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const handleGalleryPick = (name: string) => {
    loadImageToCanvas(`/api/gallery/${encodeURIComponent(name)}`);
    setShowGallery(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") loadImageToCanvas(reader.result);
    };
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / zoom,
      y: (e.clientY - r.top) / zoom,
    };
  };

  const clearOverlay = () => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (spaceHeld) {
      setPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }
    if (tool === "text") {
      const p = getCanvasCoords(e);
      textPosRef.current = p;
      setTextValue("");
      setShowTextInput(true);
      setTimeout(() => textInputRef.current?.focus(), 50);
      return;
    }
    if (tool === "crop") {
      const p = getCanvasCoords(e);
      setCropStart(p);
      setCropEnd(null);
      clearOverlay();
      return;
    }
    setDrawing(true);
    const p = getCanvasCoords(e);
    lastPoint.current = p;
    shapeStart.current = p;
    if (tool === "pen" || tool === "eraser") {
      const c = canvasRef.current!;
      const ctx = c.getContext("2d")!;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (panning && panStart) {
      setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const p = getCanvasCoords(e);

    if (tool === "crop") {
      if (!cropStart) return;
      setCropEnd(p);
      clearOverlay();
      const overlay = overlayRef.current;
      if (!overlay) return;
      const octx = overlay.getContext("2d")!;
      let x = Math.min(cropStart.x, p.x), y = Math.min(cropStart.y, p.y);
      let w = Math.abs(p.x - cropStart.x), h = Math.abs(p.y - cropStart.y);
      if (cropRatio) {
        const ratio = cropRatio;
        if (w / h > ratio) h = w / ratio; else w = h * ratio;
        if (p.x < cropStart.x) x = cropStart.x - w;
        if (p.y < cropStart.y) y = cropStart.y - h;
      }
      octx.fillStyle = "rgba(0,0,0,0.45)";
      octx.fillRect(0, 0, overlay.width, overlay.height);
      octx.clearRect(x, y, w, h);
      octx.strokeStyle = "#ffffff";
      octx.lineWidth = 2;
      octx.setLineDash([6, 4]);
      octx.strokeRect(x, y, w, h);
      octx.setLineDash([]);
      const hw = w / 2, hh = h / 2;
      octx.strokeStyle = "rgba(255,255,255,0.4)";
      octx.lineWidth = 1;
      octx.setLineDash([3, 3]);
      octx.beginPath(); octx.moveTo(x + hw, y); octx.lineTo(x + hw, y + h); octx.stroke();
      octx.beginPath(); octx.moveTo(x, y + hh); octx.lineTo(x + w, y + hh); octx.stroke();
      octx.setLineDash([]);
      return;
    }

    if (!drawing) return;
    clearOverlay();

    if (tool === "pen") {
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "source-over";
      ctx.stroke();
    } else if (tool === "eraser") {
      ctx.lineTo(p.x, p.y);
      ctx.lineWidth = brushSize * 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "destination-out";
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    } else {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const octx = overlay.getContext("2d")!;
      const sx = shapeStart.current!.x, sy = shapeStart.current!.y;
      octx.strokeStyle = brushColor;
      octx.lineWidth = brushSize;
      octx.lineCap = "round";
      octx.lineJoin = "round";
      if (fillShapes && tool !== "line" && tool !== "arrow") {
        octx.fillStyle = brushColor;
      }
      octx.beginPath();
      if (tool === "line" || tool === "arrow") {
        octx.moveTo(sx, sy); octx.lineTo(p.x, p.y); octx.stroke();
        if (tool === "arrow") {
          drawArrowhead(octx, sx, sy, p.x, p.y, Math.max(8, brushSize * 3));
          octx.fillStyle = brushColor;
          octx.fill();
        }
      } else if (tool === "rect") {
        const rx = Math.min(sx, p.x), ry = Math.min(sy, p.y);
        const rw = Math.abs(p.x - sx), rh = Math.abs(p.y - sy);
        octx.rect(rx, ry, rw, rh);
        if (fillShapes) octx.fill();
        octx.stroke();
      } else if (tool === "circle") {
        octx.ellipse((sx + p.x) / 2, (sy + p.y) / 2, Math.abs(p.x - sx) / 2, Math.abs(p.y - sy) / 2, 0, 0, Math.PI * 2);
        if (fillShapes) octx.fill();
        octx.stroke();
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (panning) { setPanning(false); setPanStart(null); return; }

    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const p = getCanvasCoords(e);

    if (tool === "crop") {
      if (!cropStart || !cropEnd) return;
      let x = Math.min(cropStart.x, cropEnd.x), y = Math.min(cropStart.y, cropEnd.y);
      let w = Math.abs(cropEnd.x - cropStart.x), h = Math.abs(cropEnd.y - cropStart.y);
      if (cropRatio) {
        const ratio = cropRatio;
        if (w / h > ratio) h = w / ratio; else w = h * ratio;
        if (cropEnd.x < cropStart.x) x = cropStart.x - w;
        if (cropEnd.y < cropStart.y) y = cropStart.y - h;
      }
      if (w < 5 || h < 5) { setCropStart(null); setCropEnd(null); clearOverlay(); return; }
      const d = ctx.getImageData(x, y, w, h);
      c.width = w; c.height = h;
      ctx.putImageData(d, 0, 0);
      const overlay = overlayRef.current;
      if (overlay) { overlay.width = w; overlay.height = h; }
      setCropStart(null); setCropEnd(null);
      clearOverlay();
      saveState();
      showToast("Image cropped", "success");
      return;
    }

    if (!drawing) return;
    setDrawing(false);

    const overlay = overlayRef.current;
    if (overlay && (tool === "line" || tool === "arrow" || tool === "rect" || tool === "circle")) {
      const sx = shapeStart.current!.x, sy = shapeStart.current!.y;
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (fillShapes && tool !== "line" && tool !== "arrow") {
        ctx.fillStyle = brushColor;
      }
      ctx.beginPath();
      if (tool === "line" || tool === "arrow") {
        ctx.moveTo(sx, sy); ctx.lineTo(p.x, p.y); ctx.stroke();
        if (tool === "arrow") {
          drawArrowhead(ctx, sx, sy, p.x, p.y, Math.max(8, brushSize * 3));
          ctx.fillStyle = brushColor;
          ctx.fill();
        }
      } else if (tool === "rect") {
        const rx = Math.min(sx, p.x), ry = Math.min(sy, p.y);
        const rw = Math.abs(p.x - sx), rh = Math.abs(p.y - sy);
        ctx.rect(rx, ry, rw, rh);
        if (fillShapes) ctx.fill();
        ctx.stroke();
      } else if (tool === "circle") {
        ctx.ellipse((sx + p.x) / 2, (sy + p.y) / 2, Math.abs(p.x - sx) / 2, Math.abs(p.y - sy) / 2, 0, 0, Math.PI * 2);
        if (fillShapes) ctx.fill();
        ctx.stroke();
      }
      clearOverlay();
    }
    ctx.globalCompositeOperation = "source-over";
    lastPoint.current = null;
    shapeStart.current = null;
    saveState();
  };

  const commitText = () => {
    if (!textValue.trim()) { setShowTextInput(false); return; }
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.font = `${textFontSize}px "Inter", sans-serif`;
    ctx.fillStyle = brushColor;
    ctx.globalCompositeOperation = "source-over";
    ctx.textBaseline = "top";
    ctx.fillText(textValue, textPosRef.current.x, textPosRef.current.y);
    setShowTextInput(false);
    saveState();
  };

  const applyFilter = (f: Filter) => {
    setFilter(f);
    if (f === "none") {
      if (historyIndex >= 0) restoreFromDataUrl(history[historyIndex]);
      return;
    }
    if (historyIndex < 0) return;
    const c = canvasRef.current!;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      if (f === "grayscale") {
        for (let i = 0; i < px.length; i += 4) {
          const g = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
          px[i] = px[i + 1] = px[i + 2] = g;
        }
      } else if (f === "sepia") {
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2];
          px[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
          px[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
          px[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
        }
      } else if (f === "invert") {
        for (let i = 0; i < px.length; i += 4) {
          px[i] = 255 - px[i]; px[i + 1] = 255 - px[i + 1]; px[i + 2] = 255 - px[i + 2];
        }
      } else if (f === "blur") {
        const w = c.width, h = c.height;
        const src = new Uint8ClampedArray(px);
        const r = 2;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let rr = 0, gg = 0, bb = 0, count = 0;
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                  const idx = (ny * w + nx) * 4;
                  rr += src[idx]; gg += src[idx + 1]; bb += src[idx + 2];
                  count++;
                }
              }
            }
            const idx = (y * w + x) * 4;
            px[idx] = rr / count; px[idx + 1] = gg / count; px[idx + 2] = bb / count;
          }
        }
      }
      ctx.putImageData(d, 0, 0);
      saveState();
    };
    img.src = history[historyIndex];
  };

  const undo = () => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    restoreFromDataUrl(history[newIndex]);
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    restoreFromDataUrl(history[newIndex]);
  };

  const download = (format: ExportFormat) => {
    const c = canvasRef.current;
    if (!c) return;
    const mime = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
    const quality = format === "png" ? undefined : 0.92;
    const a = document.createElement("a");
    a.download = `canvas-export.${format}`;
    a.href = c.toDataURL(mime, quality);
    a.click();
    setShowExportMenu(false);
    showToast(`Exported as ${format.toUpperCase()}`, "success");
  };

  const clearCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    saveState();
    showToast("Canvas cleared", "success");
  };

  const rotate = (degrees: 90 | -90 | 180) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const w = c.width, h = c.height;
    const img = ctx.getImageData(0, 0, w, h);
    const canvas2 = document.createElement("canvas");
    canvas2.width = w; canvas2.height = h;
    canvas2.getContext("2d")!.putImageData(img, 0, 0);
    if (degrees === 90 || degrees === -90) {
      c.width = h; c.height = w;
    }
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(degrees * Math.PI / 180);
    ctx.drawImage(canvas2, -w / 2, -h / 2);
    ctx.restore();
    const overlay = overlayRef.current;
    if (overlay) { overlay.width = c.width; overlay.height = c.height; }
    saveState();
    showToast(`Rotated ${degrees}°`, "success");
  };

  const flip = (direction: "h" | "v") => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const canvas2 = document.createElement("canvas");
    canvas2.width = c.width; canvas2.height = c.height;
    canvas2.getContext("2d")!.putImageData(img, 0, 0);
    ctx.save();
    ctx.translate(direction === "h" ? c.width : 0, direction === "v" ? c.height : 0);
    ctx.scale(direction === "h" ? -1 : 1, direction === "v" ? -1 : 1);
    ctx.drawImage(canvas2, 0, 0);
    ctx.restore();
    saveState();
    showToast(`Flipped ${direction === "h" ? "horizontally" : "vertically"}`, "success");
  };

  const openResize = () => {
    const c = canvasRef.current;
    if (!c) return;
    setResizeWidth(c.width);
    setResizeHeight(c.height);
    setShowResizeDialog(true);
  };

  const applyResize = () => {
    const c = canvasRef.current;
    if (!c) return;
    if (resizeWidth < 1 || resizeHeight < 1 || resizeWidth > 10000 || resizeHeight > 10000) {
      showToast("Invalid dimensions (1-10000)", "error");
      return;
    }
    const ctx = c.getContext("2d")!;
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const canvas2 = document.createElement("canvas");
    canvas2.width = c.width; canvas2.height = c.height;
    canvas2.getContext("2d")!.putImageData(img, 0, 0);
    c.width = resizeWidth; c.height = resizeHeight;
    const overlay = overlayRef.current;
    if (overlay) { overlay.width = resizeWidth; overlay.height = resizeHeight; }
    ctx.drawImage(canvas2, 0, 0, resizeWidth, resizeHeight);
    setShowResizeDialog(false);
    saveState();
    showToast("Canvas resized", "success");
  };

  const cursorXRef = useRef(0);
  const cursorYRef = useRef(0);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!spaceHeld) {
      const p = getCanvasCoords(e);
      cursorXRef.current = Math.round(p.x);
      cursorYRef.current = Math.round(p.y);
      setCursorPos({ x: cursorXRef.current, y: cursorYRef.current });
    }
    handleMouseMove(e);
  };

  const tools: { id: DrawTool; label: string; shortcut: string }[] = [
    { id: "pen", label: "Pen", shortcut: "P" },
    { id: "line", label: "Line", shortcut: "L" },
    { id: "arrow", label: "Arrow", shortcut: "A" },
    { id: "rect", label: "Rect", shortcut: "R" },
    { id: "circle", label: "Circle", shortcut: "C" },
    { id: "text", label: "Text", shortcut: "T" },
    { id: "eraser", label: "Eraser", shortcut: "E" },
    { id: "crop", label: "Crop", shortcut: "V" },
  ];

  const filters: Filter[] = ["none", "grayscale", "sepia", "invert", "blur"];

  return (
    <div className="panel" style={{ padding: 0, position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .canvas-editor-btn { height: 30px; font-size: 11px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--hairline); background: transparent; color: var(--body); cursor: pointer; font-family: var(--font-sans); white-space: nowrap; transition: all 0.1s; display: inline-flex; align-items: center; gap: 4px; }
        .canvas-editor-btn:hover { background: var(--surface-soft); border-color: var(--hairline-strong); }
        .canvas-editor-btn.active { background: var(--accent); border-color: var(--accent); color: #000; }
        .canvas-editor-btn.active:hover { opacity: 0.9; }
        .canvas-editor-btn:disabled { opacity: 0.3; cursor: default; }
        .canvas-editor-btn:disabled:hover { background: transparent; border-color: var(--hairline); }
        .canvas-editor-btn.danger { color: var(--danger); }
        .canvas-editor-btn.danger:hover { background: rgba(255,59,48,0.1); border-color: var(--danger); }
        .ce-toolbar { display: flex; gap: 4px; align-items: center; padding: 6px 8px; background: var(--surface-card); border-bottom: 1px solid var(--hairline); flex-wrap: wrap; }
        .ce-divider { width: 1px; height: 20px; background: var(--hairline); margin: 0 4px; flex-shrink: 0; }
        .ce-label { font-family: var(--font-mono); font-size: 9px; color: var(--mute); text-transform: uppercase; letter-spacing: 1px; margin-right: 4px; }
        .ce-shortcut { font-family: var(--font-mono); font-size: 9px; color: var(--mute); opacity: 0.6; }
        input[type="range"].ce-slider { width: 64px; height: 4px; -webkit-appearance: none; appearance: none; background: var(--hairline-strong); border-radius: 2px; outline: none; cursor: pointer; }
        input[type="range"].ce-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--accent); border: none; cursor: pointer; }
        .ce-checkerboard { background-image: linear-gradient(45deg, #1a1a1a 25%, transparent 25%), linear-gradient(-45deg, #1a1a1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a1a 75%), linear-gradient(-45deg, transparent 75%, #1a1a1a 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px; }
      `}</style>

      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: toast.type === "success" ? "var(--success)" : "var(--danger)",
          color: "#fff", padding: "8px 16px", borderRadius: 8,
          fontFamily: "var(--font-mono)", fontSize: 12,
          animation: "slideIn 0.15s ease",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}>{toast.text}</div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Canvas Editor</h2>
          <span style={{ fontSize: 10, color: "var(--mute)", fontFamily: "var(--font-mono)" }}>
            {history.length > 0 && canvasRef.current ? `${canvasRef.current.width} × ${canvasRef.current.height}` : "no image"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="canvas-editor-btn" onClick={() => fileRef.current?.click()}>
            Open
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileUpload} />
          <button className="canvas-editor-btn" onClick={() => { fetchGallery(); setShowGallery(!showGallery); }}>
            Gallery
          </button>
          <div style={{ position: "relative" }}>
            <button className="canvas-editor-btn" style={{ background: showExportMenu ? "var(--surface-soft)" : undefined }} onClick={() => setShowExportMenu(!showExportMenu)}>
              Export ▾
            </button>
            {showExportMenu && (
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 200,
                background: "var(--surface-overlay)", border: "1px solid var(--hairline-strong)",
                borderRadius: 8, padding: 4, minWidth: 120, boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              }}>
                {(["png", "jpeg", "webp"] as ExportFormat[]).map(f => (
                  <button key={f} className="canvas-editor-btn" style={{ display: "flex", width: "100%", borderRadius: 4, justifyContent: "flex-start", border: "none", padding: "6px 10px", height: "auto" }} onClick={() => download(f)}>
                    Export as {f.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* URL input bar */}
      <div style={{ display: "flex", gap: 6, padding: "6px 16px", borderBottom: "1px solid var(--hairline)", alignItems: "center", background: "var(--surface)" }}>
        <input
          className="input"
          placeholder="Paste image URL and press Enter..."
          value={imageUrl}
          onChange={e => setImageUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && imageUrl.trim()) loadImageToCanvas(imageUrl.trim()); }}
          style={{ flex: 1, fontSize: 13, height: 32 }}
        />
        <button className="canvas-editor-btn" style={{ height: 32 }} onClick={() => { if (imageUrl.trim()) loadImageToCanvas(imageUrl.trim()); }}>
          Load URL
        </button>
      </div>

      {/* Gallery panel */}
      {showGallery && (
        <div style={{
          borderBottom: "1px solid var(--hairline)", padding: "10px 16px",
          background: "var(--surface)", maxHeight: 180, overflowY: "auto",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--mute)", textTransform: "uppercase", letterSpacing: 1 }}>Gallery</span>
            <button className="canvas-editor-btn" onClick={() => setShowGallery(false)} style={{ height: 24, padding: "0 8px" }}>Close</button>
          </div>
          {loadingGallery ? (
            <div style={{ textAlign: "center", color: "var(--mute)", padding: 16, fontSize: 12 }}>
              <div className="loading-spinner" style={{ margin: "0 auto 8px" }} />
              Loading...
            </div>
          ) : galleryImages.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--mute)", padding: 16, fontSize: 12 }}>
              No images in gallery.
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {galleryImages.map(name => (
                <div
                  key={name}
                  onClick={() => handleGalleryPick(name)}
                  style={{
                    width: 72, height: 72, borderRadius: 6, overflow: "hidden",
                    border: "1px solid var(--hairline)", cursor: "pointer",
                    transition: "border-color 0.12s",
                    background: "var(--surface-soft)", flexShrink: 0,
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--hairline)"}
                >
                  <img
                    src={`/api/gallery/${encodeURIComponent(name)}`}
                    alt={name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main toolbar */}
      <div className="ce-toolbar">
        <span className="ce-label">Draw</span>
        {tools.map(t => (
          <button
            key={t.id}
            className={`canvas-editor-btn ${tool === t.id ? "active" : ""}`}
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.shortcut})`}
          >
            {t.label} <span className="ce-shortcut">{t.shortcut}</span>
          </button>
        ))}
        <div className="ce-divider" />

        <span className="ce-label">Style</span>
        <div style={{ position: "relative" }}>
          <button
            className="canvas-editor-btn"
            onClick={() => setShowColorPicker(!showColorPicker)}
            style={{ width: 30, padding: 0, minWidth: 30, borderRadius: "50%", background: brushColor, border: "2px solid var(--hairline-strong)", height: 30 }}
          />
          {showColorPicker && (
            <div style={{
              position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 100,
              background: "var(--surface-overlay)", border: "1px solid var(--hairline-strong)",
              borderRadius: 8, padding: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              width: 176,
            }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {PRESET_COLORS.map(c => (
                  <div
                    key={c}
                    onClick={() => { setBrushColor(c); setShowColorPicker(false); }}
                    style={{
                      width: 22, height: 22, borderRadius: "50%", cursor: "pointer",
                      background: c,
                      border: c === "#ffffff" || c === "#d1d1d6" ? "1px solid var(--hairline)" : "none",
                      outline: brushColor === c ? "2px solid var(--accent)" : "none",
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--mute)" }}>Custom</span>
                <input
                  type="color"
                  value={brushColor}
                  onChange={e => setBrushColor(e.target.value)}
                  style={{ flex: 1, height: 26, border: "none", background: "transparent", cursor: "pointer", padding: 0 }}
                />
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--mute)", minWidth: 16 }}>{brushSize}</span>
          <input
            type="range"
            className="ce-slider"
            min={1}
            max={40}
            value={brushSize}
            onChange={e => setBrushSize(Number(e.target.value))}
          />
        </div>

        {(tool === "rect" || tool === "circle") && (
          <>
            <div className="ce-divider" />
            <button
              className={`canvas-editor-btn ${fillShapes ? "active" : ""}`}
              onClick={() => setFillShapes(!fillShapes)}
              title="Toggle fill (F)"
              style={{ fontSize: 10 }}
            >
              Fill <span className="ce-shortcut">F</span>
            </button>
          </>
        )}

        {tool === "text" && (
          <>
            <div className="ce-divider" />
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--mute)" }}>Size</span>
              <select
                value={textFontSize}
                onChange={e => setTextFontSize(Number(e.target.value))}
                style={{
                  background: "transparent", border: "1px solid var(--hairline)", borderRadius: 4,
                  color: "var(--body)", fontSize: 11, padding: "2px 4px", fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                }}
              >
                {[12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72].map(s => (
                  <option key={s} value={s}>{s}px</option>
                ))}
              </select>
            </div>
          </>
        )}

        {tool === "crop" && (
          <>
            <div className="ce-divider" />
            <span className="ce-label">Ratio</span>
            {CROP_RATIOS.map(cr => (
              <button
                key={cr.label}
                className={`canvas-editor-btn ${cropRatio === cr.value ? "active" : ""}`}
                onClick={() => setCropRatio(cr.value)}
                style={{ fontSize: 10, padding: "0 8px" }}
              >
                {cr.label}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Second toolbar: Edit, Transform, View */}
      <div className="ce-toolbar" style={{ borderTop: "none", paddingTop: 4, paddingBottom: 4 }}>
        <span className="ce-label">Edit</span>
        <button className="canvas-editor-btn" onClick={undo} disabled={historyIndex <= 0} title="Undo (Ctrl+Z)">Undo <span className="ce-shortcut">⌘Z</span></button>
        <button className="canvas-editor-btn" onClick={redo} disabled={historyIndex >= history.length - 1} title="Redo (Ctrl+Shift+Z)">Redo <span className="ce-shortcut">⌘⇧Z</span></button>
        <button className="canvas-editor-btn danger" onClick={clearCanvas} disabled={history.length === 0}>Clear</button>

        <div className="ce-divider" />
        <span className="ce-label">Transform</span>
        <button className="canvas-editor-btn" onClick={() => rotate(-90)} disabled={history.length === 0} title="Rotate 90° CCW">↺</button>
        <button className="canvas-editor-btn" onClick={() => rotate(90)} disabled={history.length === 0} title="Rotate 90° CW">↻</button>
        <button className="canvas-editor-btn" onClick={() => flip("h")} disabled={history.length === 0} title="Flip horizontal">⇔</button>
        <button className="canvas-editor-btn" onClick={() => flip("v")} disabled={history.length === 0} title="Flip vertical">⇕</button>
        <button className="canvas-editor-btn" onClick={openResize} disabled={history.length === 0}>Resize</button>

        <div className="ce-divider" />
        <span className="ce-label">View</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button className="canvas-editor-btn" onClick={() => setZoom(z => Math.max(0.1, z - 0.25))} style={{ padding: "0 6px" }}>−</button>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--body)", minWidth: 38, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
          <button className="canvas-editor-btn" onClick={() => setZoom(z => Math.min(5, z + 0.25))} style={{ padding: "0 6px" }}>+</button>
          <input
            type="range"
            className="ce-slider"
            min={10}
            max={500}
            value={Math.round(zoom * 100)}
            onChange={e => setZoom(Number(e.target.value) / 100)}
            style={{ width: 80 }}
          />
        </div>
        <button className="canvas-editor-btn" onClick={zoomFit} disabled={history.length === 0} title="Fit to screen (0)" style={{ fontSize: 10 }}>Fit</button>
        <button className="canvas-editor-btn" onClick={() => setZoom(1)} disabled={history.length === 0} title="Actual size" style={{ fontSize: 10 }}>1:1</button>
        <button
          className={`canvas-editor-btn ${spaceHeld ? "active" : ""}`}
          onMouseDown={() => setSpaceHeld(true)}
          onMouseUp={() => setSpaceHeld(false)}
          onMouseLeave={() => setSpaceHeld(false)}
          title="Hold Space to pan"
          style={{ fontSize: 10 }}
        >
          ✋ Pan
        </button>

        <div className="ce-divider" />
        <span className="ce-label">Filters</span>
        {filters.map(f => (
          <button
            key={f}
            className={`canvas-editor-btn ${filter === f ? "active" : ""}`}
            onClick={() => applyFilter(f)}
            disabled={history.length === 0}
            style={{ fontSize: 10, padding: "0 8px" }}
          >
            {f === "none" ? "None" : f}
          </button>
        ))}
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="ce-checkerboard"
        style={{
          flex: 1, overflow: "hidden", position: "relative",
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: 200,
        }}
      >
        <div style={{
          display: history.length === 0 ? "none" : "block",
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          position: "relative",
          boxShadow: "0 2px 20px rgba(0,0,0,0.5)",
        }}>
          <canvas
            ref={canvasRef}
            style={{
              display: "block", maxWidth: "none",
              cursor: spaceHeld ? "grab" : tool === "pen" || tool === "text" ? "crosshair"
                : tool === "eraser" ? "cell"
                : tool === "crop" ? "crosshair"
                : "crosshair",
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { if (drawing) { setDrawing(false); clearOverlay(); } if (panning) { setPanning(false); setPanStart(null); } }}
          />
          <canvas
            ref={overlayRef}
            style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
          />
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "4px 16px", borderTop: "1px solid var(--hairline)",
        background: "var(--surface-card)", fontFamily: "var(--font-mono)", fontSize: 10,
        color: "var(--mute)", minHeight: 26,
      }}>
        <div style={{ display: "flex", gap: 16 }}>
          {canvasRef.current && history.length > 0 ? (
            <span>{canvasRef.current.width} × {canvasRef.current.height}px</span>
          ) : (
            <span>No image</span>
          )}
          {history.length > 0 && (
            <span>{historyIndex + 1} / {history.length} undos</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {cursorPos && history.length > 0 && (
            <span>{cursorPos.x}, {cursorPos.y}</span>
          )}
          <span>{Math.round(zoom * 100)}%</span>
          <span style={{ opacity: spaceHeld ? 1 : 0.4 }}>Pan: Space</span>
        </div>
      </div>

      {/* Text input modal */}
      {showTextInput && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
          onClick={() => setShowTextInput(false)}
        >
          <div
            style={{
              background: "var(--surface-card)", border: "1px solid var(--hairline-strong)",
              borderRadius: 8, padding: 16, width: 340,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--mute)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
              Add Text
            </div>
            <input
              ref={textInputRef}
              className="input"
              placeholder="Type your text..."
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitText(); if (e.key === "Escape") setShowTextInput(false); }}
              style={{ width: "100%", marginBottom: 10, fontSize: 14 }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setShowTextInput(false)} style={{ fontSize: 12, height: 32 }}>Cancel</button>
              <button className="btn btn-primary" onClick={commitText} style={{ fontSize: 12, height: 32 }}>Add Text</button>
            </div>
          </div>
        </div>
      )}

      {/* Resize dialog */}
      {showResizeDialog && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
          onClick={() => setShowResizeDialog(false)}
        >
          <div
            style={{
              background: "var(--surface-card)", border: "1px solid var(--hairline-strong)",
              borderRadius: 8, padding: 16, width: 300,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--mute)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
              Resize Canvas
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--mute)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>Width</div>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10000}
                  value={resizeWidth}
                  onChange={e => setResizeWidth(Number(e.target.value))}
                  style={{ width: "100%", fontSize: 13 }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--mute)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>Height</div>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10000}
                  value={resizeHeight}
                  onChange={e => setResizeHeight(Number(e.target.value))}
                  style={{ width: "100%", fontSize: 13 }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setShowResizeDialog(false)} style={{ fontSize: 12, height: 32 }}>Cancel</button>
              <button className="btn btn-primary" onClick={applyResize} style={{ fontSize: 12, height: 32 }}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
