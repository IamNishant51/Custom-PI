import { useState, useCallback, useRef, useEffect } from "react";

interface UndoAction {
  id: number;
  type: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  data: Record<string, unknown> | null;
  inverse_data: Record<string, unknown> | null;
  created_at: number;
}

export default function UndoBar() {
  const [action, setAction] = useState<UndoAction | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollLast = useCallback(async () => {
    try {
      const r = await fetch("/api/undo/last");
      if (!r.ok) return;
      const data = await r.json();
      if (data.action && (!action || data.action.id !== action.id)) {
        setAction(data.action);
        setVisible(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setVisible(false), 5000);
      }
    } catch {}
  }, [action]);

  useEffect(() => {
    const t = setInterval(pollLast, 3000);
    return () => { clearInterval(t); if (timerRef.current) clearTimeout(timerRef.current); };
  }, [pollLast]);

  const undo = useCallback(async () => {
    if (!action) return;
    try {
      const r = await fetch("/api/undo/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: action.id }),
      });
      if (r.ok) {
        setVisible(false);
        setAction(null);
      }
    } catch {}
  }, [action]);

  const dismiss = useCallback(() => {
    setVisible(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  if (!visible || !action) return null;

  return (
    <div className="undo-bar">
      <span className="undo-bar-text">{action.description}</span>
      <div className="undo-bar-actions">
        <button className="btn btn-small btn-primary" onClick={undo} style={{ fontSize: 11 }}>
          ↶ Undo
        </button>
        <button className="btn btn-small btn-ghost" onClick={dismiss} style={{ fontSize: 11 }}>
          ✕
        </button>
      </div>
    </div>
  );
}
