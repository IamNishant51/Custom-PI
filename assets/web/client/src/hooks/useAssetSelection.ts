import { useState, useEffect, useCallback, useRef } from "react";

interface AssetSelectionRequest {
  id: string;
  filenames: string[];
  prompt: string;
}

export function useAssetSelection(ws: WebSocket | null) {
  const [request, setRequest] = useState<AssetSelectionRequest | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(true);

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
          setRequest({ id: data.id, filenames: data.filenames, prompt: data.prompt });
          setSelected(null);
          setAnswered(false);
        }
        if (data.type === "user_question_resolved") {
          if (!mountedRef.current) return;
          setAnswered(true);
          clearTimer.current = setTimeout(() => {
            if (mountedRef.current) setRequest(null);
          }, 800);
        }
      } catch {}
    };
    ws.addEventListener("message", handler);
    return () => {
      ws.removeEventListener("message", handler);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [ws]);

  const send = useCallback((answer: string) => {
    if (!ws || !request) return;
    ws.send(JSON.stringify({ type: "user_answer", questionId: request.id, answer }));
    setAnswered(true);
  }, [ws, request]);

  const reset = useCallback(() => {
    setRequest(null);
    setSelected(null);
    setAnswered(false);
  }, []);

  return { request, selected, setSelected, answered, send, reset };
}
