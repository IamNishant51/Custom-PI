import { useState, useEffect, useCallback, useRef } from "react";

interface PostPreview {
  id: string;
  platform: string;
  content: string;
  title?: string;
  platformSpecific?: string;
  assetUrl?: string;
}

interface EditRequest {
  id: string;
  content: string;
}

export function usePostApproval(ws: WebSocket | null) {
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [editReq, setEditReq] = useState<EditRequest | null>(null);
  const [editText, setEditText] = useState("");
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
        if (data.type === "post_preview") {
          if (!mountedRef.current) return;
          setPreview({
            id: data.id,
            platform: data.platform,
            content: data.content,
            title: data.title,
            platformSpecific: data.platformSpecific,
            assetUrl: data.assetUrl,
          });
          setEditText(data.content);
          setAnswered(false);
        }
        if (data.type === "post_edit_request") {
          if (!mountedRef.current) return;
          setEditReq({ id: data.id, content: data.content });
          setEditText(data.content);
        }
        if (data.type === "user_question_resolved") {
          if (!mountedRef.current) return;
          setAnswered(true);
          clearTimer.current = setTimeout(() => {
            if (mountedRef.current) { setPreview(null); setEditReq(null); }
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

  const send = useCallback((type: string, payload: Record<string, string>) => {
    if (!ws) return;
    ws.send(JSON.stringify({ type, ...payload }));
  }, [ws]);

  const reset = useCallback(() => {
    setPreview(null);
    setEditReq(null);
    setEditText("");
    setAnswered(false);
  }, []);

  return { preview, editReq, editText, setEditText, answered, send, reset, setAnswered };
}
