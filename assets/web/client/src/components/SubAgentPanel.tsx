import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "./Toast";
import Markdown from "./Markdown";

interface Agent {
  id: string;
  role: string;
  tools: string[];
  status: "idle" | "running" | "calling_tool" | "paused" | "done" | "error";
  currentTool?: string;
  currentTask?: string;
  logs: string[];
  result?: string;
}

interface SwarmMessage {
  type: "swarm_start" | "ceo_thought" | "ceo_plan" | "agent_status" | "agent_log" | "agent_done" | "tool_request" | "tool_provisioned" | "ceo_summary" | "swarm_error";
  goal?: string;
  message?: string;
  agents?: Array<{ id: string; role: string; tools: string[]; task: string }>;
  agentId?: string;
  status?: Agent["status"];
  currentTool?: string;
  currentTask?: string;
  toolName?: string;
  reason?: string;
  result?: string;
  summary?: string;
}

export default function SubAgentPanel({ ws }: { ws: WebSocket | null }) {
  const [goal, setGoal] = useState("");
  const [activeGoal, setActiveGoal] = useState("");
  const [swarmStatus, setSwarmStatus] = useState<"idle" | "planning" | "running" | "done" | "error">("idle");
  const [ceoLogs, setCeoLogs] = useState<string[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [finalSummary, setFinalSummary] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState<{ agentId: string; toolName: string; status: "requested" | "created" } | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  interface SavedTeam {
    name: string;
    goal: string;
    agents: Array<{
      id: string;
      role: string;
      tools: string[];
      task: string;
    }>;
    createdAt: string;
  }

  const [savedTeams, setSavedTeams] = useState<SavedTeam[]>([]);
  const [teamNameInput, setTeamNameInput] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  // Scroll active logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ceoLogs, agents, selectedAgentId]);

  // Elapsed time counter
  useEffect(() => {
    if (swarmStatus !== "idle" && swarmStatus !== "done" && swarmStatus !== "error") {
      setElapsedTime(0);
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [swarmStatus]);

  // WebSocket event listeners
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as SwarmMessage;
        
        switch (data.type) {
          case "swarm_start":
            setSwarmStatus("planning");
            setActiveGoal(data.goal || "");
            setCeoLogs([`[CEO] Initialized new swarm campaign. Goal: "${data.goal}"`]);
            setAgents([]);
            setFinalSummary(null);
            setProvisioning(null);
            setSelectedAgentId(null);
            break;

          case "ceo_thought":
            setCeoLogs(prev => [...prev, `[CEO] ${data.message}`]);
            break;

          case "ceo_plan":
            setSwarmStatus("running");
            setCeoLogs(prev => [...prev, `[CEO] Team plan formulated with ${data.agents?.length || 0} sub-agents.`]);
            if (data.agents) {
              const parsedAgents: Agent[] = data.agents.map(a => ({
                id: a.id,
                role: a.role,
                tools: a.tools,
                status: "idle",
                currentTask: a.task,
                logs: [`Initialized agent. Role: ${a.role}`]
              }));
              setAgents(parsedAgents);
              if (parsedAgents.length > 0) {
                setSelectedAgentId(parsedAgents[0].id);
              }
            }
            break;

          case "agent_status":
            setAgents(prev => prev.map(a => {
              if (a.id === data.agentId) {
                return {
                  ...a,
                  status: data.status || a.status,
                  currentTool: data.currentTool ?? a.currentTool,
                  currentTask: data.currentTask ?? a.currentTask
                };
              }
              return a;
            }));
            break;

          case "agent_log":
            setAgents(prev => prev.map(a => {
              if (a.id === data.agentId) {
                return {
                  ...a,
                  logs: [...a.logs, data.message || ""]
                };
              }
              return a;
            }));
            break;

          case "agent_done":
            setAgents(prev => prev.map(a => {
              if (a.id === data.agentId) {
                return {
                  ...a,
                  status: "done",
                  currentTool: undefined,
                  result: data.result,
                  logs: [...a.logs, `✔ Task complete. Result summary: ${data.result?.slice(0, 150)}...`]
                };
              }
              return a;
            }));
            setCeoLogs(prev => [...prev, `[CEO] Sub-agent '${data.agentId}' successfully reported completion.`]);
            break;

          case "tool_request":
            setProvisioning({
              agentId: data.agentId || "",
              toolName: data.toolName || "",
              status: "requested"
            });
            setCeoLogs(prev => [...prev, `[CEO] WARNING: Agent '${data.agentId}' requested tool '${data.toolName}' (${data.reason || "Unique task"}). Provisioning starting.`]);
            break;

          case "tool_provisioned":
            setProvisioning({
              agentId: data.agentId || "",
              toolName: data.toolName || "",
              status: "created"
            });
            setCeoLogs(prev => [...prev, `[CEO] SUCCESS: Custom tool '${data.toolName}' created, compiled, and provided to '${data.agentId}'. Resuming agent.`]);
            // Update agent tools
            setAgents(prev => prev.map(a => {
              if (a.id === data.agentId) {
                return {
                  ...a,
                  tools: [...a.tools, data.toolName || ""],
                  logs: [...a.logs, `➕ CEO provisioned custom tool: [${data.toolName}]`]
                };
              }
              return a;
            }));
            setTimeout(() => setProvisioning(null), 4000);
            break;

          case "ceo_summary":
            setSwarmStatus("done");
            setFinalSummary(data.summary || "");
            setCeoLogs(prev => [...prev, `[CEO] Swarm campaign complete. Final report compiled.`]);
            toast("Swarm goal achieved!", "success");
            break;

          case "swarm_error":
            setSwarmStatus("error");
            setCeoLogs(prev => [...prev, `[CEO] CRITICAL ERROR: ${data.message}`]);
            toast(`Swarm error: ${data.message}`, "error");
            break;
        }
      } catch (err) {
        console.error("Error processing websocket message", err);
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws, toast]);

  const fetchSavedTeams = useCallback(async () => {
    try {
      const res = await fetch("/api/swarm/teams");
      if (res.ok) {
        const data = await res.json();
        setSavedTeams(data.teams || []);
      }
    } catch (err) {
      console.error("Failed to load saved swarm teams", err);
    }
  }, []);

  useEffect(() => {
    fetchSavedTeams();
  }, [fetchSavedTeams]);

  const launchSavedTeam = useCallback((team: SavedTeam) => {
    if (!ws) return;
    ws.send(JSON.stringify({
      type: "swarm_saved_team",
      goal: team.goal,
      agents: team.agents
    }));
    setSwarmStatus("planning");
    setActiveGoal(team.goal);
    setCeoLogs([`[CEO] Launching saved swarm team: "${team.name}". Goal: "${team.goal}"`]);
    setAgents([]);
    setFinalSummary(null);
    setProvisioning(null);
    setSelectedAgentId(null);
    toast(`Running saved team: ${team.name}`, "success");
  }, [ws, toast]);

  const saveCurrentTeam = async () => {
    if (!teamNameInput.trim()) {
      toast("Please enter a team name.", "error");
      return;
    }
    try {
      const agentsPayload = agents.map(a => ({
        id: a.id,
        role: a.role,
        tools: a.tools,
        task: a.currentTask || ""
      }));
      const res = await fetch("/api/swarm/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: teamNameInput.trim(),
          goal: activeGoal,
          agents: agentsPayload
        })
      });
      if (res.ok) {
        toast(`Team "${teamNameInput}" saved successfully!`, "success");
        setTeamNameInput("");
        setShowSaveModal(false);
        fetchSavedTeams();
      } else {
        const err = await res.json() as any;
        toast(`Error: ${err.message || "Failed to save team"}`, "error");
      }
    } catch (err: any) {
      toast(`Failed to save team: ${err.message}`, "error");
    }
  };

  const deleteSavedTeam = async (name: string) => {
    try {
      const res = await fetch("/api/swarm/teams/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        toast(`Team "${name}" deleted.`, "success");
        fetchSavedTeams();
      }
    } catch (err) {
      console.error("Failed to delete saved team", err);
    }
  };

  const startSwarm = useCallback(() => {
    if (!goal.trim() || !ws || swarmStatus === "running" || swarmStatus === "planning") return;
    ws.send(JSON.stringify({ type: "swarm_goal", goal }));
    setGoal("");
  }, [goal, ws, swarmStatus]);

  const getStatusBadge = (status: Agent["status"]) => {
    switch (status) {
      case "running":
        return <span className="badge badge-purple pulse-glow">Working</span>;
      case "calling_tool":
        return <span className="badge badge-cyan">Using Tool</span>;
      case "paused":
        return <span className="badge badge-yellow">Paused (CEO provisioning)</span>;
      case "done":
        return <span className="badge badge-green">Done</span>;
      case "error":
        return <span className="badge badge-red">Error</span>;
      default:
        return <span className="badge badge-gray">Idle</span>;
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="swarm-container">
      {/* ── Goal Input Bar (Visible when idle, done, or error) ── */}
      {(swarmStatus === "idle" || swarmStatus === "done" || swarmStatus === "error") && (
        <div className="saved-teams-grid">
          {/* Define Swarm Objectives */}
          <div className="card goal-card" style={{ height: "fit-content" }}>
            <div className="card-header font-bold text-lg">Define Swarm Objectives</div>
            <p className="card-desc">Enter a high-level goal. The CEO agent will build a custom sub-agent team, design and provision custom tools on demand, and compile the final results.</p>
            <div className="goal-input-wrapper">
              <textarea
                className="goal-input"
                rows={2}
                placeholder="e.g. Write a script that checks current system CPU load, stores it in cpu_log.txt, and sends a terminal alert if it exceeds 80%..."
                value={goal}
                onChange={e => setGoal(e.target.value)}
              />
              <button className="btn btn-primary btn-launch" onClick={startSwarm} disabled={!goal.trim() || !ws}>
                Launch Swarm Team
              </button>
            </div>
          </div>

          {/* Saved Swarm Teams Library */}
          <div className="card goal-card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="card-header font-bold text-lg">Saved Swarm Teams</div>
            <p className="card-desc">Launch previously saved custom agent teams directly without re-planning.</p>
            <div className="saved-teams-container">
              {savedTeams.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "var(--mute)", fontSize: 13, fontFamily: "var(--font-mono)" }}>
                  No saved teams yet. Run a swarm and save its composition to see it here!
                </div>
              ) : (
                savedTeams.map((team, idx) => (
                  <div key={idx} className="saved-team-card">
                    <div className="saved-team-info">
                      <h4>{team.name}</h4>
                      <div className="saved-team-goal">"{team.goal}"</div>
                      <div className="saved-team-agent-tags">
                        {team.agents.map((agent, aIdx) => (
                          <span key={aIdx} className="saved-team-agent-tag">
                            {agent.id}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="saved-team-actions">
                      <button 
                        className="btn btn-secondary btn-small"
                        onClick={() => deleteSavedTeam(team.name)}
                        style={{ color: "var(--danger)" }}
                      >
                        Delete
                      </button>
                      <button 
                        className="btn btn-primary btn-small"
                        onClick={() => launchSavedTeam(team)}
                        disabled={!ws}
                      >
                        Launch Team
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Swarm Active Overview ── */}
      {swarmStatus !== "idle" && (
        <div className="swarm-workspace">
          {/* Header Panel */}
          <div className="card swarm-header-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span className="text-muted text-xs font-mono">ACTIVE OBJECTIVE</span>
                <h3 className="goal-text">"{activeGoal}"</h3>
              </div>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                {agents.length > 0 && (
                  <button 
                    className="btn btn-secondary text-xs" 
                    onClick={() => setShowSaveModal(true)}
                    style={{ padding: "6px 12px", height: "auto", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    💾 Save Team
                  </button>
                )}
                <div style={{ textAlign: "right" }}>
                  <span className="text-muted text-xs font-mono">ELAPSED TIME</span>
                  <div className="time-text font-mono font-bold">{formatTime(elapsedTime)}</div>
                </div>
                <div className="status-indicator">
                  <div className={`pulse-dot ${swarmStatus}`} />
                  <span className="status-label font-mono">{swarmStatus.toUpperCase()}</span>
                </div>
              </div>
            </div>

            {/* Custom Tool Provisioning Alert Banner */}
            {provisioning && (
              <div className={`provisioning-banner ${provisioning.status}`}>
                <div className="spinner-small" />
                <span>
                  {provisioning.status === "requested" ? (
                    <>⚠️ <strong>CEO Tool Builder:</strong> Sub-agent <code>{provisioning.agentId}</code> requested custom tool <code>{provisioning.toolName}</code>. Writing and installing the tool...</>
                  ) : (
                    <>✅ <strong>CEO Tool Builder:</strong> Custom tool <code>{provisioning.toolName}</code> provisioned successfully! Resuming sub-agent.</>
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="swarm-panels">
            {/* ── Left Side: Agent List/Cards ── */}
            <div className="swarm-left">
              <div className="panel-title">Dynamic Swarm Developer Team</div>
              
              {swarmStatus === "planning" && (
                <div className="planning-loader">
                  <div className="spinner-large" />
                  <p className="font-mono text-sm">CEO is analyzing goal and assembling team...</p>
                </div>
              )}

              {agents.map(a => (
                <div
                  key={a.id}
                  className={`swarm-agent-card ${selectedAgentId === a.id ? "active" : ""}`}
                  onClick={() => setSelectedAgentId(a.id)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <h4 className="agent-id font-mono">{a.id.toUpperCase()}</h4>
                    {getStatusBadge(a.status)}
                  </div>
                  <p className="agent-role">{a.role}</p>
                  
                  {a.currentTask && (
                    <div className="agent-task-block">
                      <span className="text-xs text-muted block">ACTIVE TASK</span>
                      <span className="text-xs font-medium text-white">{a.currentTask}</span>
                    </div>
                  )}

                  {a.currentTool && (
                    <div className="agent-tool-block">
                      <span className="tool-indicator-dot" />
                      <span className="text-xs font-mono text-cyan">Executing: {a.currentTool}</span>
                    </div>
                  )}

                  <div className="agent-mini-footer">
                    <span className="text-xs font-mono text-muted">Tools: {a.tools.join(", ") || "none"}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Right Side: Live Logs & Console of Selected Agent ── */}
            <div className="swarm-right">
              {selectedAgent ? (
                <div className="card log-card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                  <div className="card-header log-header">
                    <div>
                      <h4 className="font-mono font-bold text-white text-md">AGENT MONITOR: {selectedAgent.id.toUpperCase()}</h4>
                      <p className="text-xs text-muted mt-1">{selectedAgent.role}</p>
                    </div>
                    <div>
                      {getStatusBadge(selectedAgent.status)}
                    </div>
                  </div>

                  <div className="log-console font-mono">
                    {selectedAgent.logs.map((log, idx) => (
                      <div key={idx} className="log-line">
                        <span className="log-prompt">&gt;</span>
                        <span className="log-text">{log}</span>
                      </div>
                    ))}
                    {selectedAgent.status === "running" && (
                      <div className="log-line active-line">
                        <span className="log-prompt blinking">&gt;</span>
                        <span className="log-text text-muted">Agent processing in neural network...</span>
                      </div>
                    )}
                    <div ref={logsEndRef} />
                  </div>

                  {selectedAgent.result && (
                    <div className="agent-result-box">
                      <div className="result-title font-mono text-xs">FINAL REPORT FROM AGENT</div>
                      <div className="result-content text-sm">
                        <Markdown content={selectedAgent.result} />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="card empty-log-card">
                  <p className="text-muted font-mono">Select a swarm node to monitor diagnostic logs in real-time.</p>
                </div>
              )}
            </div>
          </div>

          {/* ── CEO Console Output & Report ── */}
          <div className="swarm-bottom">
            <div className="card ceo-console-card">
              <div className="card-header font-bold font-mono text-white text-md">CEO COMMAND CONTROLLER CONSOLE</div>
              <div className="ceo-terminal font-mono text-xs">
                {ceoLogs.map((log, idx) => (
                  <div key={idx} className="ceo-log-line">
                    <span className="ceo-prompt">#</span>
                    <span>{log}</span>
                  </div>
                ))}
                {swarmStatus === "planning" && (
                  <div className="ceo-log-line active-line">
                    <span className="ceo-prompt blinking">#</span>
                    <span className="text-muted">CEO calculating team topologies...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Final Compiled Report */}
            {finalSummary && (
              <div className="card final-summary-card">
                <div className="card-header font-bold text-white text-lg">Final Swarm Summary Report</div>
                <div className="summary-markdown text-sm">
                  <Markdown content={finalSummary} />
                </div>
                <div style={{ marginTop: 16 }}>
                  <button className="btn btn-primary" onClick={() => setSwarmStatus("idle")}>
                    Start New Swarm
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Save Team Modal ── */}
      {showSaveModal && (
        <div className="modal-overlay">
          <div className="card modal-card" style={{ maxWidth: 400, width: "100%", padding: 24 }}>
            <h3 className="text-white font-bold text-lg mb-2">Save Swarm Team</h3>
            <p className="text-muted text-xs mb-4">Give this custom team composition a memorable name to run it instantly in the future.</p>
            <input
              type="text"
              className="goal-input"
              style={{ width: "100%", marginBottom: 16, height: "auto" }}
              placeholder="e.g. Doc QA Coder Team"
              value={teamNameInput}
              onChange={e => setTeamNameInput(e.target.value)}
            />
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => { setShowSaveModal(false); setTeamNameInput(""); }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveCurrentTeam}>
                Save Team
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
