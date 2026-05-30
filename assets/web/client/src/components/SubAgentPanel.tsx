import { useState, useEffect, useCallback } from "react";
import { useToast } from "./Toast";

interface AgentInfo {
  name: string;
  description: string;
  tools: string[];
  model: string;
}

interface SubAgentMessage {
  type: "subagent_start" | "subagent_tool" | "subagent_done" | "subagent_error";
  agentId: string;
  task?: string;
  result?: string;
  name?: string;
  args?: any;
  message?: string;
}

export default function SubAgentPanel({ ws }: { ws: WebSocket | null }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/agents")
      .then(r => r.json())
      .then(d => {
        setAgents(d.agents || []);
        if (d.agents?.length > 0) setSelectedAgent(d.agents[0].name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ws) return;
    const handler = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as SubAgentMessage;
      if (data.type === "subagent_start") {
        setLogs(prev => [...prev, `started ${data.agentId}: ${data.task?.slice(0, 100)}`]);
      } else if (data.type === "subagent_tool") {
        setLogs(prev => [...prev, `  ${data.agentId} used ${data.name}`]);
      } else if (data.type === "subagent_done") {
        setLogs(prev => [...prev, `completed ${data.agentId}`]);
        setRunning(false);
        toast(`Sub-agent ${data.agentId} completed`, "success");
      } else if (data.type === "subagent_error") {
        setLogs(prev => [...prev, `error ${data.agentId}: ${data.message}`]);
        setRunning(false);
        toast(`Sub-agent error: ${data.message}`, "error");
      }
    };
    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws, toast]);

  const delegate = useCallback(() => {
    if (!selectedAgent || !task.trim() || !ws || running) return;
    setLogs(prev => [...prev, `Delegating to ${selectedAgent}: ${task.slice(0, 100)}...`]);
    setRunning(true);
    ws.send(JSON.stringify({ type: "subagent_delegate", agentId: selectedAgent, task }));
    setTask("");
  }, [selectedAgent, task, ws, running]);

  return (
    <div>
      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat-card">
          <div className="stat-label">Available Agents</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{agents.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Status</div>
          <div style={{ fontSize: 13, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <div className="status-dot" style={{ background: running ? "var(--mute)" : ws ? "var(--success)" : "var(--danger)" }} />
            {running ? "Running" : ws ? "Ready" : "Disconnected"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Connection</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{ws ? "WebSocket OK" : "No connection"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">Delegate Task</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <select
              value={selectedAgent}
              onChange={e => setSelectedAgent(e.target.value)}
              style={{ padding: "8px 12px" }}
              disabled={running}
            >
              {agents.map(a => (
                <option key={a.name} value={a.name}>{a.name} — {a.description}</option>
              ))}
            </select>
            <textarea
              className="chat-input"
              rows={4}
              placeholder="Describe the task for this sub-agent..."
              value={task}
              onChange={e => setTask(e.target.value)}
              disabled={running}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={delegate} disabled={running || !task.trim() || !ws}>
                {running ? "Running..." : "Delegate"}
              </button>
              <button className="btn btn-ghost" onClick={() => setLogs([])} disabled={logs.length === 0}>
                Clear Logs
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Agents</div>
          {agents.length === 0 ? (
            <div className="empty-state" style={{ padding: 12 }}>
              <div className="empty-state-desc">No sub-agents configured. Create them in the CLI first.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {agents.map(a => (
                  <div
                    key={a.name}
                    className={`agent-card ${selectedAgent === a.name ? "active" : ""}`}
                    onClick={() => setSelectedAgent(a.name)}
                  >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{a.description}</div>
                  <div style={{ fontSize: 11, color: "var(--body)", marginTop: 2 }}>
                    Tools: {a.tools.join(", ") || "none"} · Model: {a.model}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {logs.length > 0 && (
        <div className="card">
          <div className="card-header">Execution Log</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, maxHeight: 300, overflowY: "auto" }}>
              {logs.map((line, i) => (
                <div key={i} style={{ color: line.startsWith("  ") ? "var(--mute)" : line.startsWith("completed") ? "var(--success)" : line.startsWith("error") ? "var(--danger)" : line.startsWith("started") ? "var(--ink)" : "var(--body)" }}>
                  {line}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
