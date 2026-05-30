import { useState, useRef, useEffect, useCallback } from "react";

interface ChatMessage {
  role: "user" | "assistant" | "tool-call" | "tool-result";
  content: string;
  name?: string;
}

interface ChatViewProps {
  ws: WebSocket | null;
  onConnect: () => void;
}

export default function ChatView({ ws, onConnect }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamingText]);

  useEffect(() => {
    if (ws) {
      ws.onmessage = (event) => {
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
            setMessages(prev => [...prev, { role: "tool-result", content: data.result?.slice(0, 500) || "", name: data.name }]);
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
    }
    if (!ws) onConnect();
  }, [ws, onConnect]);

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

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="empty-state">
            <div className="empty-state-icon">✦</div>
            <div className="empty-state-title">Welcome to Custom-PI</div>
            <div className="empty-state-desc">
              Your AI-powered development assistant. Ask me anything about your codebase, delegate tasks, or manage your project.
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.role === "tool-call" && <><span className="tool-name">⚡ {msg.name}</span></>}
            {msg.role === "tool-result" && <><span style={{ color: "var(--accent-teal)" }}>→ {msg.name}:</span> {msg.content}</>}
            {msg.role !== "tool-call" && msg.role !== "tool-result" && msg.content}
          </div>
        ))}
        {loading && streamingText && (
          <div className="message assistant">{streamingText}</div>
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
          placeholder="Ask me anything..."
          disabled={loading}
        />
        <button className="chat-send-btn" onClick={sendMessage} disabled={loading || !input.trim()}>
          {loading ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
