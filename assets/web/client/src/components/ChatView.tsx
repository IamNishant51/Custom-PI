import { useState, useRef, useEffect } from "react";
import Markdown from "./Markdown";
import { useChat, type ChatItem } from "../context/ChatContext";

const TUI_BANNER = `  ██████╗ ██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ███╗      ██████╗ ██╗
 ██╔════╝ ██║   ██║██╔════╝ ╚══██╔══╝██╔═══██╗████╗ ████║      ██╔══██╗██║
 ██║      ██║   ██║╚██████╗    ██║   ██║   ██║██╔████╔██║█████╗██████╔╝██║
 ██║      ██║   ██║ ╚═══██║    ██║   ██║   ██║██║╚██╔╝██║╚════╝██╔═══╝ ██║
 ╚██████╗ ╚██████╔╝██████╔╝    ██║   ╚██████╔╝██║ ╚═╝ ██║      ██║     ██║
  ╚═════╝  ╚═════╝ ╚═════╝     ╚═╝    ╚═════╝ ╚═╝     ╚═╝      ╚═╝     ╚═╝`;

export default function ChatView() {
  const { items, loading, input, setInput, sendMessage, sendInterrupt, connected } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [items]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleCopyClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("copy-btn")) {
      const container = target.closest(".code-block-container");
      if (container) {
        const codeLines = container.querySelectorAll(".code-line .line-content, .diff-line .line-content");
        let textToCopy = "";
        if (codeLines.length > 0) {
          textToCopy = Array.from(codeLines).map(el => (el as HTMLElement).innerText).join("\n");
        } else {
          const codeEl = container.querySelector("code");
          textToCopy = codeEl ? codeEl.innerText : "";
        }

        navigator.clipboard.writeText(textToCopy).then(() => {
          const oldText = target.innerText;
          target.innerText = "Copied!";
          target.classList.add("copied");
          setTimeout(() => {
            target.innerText = oldText;
            target.classList.remove("copied");
          }, 2000);
        });
      }
    }
  };

  const handleActionChipClick = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  return (
    <div className="chat-container" onClick={handleCopyClick}>
      <div className="chat-messages">
        {items.length === 0 && !loading && (
          <div className="chat-empty">
            <pre className="ascii-welcome-logo">{TUI_BANNER}</pre>
            <div className="empty-state-subtitle">CUSTOMIZED PI CODING AGENT</div>
            <div className="empty-state-desc">
              Parallel Multi-Agent Coordinator & Development Sandbox.
            </div>
            <div className="empty-state-chips">
              <button className="action-chip" onClick={() => handleActionChipClick("What can you do?")}>
                &gt; What can you do?
              </button>
              <button className="action-chip" onClick={() => handleActionChipClick("Explain the codebase structure")}>
                &gt; Explain codebase
              </button>
              <button className="action-chip" onClick={() => handleActionChipClick("Review current work products")}>
                &gt; Review products
              </button>
            </div>
          </div>
        )}

        {items.map(item => (
          <ChatItemRenderer key={item.id} item={item} />
        ))}

        {loading && items.length > 0 && items[items.length - 1].type === "tool_call" && items[items.length - 1].status === "running" && (
          <div className="typing-dots">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {loading && (
          <button className="chat-stop-btn" onClick={sendInterrupt}>
            ■ Stop
          </button>
        )}
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
          &gt;
        </button>
      </div>
    </div>
  );
}

// ── Item Renderer ──────────────────────────────────────

function ChatItemRenderer({ item }: { item: ChatItem }) {
  switch (item.type) {
    case "user":
      return <UserMessage content={item.content} />;
    case "thinking":
      return <ThinkingBlock content={item.content} isStreaming={item.isStreaming} />;
    case "tool_call":
      return (
        <ToolCallItem
          name={item.toolName || ""}
          args={item.toolArgs || ""}
          status={item.status || "running"}
          result={item.content}
        />
      );
    case "assistant":
      return <AssistantMessage content={item.content} isStreaming={item.isStreaming} />;
    case "error":
      return <ErrorMessage content={item.content} />;
    default:
      return null;
  }
}

// ── User Message ───────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  return (
    <div className="msg msg-user stagger-item">
      <div className="msg-label">You</div>
      <div className="msg-content">{content}</div>
    </div>
  );
}

