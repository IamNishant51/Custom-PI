import { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "./Markdown";
import { AsciiLightning, AsciiArrowRight, AsciiSend } from "./Icons";

interface ChatMessage {
  role: "user" | "assistant" | "tool-call" | "tool-result";
  content: string;
  name?: string;
}

interface ChatViewProps {
  ws: WebSocket | null;
}

export default function ChatView({ ws }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamingText]);

  const onMessage = useRef<(event: MessageEvent) => void>(null!);

  useEffect(() => {
    if (!ws) { setConnected(false); return; }
    setConnected(ws.readyState === WebSocket.OPEN);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    const handler = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "session_start":
          setLoading(true);
          setStreamingText("");
          break;
        case "token":
          setStreamingText(prev => prev + data.text);
          break;
        case "tool_call":
          setMessages(prev => [...prev, { role: "tool-call", content: data.name, name: data.name }]);
          break;
        case "tool_result":
          setMessages(prev => [...prev, { role: "tool-result", content: (data.result || "").slice(0, 500), name: data.name }]);
          break;
        case "done":
          setMessages(prev => [...prev, { role: "assistant", content: data.content }]);
          setStreamingText("");
          setLoading(false);
          break;
        case "error":
          setMessages(prev => [...prev, { role: "assistant", content: `Error: ${data.message}` }]);
          setStreamingText("");
          setLoading(false);
          break;
      }
    };
    onMessage.current = handler;
    ws.onmessage = handler;

    return () => { ws.onmessage = null; };
  }, [ws]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !ws || loading) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setInput("");
    ws.send(JSON.stringify({ type: "chat", message: text }));
  }, [input, ws, loading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  if (!connected && !ws) {
    return (
      <div className="chat-container">
        <div className="empty-state" style={{ padding: 40 }}>
          <div className="loading-spinner" style={{ margin: "0 auto 12px" }} />
          <div className="empty-state-title">Connecting to server...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="empty-state">
            <div className="empty-state-marker">[CUSTOM-PI v1]</div>
            <div className="empty-state-title">ready</div>
            <div className="empty-state-desc">
              Your AI-powered development assistant. Ask me anything about your codebase, delegate tasks, or manage your project.
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.role === "tool-call" && <><span className="tool-name"><AsciiLightning size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} /> {msg.name}</span></>}
            {msg.role === "tool-result" && <><span style={{ color: "var(--charcoal)" }}><AsciiArrowRight size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} /> {msg.name}:</span> {msg.content}</>}
            {msg.role === "assistant" && <Markdown content={msg.content} />}
            {msg.role === "user" && msg.content}
          </div>
        ))}
        {loading && streamingText && (
          <div className="message assistant"><Markdown content={streamingText} /><span className="streaming-cursor" /></div>
        )}
        {loading && !streamingText && (
          <div className="typing-indicator">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connected ? "Ask me anything..." : "Connecting..."}
          disabled={loading || !connected}
        />
        <button className="chat-send-btn" onClick={sendMessage} disabled={loading || !input.trim() || !connected}>
          {loading ? "..." : <AsciiSend size={16} />}
        </button>
      </div>
    </div>
  );
}
