import { useState, useRef, useEffect } from "react";
import Markdown from "./Markdown";
import { useChat, type ChatItem } from "../context/ChatContext";

const TUI_BANNER = `  ██████╗ ██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ███╗      ██████╗ ██╗
 ██╔════╝ ██║   ██║██╔════╝ ╚══██╔══╝██╔═══██╗████╗ ████║      ██╔══██╗██║
 ██║      ██║   ██║╚██████╗    ██║   ██║   ██║██╔████╔██║█████╗██████╔╝██║
 ██║      ██║   ██║ ╚═══██║    ██║   ██║   ██║██║╚██╔╝██║╚════╝██╔═══╝ ██║
 ╚██████╗ ╚██████╔╝██████╔╝    ██║   ╚██████╔╝██║ ╚═╝ ██║      ██║     ██║
  ╚═════╝  ╚═════╝ ╚═════╝     ╚═╝    ╚═════╝ ╚═╝     ╚═╝      ╚═╝     ╚═╝`;

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function getToolDesc(name: string, argsStr: string): string {
  try {
    const parsed = JSON.parse(argsStr);
    if (name === "view_file" || name === "write_to_file" || name === "replace_file_content" || name === "multi_replace_file_content") {
      const pathStr = parsed.AbsolutePath || parsed.TargetFile || "";
      return pathStr.split("/").pop() || pathStr;
    }
    if (name === "list_dir") {
      const pathStr = parsed.DirectoryPath || "";
      return pathStr.split("/").pop() || pathStr;
    }
    if (name === "grep_search") {
      return `"${parsed.Query}"`;
    }
    if (name === "run_command") {
      return parsed.CommandLine || "";
    }
  } catch {}
  return "";
}

export default function ChatView() {
  const { items, loading, input, setInput, sendMessage, sendInterrupt, connected } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<any[]>([]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [items]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        alert(`File "${file.name}" exceeds the 10MB size limit.`);
        continue;
      }
      const reader = new FileReader();
      if (file.type.startsWith("image/")) {
        reader.onloadend = () => {
          const base64Data = (reader.result as string).split(",")[1];
          setAttachments(prev => [...prev, {
            name: file.name,
            type: file.type,
            data: base64Data,
            previewUrl: reader.result as string
          }]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onloadend = () => {
          setAttachments(prev => [...prev, {
            name: file.name,
            type: file.type,
            text: reader.result as string
          }]);
        };
        reader.readAsText(file);
      }
    });
    e.target.value = "";
  };

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSend = () => {
    sendMessage(input, attachments);
    setAttachments([]);
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
        <input
          type="file"
          id="chat-file-upload"
          multiple
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <label htmlFor="chat-file-upload" className="chat-upload-btn" title="Upload image or file">
          📎
        </label>

        <div className="chat-input-wrapper">
          {attachments.length > 0 && (
            <div className="chat-previews">
              {attachments.map((att, idx) => (
                <div key={idx} className="preview-chip">
                  {att.previewUrl ? (
                    <img src={att.previewUrl} className="preview-thumb" />
                  ) : (
                    <span className="preview-icon">📄</span>
                  )}
                  <span className="preview-name">{att.name}</span>
                  <button type="button" className="preview-remove" onClick={() => removeAttachment(idx)}>×</button>
                </div>
              ))}
            </div>
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
        </div>

        {loading ? (
          <button className="chat-stop-btn" onClick={sendInterrupt}>
            ■
          </button>
        ) : (
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={loading || (!input.trim() && attachments.length === 0) || !connected}
          >
            &gt;
          </button>
        )}
      </div>
    </div>
  );
}

// ── Item Renderer ──────────────────────────────────────

function ChatItemRenderer({ item }: { item: ChatItem }) {
  switch (item.type) {
    case "user":
      return <UserMessage content={item.content} attachments={(item as any).attachments} />;
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
      return <AssistantMessage content={item.content} />;
    case "error":
      return <ErrorMessage content={item.content} />;
    default:
      return null;
  }
}

// ── User Message ───────────────────────────────────────

function UserMessage({ content, attachments }: { content: string; attachments?: any[] }) {
  return (
    <div className="msg msg-user stagger-item">
      <div className="msg-label">You</div>
      {attachments && attachments.length > 0 && (
        <div className="msg-user-attachments">
          {attachments.map((att, i) => (
            <div key={i} className="msg-user-attachment-chip">
              {att.previewUrl ? (
                <img src={att.previewUrl} className="msg-user-attachment-img" />
              ) : (
                <span className="msg-user-attachment-file">📄 {att.name}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="msg-content">{content}</div>
    </div>
  );
}

// ── Thinking Block ─────────────────────────────────────

function ThinkingBlock({ content, isStreaming }: {
  content: string;
  isStreaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState("0px");

  useEffect(() => {
    if (ref.current) setMaxH(expanded ? `${ref.current.scrollHeight}px` : "0px");
  }, [expanded, content]);

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
          {content ? (
            <Markdown content={content} />
          ) : (
            <span className="thinking-placeholder">Thinking...</span>
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

  const statusText = status === "running" ? "[ ]" : status === "completed" ? "[x]" : "[!]";
  const statusClass = status === "running" ? "running" : status === "completed" ? "completed" : "error";
  const desc = getToolDesc(name, args);

  return (
    <div className={`msg msg-tool stagger-item ${statusClass}`}>
      <button className="tool-header" onClick={() => setExpanded(v => !v)}>
        <span className="tool-status-icon">{statusText}</span>
        <span className="tool-name-label">
          {name} {desc && <span className="tool-desc-sub">{desc}</span>}
        </span>
        <span className={`tool-chevron ${expanded ? "rotated" : ""}`}>▸</span>
      </button>
      <div
        className="tool-body"
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
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
              <div className="tool-section-label">Output</div>
              <pre className="tool-code tool-result-text">{result}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Assistant Message ──────────────────────────────────

function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="msg msg-assistant stagger-item">
      <div className="msg-label">Assistant</div>
      <Markdown content={content} />
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
