import { useState, useRef, useEffect, useCallback } from "react";
import { useChat, type ChatItem } from "../context/ChatContext";
import { showToast } from "./Toast";
import UserMessage from "./UserMessage";
import AssistantMessage from "./AssistantMessage";
import ThinkingBlock from "./ThinkingBlock";
import ToolCallItem from "./ToolCallItem";
import ErrorMessage from "./ErrorMessage";

const TUI_BANNER = `  ██████╗ ██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ███╗      ██████╗ ██╗
 ██╔════╝ ██║   ██║██╔════╝ ╚══██╔══╝██╔═══██╗████╗ ████║      ██╔══██╗██║
 ██║      ██║   ██║╚██████╗    ██║   ██║   ██║██╔████╔██║█████╗██████╔╝██║
 ██║      ██║   ██║ ╚═══██║    ██║   ██║   ██║██║╚██╔╝██║╚════╝██╔═══╝ ██║
 ╚██████╗ ╚██████╔╝██████╔╝    ██║   ╚██████╔╝██║ ╚═╝ ██║      ██║     ██║
  ╚═════╝  ╚═════╝ ╚═════╝     ╚═╝    ╚═════╝ ╚═╝     ╚═╝      ╚═╝     ╚═╝`;

const QUICK_ACTIONS = [
  "What can you do?",
  "Explain the codebase structure",
  "Review current work products",
  "Run a quick scan",
  "Help me debug an issue",
  "Summarize my last session",
  "Create a new agent",
  "Analyze git history",
];

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export default function ChatView() {
  const { items, loading, input, setInput, sendMessage, sendInterrupt, connected } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [collapsedThinkingIds, setCollapsedThinkingIds] = useState<Set<string>>(new Set());
  const [socialStatus, setSocialStatus] = useState<any>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  useEffect(() => {
    fetch("/api/social/status").then(r => r.json()).then(setSocialStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [items, userScrolledUp]);

  const handleScroll = useCallback(() => {
    const el = chatMessagesRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setUserScrolledUp(!atBottom);
  }, []);

  const toggleThinkingCollapse = (thinkingId: string) => {
    setCollapsedThinkingIds(prev => {
      const next = new Set(prev);
      if (next.has(thinkingId)) {
        next.delete(thinkingId);
      } else {
        next.add(thinkingId);
      }
      return next;
    });
  };

  const findAssociatedThinkingId = (userMsgIndex: number): string | null => {
    for (let i = userMsgIndex + 1; i < items.length; i++) {
      if (items[i].type === "thinking") {
        return items[i].id;
      }
      if (items[i].type === "user") {
        break;
      }
    }
    return null;
  };

  const getAgentThreads = useCallback(() => {
    const threads: { id: string; tools: ChatItem[] }[] = [];
    let current: ChatItem[] | null = null;
    for (const item of items) {
      if (item.type === "tool_call") {
        if (!current) current = [];
        current.push(item);
      } else if (item.type === "tool_result") {
        if (current) {
          current.push(item);
        }
      } else {
        if (current && current.length > 0) {
          threads.push({ id: `thread_${threads.length}`, tools: current });
          current = null;
        }
      }
    }
    if (current && current.length > 0) {
      threads.push({ id: `thread_${threads.length}`, tools: current });
    }
    return threads;
  }, [items]);

  const exportChat = useCallback(async (format: "markdown" | "json") => {
    const lines: string[] = [];
    for (const item of items) {
      switch (item.type) {
        case "user": lines.push(`## User\n\n${item.content}\n`); break;
        case "assistant": lines.push(`## Assistant\n\n${item.content}\n`); break;
        case "thinking": lines.push(`> **Thinking** (${item.isStreaming ? "streaming" : "done"})\n\n> ${item.content}\n`); break;
        case "tool_call":
          lines.push(`> **Tool: ${item.toolName}** (${item.status})\n\`\`\`\n${item.toolArgs}\n\`\`\`\n`);
          if (item.content) lines.push(`> Result:\n\`\`\`\n${item.content}\n\`\`\`\n`);
          break;
        case "error": lines.push(`## Error\n\n${item.content}\n`); break;
      }
    }
    const text = lines.join("\n---\n\n");
    if (format === "json") {
      const json = JSON.stringify(items, null, 2);
      downloadFile(json, "chat-export.json", "application/json");
    } else {
      await navigator.clipboard.writeText(text);
      showToast("Chat copied to clipboard", "success");
    }
  }, [items]);

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setShowSlashMenu(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      if (showSlashMenu) {
        e.preventDefault();
        const filtered = getSlashCommands();
        if (filtered.length > 0) {
          handleActionChipClick(filtered[0].action);
          setShowSlashMenu(false);
        }
        return;
      }
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (val === "/") {
      setShowSlashMenu(true);
      setSlashFilter("");
    } else if (val.startsWith("/") && showSlashMenu) {
      setSlashFilter(val.slice(1));
    } else {
      setShowSlashMenu(false);
    }
  };

  const getSlashCommands = () => {
    const commands = [
      { label: "help", action: "What can you do?", icon: "?" },
      { label: "explain", action: "Explain the codebase structure", icon: "i" },
      { label: "review", action: "Review current work products", icon: "r" },
      { label: "debug", action: "Help me debug an issue", icon: "d" },
      { label: "summarize", action: "Summarize my last session", icon: "s" },
      { label: "scan", action: "Run a quick scan", icon: "x" },
      { label: "git", action: "Analyze git history", icon: "g" },
      { label: "agent", action: "Create a new agent", icon: "a" },
    ];
    if (!slashFilter) return commands;
    return commands.filter(c => c.label.includes(slashFilter.toLowerCase()));
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
    }
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
      <div className="chat-toolbar">
        <span className="chat-toolbar-title">
          {connected ? <span className="status-dot connected" /> : <span className="status-dot disconnected" />}
          {connected ? "Connected" : "Disconnected"}
        </span>
        <div className="chat-toolbar-actions">
          <button className="chat-toolbar-btn" onClick={() => exportChat("markdown")} title="Copy chat as Markdown">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button className="chat-toolbar-btn" onClick={() => exportChat("json")} title="Download chat as JSON">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>
      </div>

      <div className="chat-messages" ref={chatMessagesRef} onScroll={handleScroll}>
        {items.length === 0 && !loading && (
          <div className="chat-empty">
            <pre className="ascii-welcome-logo">{TUI_BANNER}</pre>
            <div className="empty-state-subtitle">CUSTOMIZED PI CODING AGENT</div>
            <div className="empty-state-desc">
              Parallel Multi-Agent Coordinator & Development Sandbox.
            </div>
            <div className="empty-state-chips">
              {QUICK_ACTIONS.map(action => (
                <button key={action} className="action-chip" onClick={() => handleActionChipClick(action)}>
                  &gt; {action}
                </button>
              ))}
            </div>
            <div className="empty-state-hint">
              Type <kbd>/</kbd> for commands or <kbd>Enter</kbd> to send
            </div>
            {socialStatus && socialStatus.platforms && (
              <div style={{ marginTop: 24, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Connected Accounts</div>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(socialStatus.platforms).map(([key, val]: any) => {
                    if (!val.configured) return null;
                    const labels: Record<string, string> = { twitter: "Twitter", reddit: "Reddit", linkedin: "LinkedIn", bluesky: "Bluesky", discord: "Discord", telegram: "Telegram" };
                    const colors: Record<string, string> = { twitter: "#1DA1F2", reddit: "#FF4500", linkedin: "#0A66C2", bluesky: "#0285FF", discord: "#5865F2", telegram: "#24A1DE" };
                    return (
                      <button key={key} className="action-chip social-chip" onClick={() => handleActionChipClick(`post on ${labels[key] || key} about `)}
                        style={{ borderLeft: `3px solid ${colors[key] || "#666"}`, padding: "6px 14px", fontSize: 12 }}>
                        {labels[key] || key}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {items.map((item, index) => (
          <ChatItemRenderer
            key={item.id}
            item={item}
            index={index}
            items={items}
            collapsedThinkingIds={collapsedThinkingIds}
            toggleThinkingCollapse={toggleThinkingCollapse}
            findAssociatedThinkingId={findAssociatedThinkingId}
          />
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

      {showSlashMenu && (
        <div className="slash-menu">
          <div className="slash-menu-header">Commands</div>
          {getSlashCommands().map(cmd => (
            <button
              key={cmd.label}
              className="slash-menu-item"
              onClick={() => { handleActionChipClick(cmd.action); setShowSlashMenu(false); }}
            >
              <span className="slash-menu-icon">{cmd.icon}</span>
              <span className="slash-menu-label">/{cmd.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="chat-input-area">
        <input
          type="file"
          id="chat-file-upload"
          multiple
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <label htmlFor="chat-file-upload" className="chat-upload-btn" title="Upload image or file">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        </label>

        <div className="chat-input-wrapper">
          {attachments.length > 0 && (
            <div className="chat-previews">
              {attachments.map((att, idx) => (
                <div key={idx} className="preview-chip">
                  {att.previewUrl ? (
                    <img src={att.previewUrl} className="preview-thumb" alt="" />
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
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={connected ? "Ask me anything... (type / for commands)" : "Connecting..."}
            disabled={loading || !connected}
          />
        </div>

        {loading ? (
          <button className="chat-stop-btn" onClick={sendInterrupt} title="Stop generation">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        ) : (
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={loading || (!input.trim() && attachments.length === 0) || !connected}
            title="Send message"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

function ChatItemRenderer({
  item,
  index,
  items,
  collapsedThinkingIds,
  toggleThinkingCollapse,
  findAssociatedThinkingId
}: {
  item: ChatItem;
  index: number;
  items: ChatItem[];
  collapsedThinkingIds: Set<string>;
  toggleThinkingCollapse: (id: string) => void;
  findAssociatedThinkingId: (idx: number) => string | null;
}) {
  switch (item.type) {
    case "user":
      const thinkingId = findAssociatedThinkingId(index);
      return (
        <UserMessage
          content={item.content}
          attachments={(item as any).attachments}
          onBubbleClick={thinkingId ? () => toggleThinkingCollapse(thinkingId) : undefined}
        />
      );
    case "thinking":
      const isCollapsed = collapsedThinkingIds.has(item.id);
      return (
        <ThinkingBlock
          content={item.content}
          isStreaming={item.isStreaming}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => toggleThinkingCollapse(item.id)}
        />
      );
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
