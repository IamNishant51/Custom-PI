import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from "react";

export interface ChatItem {
  id: string;
  type: "user" | "thinking" | "tool_call" | "tool_result" | "assistant" | "error";
  content: string;
  toolName?: string;
  toolId?: string;
  toolArgs?: string;
  status?: "running" | "completed" | "error";
  isStreaming?: boolean;
}

interface ChatContextValue {
  items: ChatItem[];
  loading: boolean;
  input: string;
  setInput: (v: string) => void;
  sendMessage: (overrideText?: string, attachments?: any[]) => void;
  sendInterrupt: () => void;
  ws: WebSocket | null;
  connected: boolean;
}

const ChatContext = createContext<ChatContextValue | null>(null);

let globalId = 0;
function nextId() { return `msg_${++globalId}`; }

export function ChatProvider({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const activeStreamId = useRef<string | null>(null);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let closed = false;

    function connect() {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws`);
      socket.onopen = () => {
        if (!closed) {
          setWs(socket);
          setConnected(true);
        }
      };
      socket.onclose = () => {
        if (!closed) {
          setWs(null);
          setConnected(false);
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
      socket.onerror = () => socket.close();
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
    };
  }, []);

  const sendInterrupt = useCallback(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "interrupt" }));
    }
  }, [ws]);

  const sendMessage = useCallback((overrideText?: string, attachments?: any[]) => {
    const text = typeof overrideText === "string" ? overrideText.trim() : input.trim();
    const hasAttachments = attachments && attachments.length > 0;
    if ((!text && !hasAttachments) || !ws || loading) return;
    setItems(prev => [...prev, {
      id: nextId(),
      type: "user",
      content: text,
      attachments: attachments || []
    } as any]);
    setInput("");
    ws.send(JSON.stringify({
      type: "chat",
      message: text,
      attachments: attachments ? attachments.map(a => ({
        name: a.name,
        type: a.type,
        data: a.data,
        text: a.text
      })) : []
    }));
  }, [input, ws, loading]);

  useEffect(() => {
    if (!ws) return;

    const handler = (event: MessageEvent) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "session_start":
          setLoading(true);
          activeStreamId.current = nextId();
          break;

        case "thinking_delta": {
          const sid = activeStreamId.current;
          if (!sid) return;
          setItems(prev => {
            const last = prev[prev.length - 1];
            if (last && last.type === "thinking" && last.isStreaming) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, content: last.content + data.delta };
              return updated;
            }
            return [...prev, { id: sid, type: "thinking", content: data.delta, isStreaming: true }];
          });
          break;
        }

        case "token": {
          const sid = activeStreamId.current;
          if (!sid) return;
          setItems(prev => {
            const last = prev[prev.length - 1];
            if (last && last.type === "assistant" && last.isStreaming) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, content: last.content + data.text };
              return updated;
            }
            return [...prev, { id: sid, type: "assistant", content: data.text, isStreaming: true }];
          });
          break;
        }

        case "tool_call": {
          const id = data.id || nextId();
          setItems(prev => [...prev, {
            id,
            type: "tool_call",
            content: "",
            toolName: data.name,
            toolId: id,
            toolArgs: JSON.stringify(data.args, null, 2),
            status: "running",
          }]);
          break;
        }

        case "tool_result": {
          const toolId = data.id;
          setItems(prev => {
            const idx = prev.findIndex(i => i.toolId === toolId);
            if (idx === -1) return prev;
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              status: data.isError ? "error" : "completed",
              content: (data.result || "").slice(0, 1000),
            };
            return updated;
          });
          break;
        }

        case "done": {
          setItems(prev => prev.map(item =>
            item.isStreaming ? { ...item, isStreaming: false } : item
          ));
          setLoading(false);
          activeStreamId.current = null;
          break;
        }

        case "interrupted": {
          setItems(prev => prev.map(item => {
            if (item.isStreaming) return { ...item, isStreaming: false };
            if (item.type === "tool_call" && item.status === "running") return { ...item, status: "error" as const, content: "Interrupted" };
            return item;
          }));
          setLoading(false);
          activeStreamId.current = null;
          break;
        }

        case "error":
          setItems(prev => [...prev, { id: nextId(), type: "error", content: data.message }]);
          setLoading(false);
          activeStreamId.current = null;
          break;
      }
    };

    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws]);

  return (
    <ChatContext.Provider value={{ items, loading, input, setInput, sendMessage, sendInterrupt, ws, connected }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
