import Markdown from "./Markdown";
import ToolCallCard from "./ToolCallCard";
import { type Agent } from "./types";

function AgentStatusBadge({ status }: { status: Agent["status"] }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    running: { bg: "rgba(168,85,247,0.15)", color: "#a855f7", label: "Working" },
    calling_tool: { bg: "rgba(6,182,212,0.15)", color: "#22d3ee", label: "Tool" },
    paused: { bg: "rgba(251,191,36,0.15)", color: "#fbbf24", label: "Paused" },
    done: { bg: "rgba(16,185,129,0.15)", color: "#34d399", label: "Done" },
    error: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "Error" },
    idle: { bg: "rgba(255,255,255,0.04)", color: "var(--mute)", label: "Idle" },
    completed: { bg: "rgba(16,185,129,0.15)", color: "#34d399", label: "Done" },
    planning: { bg: "rgba(168,85,247,0.1)", color: "#a855f7", label: "Planning" },
  };
  const s = styles[status] || styles.idle;
  return (
    <span className="agent-status-badge" style={{ background: s.bg, color: s.color, border: `1px solid ${s.color.replace("0.15","0.25").replace("0.04","0.1")}` }}>
      {status === "running" && <span className="status-pulse" />}
      {s.label}
    </span>
  );
}

interface AgentCardCompactProps {
  agent: Agent;
  selected: boolean;
  onClick: () => void;
}

export function AgentCardCompact({ agent, selected, onClick }: AgentCardCompactProps) {
  return (
    <div
      className={`agent-card-omp ${selected ? "selected" : ""} ${agent.status}`}
      onClick={onClick}
    >
      <div className="subagent-agent-card-header">
        <div className="subagent-agent-card-name-row">
          <div className="subagent-agent-avatar">{agent.id.slice(0, 2).toUpperCase()}</div>
          <div>
            <div className="subagent-agent-card-name">{agent.id}</div>
            <div className="subagent-agent-card-role">{agent.role}</div>
          </div>
        </div>
        <AgentStatusBadge status={agent.status} />
      </div>
      {agent.status === "running" && <span className="omp-badge running">◐ WORKING</span>}
      {agent.status === "done" && <span className="omp-badge done">✓ DONE</span>}
      {agent.status === "error" && <span className="omp-badge error">✗ FAILED</span>}
      {agent.currentTask && <div className="subagent-agent-card-task">{agent.currentTask}</div>}
      {agent.currentTool && <div className="subagent-agent-card-tool">tool: {agent.currentTool}</div>}
      <div className="subagent-agent-card-tools">
        {agent.tools.slice(0, 4).map((t, j) => <span key={j} className="subagent-tool-tag">{t}</span>)}
        {agent.tools.length > 4 && <span className="subagent-tool-tag">+{agent.tools.length - 4}</span>}
      </div>
      {agent.status === "running" && (
        <div className="agent-card-progress-bar">
          <div className="agent-card-progress-fill" style={{ width: `${Math.min(100, agent.logs.filter(l => l.includes("Calling tool")).length * 25)}%` }} />
        </div>
      )}
      {agent.status === "running" && <div className="agent-card-connection-line" />}
    </div>
  );
}

interface AgentLogViewProps {
  agent: Agent;
  chatMessages: Record<string, Array<{ role: "user" | "agent"; content: string }>>;
  onSendChat: (agentId: string, message: string) => void;
  onSetChatMessages: (fn: (prev: Record<string, Array<{ role: "user" | "agent"; content: string }>>) => Record<string, Array<{ role: "user" | "agent"; content: string }>>) => void;
  toast: (msg: string, type: "success" | "error" | "info") => void;
}

export function AgentLogView({ agent, chatMessages, onSendChat, onSetChatMessages, toast }: AgentLogViewProps) {
  const sendChat = (agentId: string, message: string) => {
    if (!message.trim()) return;
    onSendChat(agentId, message);
  };

  return (
    <div className="subagent-log-panel">
      <div className="subagent-log-header">
        <div className="subagent-log-header-left">
          <div className="subagent-agent-avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{agent.id.slice(0, 2).toUpperCase()}</div>
          <span className="subagent-log-header-name">{agent.id}</span>
          <AgentStatusBadge status={agent.status} />
        </div>
        {agent.result && (
          <button className="subagent-copy-btn" onClick={() => { navigator.clipboard.writeText(agent.result || ""); toast("Copied!", "success"); }}>Copy</button>
        )}
      </div>
      <div className="subagent-log-body">
        {agent.logs.map((log, i) => {
          const trimmed = log.trim();
          if (trimmed.startsWith("Calling tool:")) {
            const toolName = trimmed.replace("Calling tool:", "").trim();
            return <ToolCallCard key={i} name={toolName} status="running" />;
          }
          if (trimmed.startsWith("Tool response:")) {
            return <ToolCallCard key={i} name="Result" status="done" result={trimmed.replace("Tool response:", "").trim()} />;
          }
          const lower = trimmed.toLowerCase();
          let icon = "$";
          let cls = "";
          if (lower.startsWith("error") || lower.startsWith("❌") || lower.startsWith("✗")) { icon = "✗"; cls = "log-line-omp error"; }
          else if (lower.startsWith("✓") || lower.startsWith("✅") || lower.startsWith("complete")) { icon = "✓"; cls = "log-line-omp done"; }
          else if (lower.startsWith("→") || lower.startsWith("assign")) { icon = "→"; cls = "log-line-omp assign"; }
          else if (lower.startsWith("thinking") || lower.startsWith("◐") || lower.startsWith("analyzing")) { icon = "◐"; cls = "log-line-omp thinking"; }
          else if (lower.includes("tool") || lower.includes("calling")) { icon = "⚙"; cls = "log-line-omp tool"; }
          return (
            <div key={i} className={`subagent-log-line ${cls}`}>
              <span className="subagent-log-prompt">{icon}</span>
              <span>{log}</span>
            </div>
          );
        })}
        {(agent.status === "running" || agent.status === "calling_tool") && (
          <div className="subagent-log-line subagent-log-active"><span className="subagent-log-prompt">$</span><span className="subagent-log-cursor">processing...</span></div>
        )}
      </div>

      {chatMessages[agent.id]?.length > 0 && (
        <div className="subagent-chat-messages">
          {chatMessages[agent.id].map((msg, i) => (
            <div key={i} className={`subagent-chat-msg ${msg.role}`}>
              <span className="subagent-chat-role">{msg.role === "user" ? "You" : agent.id}</span>
              <span className="subagent-chat-text">{msg.content}</span>
            </div>
          ))}
        </div>
      )}

      <div className="subagent-chat-input-row">
        <input
          className="subagent-chat-input"
          type="text"
          placeholder="Message agent..."
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const input = e.currentTarget;
              sendChat(agent.id, input.value);
              onSetChatMessages(prev => ({
                ...prev,
                [agent.id]: [...(prev[agent.id] || []), { role: "user" as const, content: input.value }]
              }));
              input.value = "";
            }
          }}
        />
        <button className="subagent-chat-send" onClick={() => {
          const input = document.querySelector(".subagent-chat-input") as HTMLInputElement;
          if (input && input.value.trim()) {
            sendChat(agent.id, input.value);
            onSetChatMessages(prev => ({
              ...prev,
              [agent.id]: [...(prev[agent.id] || []), { role: "user" as const, content: input.value }]
            }));
            input.value = "";
          }
        }}>Send</button>
      </div>

      {agent.result && (
        <div className="subagent-log-result">
          <div className="subagent-log-result-title">Result</div>
          <Markdown content={agent.result} />
        </div>
      )}
    </div>
  );
}
