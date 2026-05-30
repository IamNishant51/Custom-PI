import { useState, useEffect, useCallback, useRef } from "react";
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

interface AgentVisualState {
  status: "idle" | "running" | "calling_tool" | "done" | "error";
  currentTool: string;
  task: string;
  toolCallsCount: number;
  elapsedTime: number; // in seconds
}

export default function SubAgentPanel({ ws }: { ws: WebSocket | null }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [task, setTask] = useState("");
  const [activeTab, setActiveTab] = useState<"command" | "grid">("command");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<Array<{ text: string; type: string; timestamp: string }>>([]);
  const { toast } = useToast();

  // Swarm visual states
  const [agentStates, setAgentStates] = useState<Record<string, AgentVisualState>>({
    ceo: { status: "idle", currentTool: "", task: "", toolCallsCount: 0, elapsedTime: 0 },
    builder: { status: "idle", currentTool: "", task: "", toolCallsCount: 0, elapsedTime: 0 },
    researcher: { status: "idle", currentTool: "", task: "", toolCallsCount: 0, elapsedTime: 0 },
    reviewer: { status: "idle", currentTool: "", task: "", toolCallsCount: 0, elapsedTime: 0 },
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load available agents
  useEffect(() => {
    fetch("/api/agents")
      .then(r => r.json())
      .then(d => {
        setAgents(d.agents || []);
        if (d.agents?.length > 0) {
          setSelectedAgent(d.agents[0].name);
          const initialStates: Record<string, AgentVisualState> = {};
          d.agents.forEach((a: AgentInfo) => {
            initialStates[a.name.toLowerCase()] = {
              status: "idle",
              currentTool: "",
              task: "",
              toolCallsCount: 0,
              elapsedTime: 0
            };
          });
          setAgentStates(initialStates);
        }
      })
      .catch(() => {});
  }, []);

  // Timer tracking elapsed work time for active nodes
  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => {
        setAgentStates(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(k => {
            if (next[k].status === "running" || next[k].status === "calling_tool") {
              next[k] = { ...next[k], elapsedTime: next[k].elapsedTime + 1 };
            }
          });
          return next;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [running]);

  // Sync WebSocket messages
  useEffect(() => {
    if (!ws) return;

    const handler = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as SubAgentMessage;
      const agentKey = data.agentId.toLowerCase();
      const timeStr = new Date().toLocaleTimeString();

      const updateState = (updates: Partial<AgentVisualState>) => {
        setAgentStates(prev => {
          const current = prev[agentKey] || { status: "idle", currentTool: "", task: "", toolCallsCount: 0, elapsedTime: 0 };
          return {
            ...prev,
            [agentKey]: {
              ...current,
              ...updates
            }
          };
        });
      };

      if (data.type === "subagent_start") {
        setRunning(true);
        setActiveTab("grid");
        updateState({
          status: "running",
          task: data.task || "",
          currentTool: "",
          elapsedTime: 0,
          toolCallsCount: 0
        });
        setLogs(prev => [...prev, {
          text: `✦ Engaged Swarm Member [${data.agentId.toUpperCase()}]: ${data.task?.slice(0, 100)}`,
          type: "start",
          timestamp: timeStr
        }]);
      } else if (data.type === "subagent_tool") {
        setAgentStates(prev => {
          const current = prev[agentKey] || { status: "idle", currentTool: "", task: "", toolCallsCount: 0, elapsedTime: 0 };
          return {
            ...prev,
            [agentKey]: {
              ...current,
              status: "calling_tool",
              currentTool: data.name || "",
              toolCallsCount: current.toolCallsCount + 1
            }
          };
        });
        setLogs(prev => [...prev, {
          text: `  ↳ ${data.agentId} calling tool: [${data.name}]`,
          type: "tool",
          timestamp: timeStr
        }]);
      } else if (data.type === "subagent_done") {
        updateState({ status: "done", currentTool: "" });
        setRunning(false);
        toast(`Sub-agent ${data.agentId} completed`, "success");
        setLogs(prev => [...prev, {
          text: `✔ Swarm member [${data.agentId.toUpperCase()}] complete`,
          type: "done",
          timestamp: timeStr
        }]);
      } else if (data.type === "subagent_error") {
        updateState({ status: "error", currentTool: "" });
        setRunning(false);
        toast(`Sub-agent error: ${data.message}`, "error");
        setLogs(prev => [...prev, {
          text: `❌ Failure in [${data.agentId.toUpperCase()}]: ${data.message}`,
          type: "error",
          timestamp: timeStr
        }]);
      }
    };

    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws, toast]);

  const delegate = useCallback(() => {
    if (!selectedAgent || !task.trim() || !ws || running) return;
    const timeStr = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, {
      text: `📡 Establishing neural swarm connection with [${selectedAgent.toUpperCase()}]...`,
      type: "delegate",
      timestamp: timeStr
    }]);
    ws.send(JSON.stringify({ type: "subagent_delegate", agentId: selectedAgent, task }));
    setTask("");
  }, [selectedAgent, task, ws, running]);

  // Node highlight color mappings
  const getAgentColor = (name: string) => {
    const status = agentStates[name.toLowerCase()]?.status || "idle";
    switch (status) {
      case "running": return "#d946ef"; // Fuchsia
      case "calling_tool": return "#06b6d4"; // Cyan
      case "done": return "#10b981"; // Cyber Green
      case "error": return "#f43f5e"; // Crimson Red
      default: return "#4f46e5"; // Indigo
    }
  };

  const getAgentGlow = (name: string) => {
    const status = agentStates[name.toLowerCase()]?.status || "idle";
    switch (status) {
      case "running": return "drop-shadow(0 0 10px rgba(217, 70, 239, 0.45))";
      case "calling_tool": return "drop-shadow(0 0 12px rgba(6, 182, 212, 0.55))";
      case "done": return "drop-shadow(0 0 10px rgba(16, 185, 129, 0.45))";
      case "error": return "drop-shadow(0 0 10px rgba(244, 63, 94, 0.45))";
      default: return "none";
    }
  };

  return (
    <div>
      {/* HUD Metrics Header */}
      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat-card">
          <div className="stat-label">Neural Swarm Matrix</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{agents.length} Nodes</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Swarm Link Status</div>
          <div style={{ fontSize: 13, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <div
              className={`status-dot ${running ? "pulse" : ""}`}
              style={{
                background: running ? "#d946ef" : ws ? "#10b981" : "#f43f5e",
                boxShadow: running ? "0 0 8px #d946ef" : "none"
              }}
            />
            {running ? "Swarm engaged" : ws ? "Hologram ready" : "Disconnected"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Link Channels</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{ws ? "WebSocket Link Active" : "No link"}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className={`btn ${activeTab === "command" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setActiveTab("command")}
          style={{ cursor: "pointer" }}
        >
          Swarm Command
        </button>
        <button
          className={`btn ${activeTab === "grid" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setActiveTab("grid")}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
        >
          {running && <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "#d946ef" }} />}
          Swarm Grid Map
        </button>
      </div>

      {activeTab === "command" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div className="card">
            <div className="card-header">Swarm Target Configuration</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <select
                value={selectedAgent}
                onChange={e => setSelectedAgent(e.target.value)}
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "#191919",
                  color: "#ffffff"
                }}
                disabled={running}
              >
                {agents.map(a => (
                  <option key={a.name} value={a.name}>{a.name.toUpperCase()} — {a.description}</option>
                ))}
              </select>
              <textarea
                className="chat-input"
                rows={5}
                placeholder="Formulate neural swarming directives..."
                value={task}
                onChange={e => setTask(e.target.value)}
                disabled={running}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={delegate} disabled={running || !task.trim() || !ws}>
                  {running ? "Swarm engaged..." : "Deploy Swarm Directive"}
                </button>
                <button className="btn btn-ghost" onClick={() => setLogs([])} disabled={logs.length === 0}>
                  Clear Logs
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Available Swarm Nodes</div>
            {agents.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>
                <div className="empty-state-desc">No sub-agents found. Create them in CLI first.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 330, overflowY: "auto" }}>
                {agents.map(a => (
                  <div
                    key={a.name}
                    className={`agent-card ${selectedAgent === a.name ? "active" : ""}`}
                    onClick={() => setSelectedAgent(a.name)}
                    style={{
                      border: selectedAgent === a.name ? "1px solid #d946ef" : "1px solid rgba(255,255,255,0.08)",
                      background: selectedAgent === a.name ? "rgba(217, 70, 239, 0.08)" : "#191919",
                      padding: 12,
                      borderRadius: 8,
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#ffffff" }}>{a.name.toUpperCase()}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{a.description}</div>
                    <div style={{ fontSize: 11, color: "var(--body)", marginTop: 4 }}>
                      <span style={{ color: "#d946ef" }}>Capabilities</span>: {a.tools.join(", ") || "none"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--body)", marginTop: 2 }}>
                      <span style={{ color: "#06b6d4" }}>Host Model</span>: {a.model}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Neural Swarm Map Grid Panel */
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr", gap: 16, marginBottom: 16 }}>
          {/* Holographic SVG Mind Map */}
          <div
            className="card"
            style={{
              padding: 12,
              background: "#08080a",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "12px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              height: 480,
              position: "relative",
              overflow: "hidden"
            }}
          >
            {/* Tech Scanlines */}
            <div className="tech-scanline" />

            <svg viewBox="0 0 500 440" style={{ width: "100%", height: "100%", maxHeight: 420 }}>
              <defs>
                <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#d946ef" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#d946ef" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="cyber-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#d946ef" stopOpacity="0.5" />
                </linearGradient>
                <filter id="glow-effect">
                  <feGaussianBlur stdDeviation="3.5" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>

              {/* Data Highway Channels */}
              {/* CEO to Builder */}
              <line
                x1="250" y1="90" x2="110" y2="220"
                stroke={getAgentColor("builder") !== "#4f46e5" ? "#06b6d4" : "#1f1f2e"}
                strokeWidth="2"
                strokeDasharray="8 6"
                className={agentStates.builder?.status !== "idle" ? "highway-active-cyan" : ""}
              />
              {/* CEO to Researcher */}
              <line
                x1="250" y1="90" x2="390" y2="220"
                stroke={getAgentColor("researcher") !== "#4f46e5" ? "#06b6d4" : "#1f1f2e"}
                strokeWidth="2"
                strokeDasharray="8 6"
                className={agentStates.researcher?.status !== "idle" ? "highway-active-cyan" : ""}
              />
              {/* CEO to Reviewer */}
              <line
                x1="250" y1="90" x2="250" y2="350"
                stroke={getAgentColor("reviewer") !== "#4f46e5" ? "#d946ef" : "#1f1f2e"}
                strokeWidth="2"
                strokeDasharray="8 6"
                className={agentStates.reviewer?.status !== "idle" ? "highway-active-purple" : ""}
              />
              {/* Researcher to Builder */}
              <line
                x1="390" y1="220" x2="110" y2="220"
                stroke={agentStates.researcher?.status !== "idle" && agentStates.builder?.status !== "idle" ? "#d946ef" : "#1f1f2e"}
                strokeWidth="1.5"
                strokeDasharray="5 5"
                className={agentStates.researcher?.status !== "idle" ? "highway-active-purple" : ""}
              />
              {/* Builder to Reviewer */}
              <line
                x1="110" y1="220" x2="250" y2="350"
                stroke={getAgentColor("reviewer") !== "#4f46e5" ? "#06b6d4" : "#1f1f2e"}
                strokeWidth="2"
                strokeDasharray="8 6"
                className={agentStates.reviewer?.status !== "idle" ? "highway-active-cyan" : ""}
              />

              {/* Node CEO */}
              <g transform="translate(250, 90)" filter="url(#glow-effect)" style={{ filter: getAgentGlow("ceo") }}>
                <circle r="36" fill="rgba(10, 10, 15, 0.9)" stroke={getAgentColor("ceo")} strokeWidth="2.5" />
                <circle r="44" fill="none" stroke={getAgentColor("ceo")} strokeWidth="1" strokeDasharray="6 4" className="rotate-clockwise" />
                {agentStates.ceo?.status !== "idle" && <circle r="52" fill="none" stroke="#d946ef" strokeWidth="0.5" strokeOpacity="0.5" className="ping-ring" />}
                <text fill="#ffffff" fontSize="11" fontFamily="monospace" fontWeight="bold" textAnchor="middle" y="4">CEO</text>
              </g>

              {/* Node Builder */}
              <g transform="translate(110, 220)" filter="url(#glow-effect)" style={{ filter: getAgentGlow("builder") }}>
                <circle r="30" fill="rgba(10, 10, 15, 0.9)" stroke={getAgentColor("builder")} strokeWidth="2" />
                <circle r="38" fill="none" stroke={getAgentColor("builder")} strokeWidth="1" strokeDasharray="4 6" className="rotate-counter" />
                {agentStates.builder?.status !== "idle" && <circle r="46" fill="none" stroke="#06b6d4" strokeWidth="0.5" strokeOpacity="0.5" className="ping-ring" />}
                <text fill="#ffffff" fontSize="10" fontFamily="monospace" fontWeight="bold" textAnchor="middle" y="3">BUILDER</text>
              </g>

              {/* Node Researcher */}
              <g transform="translate(390, 220)" filter="url(#glow-effect)" style={{ filter: getAgentGlow("researcher") }}>
                <circle r="30" fill="rgba(10, 10, 15, 0.9)" stroke={getAgentColor("researcher")} strokeWidth="2" />
                <circle r="38" fill="none" stroke={getAgentColor("researcher")} strokeWidth="1" strokeDasharray="4 6" className="rotate-clockwise" />
                {agentStates.researcher?.status !== "idle" && <circle r="46" fill="none" stroke="#06b6d4" strokeWidth="0.5" strokeOpacity="0.5" className="ping-ring" />}
                <text fill="#ffffff" fontSize="10" fontFamily="monospace" fontWeight="bold" textAnchor="middle" y="3">RESEARCH</text>
              </g>

              {/* Node Reviewer */}
              <g transform="translate(250, 350)" filter="url(#glow-effect)" style={{ filter: getAgentGlow("reviewer") }}>
                <circle r="30" fill="rgba(10, 10, 15, 0.9)" stroke={getAgentColor("reviewer")} strokeWidth="2" />
                <circle r="38" fill="none" stroke={getAgentColor("reviewer")} strokeWidth="1" strokeDasharray="8 4" className="rotate-counter" />
                {agentStates.reviewer?.status !== "idle" && <circle r="46" fill="none" stroke="#d946ef" strokeWidth="0.5" strokeOpacity="0.5" className="ping-ring" />}
                <text fill="#ffffff" fontSize="10" fontFamily="monospace" fontWeight="bold" textAnchor="middle" y="3">REVIEWER</text>
              </g>
            </svg>

            {/* Tactical Grid Overlay Info */}
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                fontFamily: "monospace",
                fontSize: 9,
                color: "rgba(255,255,255,0.3)"
              }}
            >
              GRID REF: 500x440 // SWARM_NET
            </div>
          </div>

          {/* Diagnostic Swarm Monitors & Output logs */}
          <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 16, height: 480 }}>
            {/* Swarm Node Health Deck */}
            <div className="card" style={{ display: "flex", flexDirection: "column", padding: 12, overflow: "hidden" }}>
              <div className="card-header" style={{ marginBottom: 8, flexShrink: 0 }}>Diagnostic Node Deck</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flexGrow: 1 }}>
                {Object.entries(agentStates).map(([name, state]) => {
                  const isActive = state.status === "running" || state.status === "calling_tool";
                  const color = getAgentColor(name);
                  return (
                    <div
                      key={name}
                      style={{
                        background: "rgba(255,255,255,0.02)",
                        border: `1px solid ${isActive ? color : "rgba(255,255,255,0.05)"}`,
                        borderRadius: 6,
                        padding: "8px 12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: "#ffffff" }}>
                          {name.toUpperCase()} <span style={{ fontSize: 9, color, marginLeft: 6 }}>[{state.status}]</span>
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                          {state.currentTool ? `Executing: ${state.currentTool}` : "Resting"}
                        </div>
                      </div>

                      {/* Looping ECG waveform representing model activity state */}
                      <div style={{ width: 80, height: 20 }}>
                        <svg viewBox="0 0 100 30" width="100%" height="100%">
                          <path
                            d="M0 15 L20 15 L28 5 L36 25 L44 15 L100 15"
                            fill="none"
                            stroke={color}
                            strokeWidth={isActive ? "2" : "1"}
                            strokeDasharray={isActive ? "none" : "none"}
                            className={isActive ? "pulse-active-ecg" : "pulse-idle-ecg"}
                          />
                        </svg>
                      </div>

                      <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 10, minWidth: 65 }}>
                        <div>T-Calls: {state.toolCallsCount}</div>
                        <div style={{ color: "var(--muted)", marginTop: 2 }}>Time: {state.elapsedTime}s</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* System Console */}
            <div className="card" style={{ display: "flex", flexDirection: "column", padding: 12, overflow: "hidden" }}>
              <div className="card-header" style={{ marginBottom: 6, flexShrink: 0 }}>Directive Stream Log</div>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: 10,
                  lineHeight: 1.5,
                  overflowY: "auto",
                  flexGrow: 1,
                  background: "#050506",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 6,
                  padding: 8,
                  color: "#d1d1db"
                }}
              >
                {logs.length === 0 ? (
                  <div style={{ color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: 24 }}>
                    [ Neural link synchronized. Awaiting input. ]
                  </div>
                ) : (
                  logs.map((log, i) => (
                    <div
                      key={i}
                      style={{
                        marginBottom: 6,
                        color:
                          log.type === "start" ? "#d946ef" :
                          log.type === "tool" ? "#06b6d4" :
                          log.type === "done" ? "#10b981" :
                          log.type === "error" ? "#f43f5e" : "#ffffff"
                      }}
                    >
                      <span style={{ color: "rgba(255,255,255,0.15)", marginRight: 4 }}>[{log.timestamp}]</span>
                      {log.text}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global CSS Inject for Dashboard Animations */}
      <style>{`
        /* Node Rotations */
        @keyframes rotateCw {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes rotateCcw {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(-360deg); }
        }
        .rotate-clockwise {
          transform-origin: center;
          animation: rotateCw 14s linear infinite;
        }
        .rotate-counter {
          transform-origin: center;
          animation: rotateCcw 10s linear infinite;
        }

        /* Tactical Radar Scan ping rings */
        @keyframes radarPing {
          0% { r: 30px; opacity: 0.8; }
          100% { r: 85px; opacity: 0; }
        }
        .ping-ring {
          transform-origin: center;
          animation: radarPing 2.2s cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
        }

        /* Neural Highway Flow Line Dash offsets */
        @keyframes highwayFlow {
          100% { stroke-dashoffset: -35; }
        }
        .highway-active-cyan {
          animation: highwayFlow 1.8s linear infinite;
        }
        .highway-active-purple {
          animation: highwayFlow 1.4s linear infinite;
        }

        /* ECG Waveform Pulse heartbeats */
        @keyframes ecgIdle {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -40; }
        }
        @keyframes ecgActive {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -60; }
        }
        .pulse-idle-ecg {
          stroke-dasharray: 200;
          animation: ecgIdle 8s linear infinite;
        }
        .pulse-active-ecg {
          stroke-dasharray: 150;
          animation: ecgActive 2.5s linear infinite;
        }

        /* Glassmorphic scanline overlay effect */
        .tech-scanline {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(
            rgba(18, 16, 24, 0) 50%, 
            rgba(0, 0, 0, 0.25) 50%
          );
          background-size: 100% 4px;
          pointer-events: none;
          opacity: 0.45;
        }

        /* Engagement glow pulse classes */
        @keyframes dotPulse {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.4); opacity: 1; }
        }
        .status-dot.pulse {
          animation: dotPulse 1.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