// ── Thinking Block ─────────────────────────────────────

const THINKING_PLACEHOLDERS = [
  "Analyzing context", "Searching memory", "Processing request",
  "Connecting dots", "Formulating approach", "Reviewing codebase",
  "Weighing options", "Building strategy", "Checking logic",
  "Gathering insights", "Reasoning through", "Evaluating paths",
];

function ThinkingBlock({ content, isStreaming }: {
  content: string;
  isStreaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState("0px");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [charPos, setCharPos] = useState(0);

  useEffect(() => {
    if (!isStreaming) { setCharPos(0); return; }
    const interval = setInterval(() => {
      setCharPos(prev => {
        const current = THINKING_PLACEHOLDERS[placeholderIdx];
        if (prev >= current.length) {
          const nextIdx = (placeholderIdx + 1) % THINKING_PLACEHOLDERS.length;
          setPlaceholderIdx(nextIdx);
          return 0;
        }
        return prev + 1;
      });
    }, 50);
    return () => clearInterval(interval);
  }, [isStreaming, placeholderIdx]);

  useEffect(() => {
    if (ref.current) setMaxH(expanded ? `${ref.current.scrollHeight}px` : "0px");
  }, [expanded, content]);

  const placeholderText = THINKING_PLACEHOLDERS[placeholderIdx].slice(0, charPos);

  return (
    <div className="msg msg-thinking stagger-item">
      <button className="thinking-header" onClick={() => setExpanded(v => !v)}>
        <span className={`thinking-chevron ${expanded ? "rotated" : ""}`}>▸</span>
        <span className="thinking-label">Reasoning</span>
      </button>
      <div
        className="thinking-body"
        style={{
          maxHeight: maxH,
          transition: "max-height 0.25s ease",
        }}
      >
        <div ref={ref} className="thinking-content">
          {isStreaming ? (
            <span className="thinking-placeholder">{placeholderText}</span>
          ) : (
            <Markdown content={content} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tool Call Item ─────────────────────────────────────

function ToolCallItem({ name, args, status, result }: {
  name: string;
  args: string;
  status: "running" | "completed" | "error";
  result: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = status === "running" ? "●" : status === "completed" ? "✓" : "✗";
  const statusClass = status === "running" ? "running" : status === "completed" ? "completed" : "error";

  return (
    <div className={`msg msg-tool stagger-item ${statusClass}`}>
      <button className="tool-header" onClick={() => setExpanded(v => !v)}>
        <span className="tool-status-icon">{statusIcon}</span>
        <span className="tool-name-label">{name}</span>
        <span className={`tool-chevron ${expanded ? "rotated" : ""}`}>▸</span>
      </button>
      <div
        className="tool-body"
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 0.2s ease",
        }}
      >
        <div className="tool-inner">
          {args && (
            <div className="tool-section">
              <div className="tool-section-label">Arguments</div>
              <pre className="tool-code">{args}</pre>
            </div>
          )}
          {result && (
            <div className="tool-section">
              <div className="tool-section-label">Result</div>
              <pre className="tool-code tool-result-text">{result}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Assistant Message ──────────────────────────────────

function AssistantMessage({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className="msg msg-assistant stagger-item">
      <div className="msg-label">Assistant</div>
      <Markdown content={content} />
      {isStreaming && <span className="streaming-cursor" />}
    </div>
  );
}

// ── Error Message ──────────────────────────────────────

function ErrorMessage({ content }: { content: string }) {
  return (
    <div className="msg msg-error stagger-item">
      <div className="msg-label">Error</div>
      <div className="msg-content">{content}</div>
    </div>
  );
}
