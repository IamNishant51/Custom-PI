import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "./Toast";
import Markdown from "./Markdown";
import { useChat } from "../context/ChatContext";

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
  type: "swarm_start" | "ceo_thought" | "ceo_plan" | "agent_status" | "agent_log" | "agent_done" | "tool_request" | "tool_provisioned" | "ceo_summary" | "swarm_error" | "interrupted";
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

interface SavedTeam {
  name: string;
  goal: string;
  agents: Array<{ id: string; role: string; tools: string[]; task: string }>;
  createdAt: string;
}

function AgentStatusBadge({ status }: { status: Agent["status"] }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    running: { bg: "rgba(168,85,247,0.15)", color: "#a855f7", label: "Working" },
    calling_tool: { bg: "rgba(6,182,212,0.15)", color: "#22d3ee", label: "Tool" },
    paused: { bg: "rgba(251,191,36,0.15)", color: "#fbbf24", label: "Paused" },
    done: { bg: "rgba(16,185,129,0.15)", color: "#34d399", label: "Done" },
    error: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "Error" },
    idle: { bg: "rgba(255,255,255,0.04)", color: "var(--mute)", label: "Idle" },
  };
  const s = styles[status] || styles.idle;
  return (
    <span className="agent-status-badge" style={{ background: s.bg, color: s.color, border: `1px solid ${s.color.replace("0.15","0.25").replace("0.04","0.1")}` }}>
      {status === "running" && <span className="status-pulse" />}
      {s.label}
    </span>
  );
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function SubAgentPanel({ ws }: { ws: WebSocket | null }) {
  const { sendInterrupt } = useChat();
  const [goal, setGoal] = useState("");
  const [activeGoal, setActiveGoal] = useState("");
  const [swarmStatus, setSwarmStatus] = useState<"idle" | "planning" | "running" | "done" | "error">("idle");
  const [ceoLogs, setCeoLogs] = useState<string[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [finalSummary, setFinalSummary] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState<{ agentId: string; toolName: string; status: "requested" | "created" } | null>(null);
  const [savedTeams, setSavedTeams] = useState<SavedTeam[]>([]);
  const [teamNameInput, setTeamNameInput] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isCurrentTeamSaved, setIsCurrentTeamSaved] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ceoEndRef = useRef<HTMLDivElement | null>(null);
  const agentLogEndRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  useEffect(() => { ceoEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [ceoLogs]);

  useEffect(() => {
    if (swarmStatus !== "idle" && swarmStatus !== "done" && swarmStatus !== "error") {
      setElapsedTime(0);
      timerRef.current = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [swarmStatus]);

  useEffect(() => {
    if (!ws) return;
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as SwarmMessage;
        switch (data.type) {
          case "swarm_start":
            setSwarmStatus("planning");
            setActiveGoal(data.goal || "");
            setCeoLogs([data.goal ? `Initialized swarm for: "${data.goal}"` : "Initialized swarm."]);
            setAgents([]);
            setFinalSummary(null);
            setProvisioning(null);
            setSelectedAgentId(null);
            setIsCurrentTeamSaved(false);
            break;
          case "ceo_thought":
            setCeoLogs(prev => [...prev, data.message || ""]);
            break;
          case "ceo_plan":
            setSwarmStatus("running");
            setCeoLogs(prev => [...prev, `Team plan formulated — ${data.agents?.length || 0} sub-agents deployed.`]);
            if (data.agents) {
              const parsedAgents: Agent[] = data.agents.map(a => ({
                id: a.id, role: a.role, tools: a.tools,
                status: "idle", currentTask: a.task,
                logs: [`Assigned role: ${a.role}`],
              }));
              setAgents(parsedAgents);
              if (parsedAgents.length > 0) setSelectedAgentId(parsedAgents[0].id);
            }
            break;
          case "agent_status":
            setAgents(prev => prev.map(a => a.id === data.agentId ? { ...a, status: data.status || a.status, currentTool: data.currentTool ?? a.currentTool, currentTask: data.currentTask ?? a.currentTask } : a));
            break;
          case "agent_log":
            setAgents(prev => prev.map(a => a.id === data.agentId ? { ...a, logs: [...a.logs, data.message || ""] } : a));
            break;
          case "agent_done":
            setAgents(prev => prev.map(a => a.id === data.agentId ? { ...a, status: "done", currentTool: undefined, result: data.result, logs: [...a.logs, `Task complete.`] } : a));
            setCeoLogs(prev => [...prev, `Agent '${data.agentId}' completed.`]);
            break;
          case "tool_request":
            setProvisioning({ agentId: data.agentId || "", toolName: data.toolName || "", status: "requested" });
            setCeoLogs(prev => [...prev, `⚠ Agent '${data.agentId}' requested tool: ${data.toolName} (${data.reason || ""})`]);
            break;
          case "tool_provisioned":
            setProvisioning({ agentId: data.agentId || "", toolName: data.toolName || "", status: "created" });
            setCeoLogs(prev => [...prev, `✓ Custom tool '${data.toolName}' provisioned to '${data.agentId}'.`]);
            setAgents(prev => prev.map(a => a.id === data.agentId ? { ...a, tools: [...a.tools, data.toolName || ""], logs: [...a.logs, `Provisioned: ${data.toolName}`] } : a));
            setTimeout(() => setProvisioning(null), 4000);
            break;
          case "ceo_summary":
            setSwarmStatus("done");
            setFinalSummary(data.summary || "");
            setCeoLogs(prev => [...prev, "Swarm campaign complete."]);
            toast("Swarm goal achieved!", "success");
            break;
          case "swarm_error":
            setSwarmStatus("error");
            setCeoLogs(prev => [...prev, `ERROR: ${data.message}`]);
            toast(`Swarm error: ${data.message}`, "error");
            break;
          case "interrupted":
            setSwarmStatus("error");
            setCeoLogs(prev => [...prev, "Swarm aborted by user."]);
            setAgents(prev => prev.map(a => a.status === "running" || a.status === "calling_tool" ? { ...a, status: "error", logs: [...a.logs, "Aborted."] } : a));
            toast("Swarm aborted", "error");
            break;
        }
      } catch {}
    };
    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws, toast]);

  const fetchSavedTeams = useCallback(async () => {
    try { const r = await fetch("/api/swarm/teams"); if (r.ok) setSavedTeams((await r.json()).teams || []); } catch {}
  }, []);
  useEffect(() => { fetchSavedTeams(); }, [fetchSavedTeams]);

  const launchSavedTeam = useCallback((team: SavedTeam) => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: "swarm_saved_team", goal: team.goal, agents: team.agents }));
    setSwarmStatus("planning"); setActiveGoal(team.goal);
    setCeoLogs([`Launching saved team: "${team.name}". Goal: "${team.goal}"`]);
    setAgents([]); setFinalSummary(null); setProvisioning(null); setSelectedAgentId(null); setIsCurrentTeamSaved(true);
    toast(`Running saved team: ${team.name}`, "success");
  }, [ws, toast]);

  const saveCurrentTeam = async () => {
    if (!teamNameInput.trim()) { toast("Enter a team name.", "error"); return; }
    try {
      const r = await fetch("/api/swarm/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: teamNameInput.trim(), goal: activeGoal, agents: agents.map(a => ({ id: a.id, role: a.role, tools: a.tools, task: a.currentTask || "" })) }) });
      if (r.ok) { toast(`Team saved.`, "success"); setTeamNameInput(""); setShowSaveModal(false); setIsCurrentTeamSaved(true); fetchSavedTeams(); }
      else { const e = await r.json(); toast(`Error: ${e.message}`, "error"); }
    } catch (e: any) { toast(`Failed: ${e.message}`, "error"); }
  };

  const deleteSavedTeam = async (name: string) => {
    try { const r = await fetch("/api/swarm/teams/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); if (r.ok) { toast("Team deleted.", "success"); fetchSavedTeams(); } } catch {}
  };

  const startSwarm = useCallback(() => {
    if (!goal.trim() || !ws || swarmStatus === "running" || swarmStatus === "planning") return;
    ws.send(JSON.stringify({ type: "swarm_goal", goal }));
    setGoal("");
  }, [goal, ws, swarmStatus]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="subagent-panel">

      {/* ── IDLE STATE ── */}
      {swarmStatus === "idle" || swarmStatus === "done" || swarmStatus === "error" ? (
        <div className="subagent-idle">
          <div className="subagent-hero">
            <div className="subagent-hero-icon">⚡</div>
            <h1 className="subagent-hero-title">Swarm Commander</h1>
            <p className="subagent-hero-desc">Enter a goal. The CEO will assemble a team, delegate tasks, and compile results.</p>
            <div className="subagent-hero-input-row">
              <textarea
                className="subagent-hero-input"
                rows={2}
                placeholder="e.g. Write a script that checks system CPU load, logs it, and alerts if > 80%..."
                value={goal}
                onChange={e => setGoal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); startSwarm(); } }}
              />
              <button className="subagent-hero-btn" onClick={startSwarm} disabled={!goal.trim() || !ws}>
                Launch
              </button>
            </div>
          </div>

          {savedTeams.length > 0 && (
            <div className="subagent-saved-section">
              <div className="subagent-section-label">Saved Teams</div>
              <div className="subagent-saved-grid">
                {savedTeams.map((team, i) => (
                  <div key={i} className="saved-team-item" onClick={() => launchSavedTeam(team)}>
                    <div className="saved-team-item-top">
                      <span className="saved-team-item-name">{team.name}</span>
                      <button className="saved-team-item-delete" onClick={e => { e.stopPropagation(); deleteSavedTeam(team.name); }} title="Delete">✕</button>
                    </div>
                    <div className="saved-team-item-goal">{team.goal}</div>
                    <div className="saved-team-item-agents">
                      {team.agents.map((a, j) => (
                        <span key={j} className="saved-team-item-tag">{a.id}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ── ACTIVE STATE ── */}
      {swarmStatus !== "idle" ? (
        <div className="subagent-active">

          {/* Status Bar */}
          <div className="subagent-bar">
            <div className="subagent-bar-left">
              <span className="subagent-bar-status">
                <span className={`subagent-bar-dot ${swarmStatus}`} />
                {swarmStatus.toUpperCase()}
              </span>
              {swarmStatus !== "planning" && agents.length > 0 && (
                <span className="subagent-bar-agents">{agents.filter(a => a.status === "done").length}/{agents.length} done</span>
              )}
            </div>
            <div className="subagent-bar-center">
              <span className="subagent-bar-goal">{activeGoal}</span>
            </div>
            <div className="subagent-bar-right">
              <span className="subagent-bar-time">{formatTime(elapsedTime)}</span>
              {swarmStatus === "running" || swarmStatus === "planning" ? (
                <button className="subagent-bar-abort" onClick={() => { if (confirm("Abort this swarm?")) sendInterrupt(); }}>
                  ■ Abort
                </button>
              ) : (swarmStatus === "done" || swarmStatus === "error") ? (
                <button className="subagent-bar-reset" onClick={() => setSwarmStatus("idle")}>
                  ✕ Reset
                </button>
              ) : null}
              {!isCurrentTeamSaved && agents.length > 0 && (
                <button className="subagent-bar-save" onClick={() => setShowSaveModal(true)}>Save</button>
              )}
              {isCurrentTeamSaved && <span className="subagent-bar-saved">Saved</span>}
            </div>
          </div>

          {/* Provisioning Banner */}
          {provisioning && (
            <div className={`subagent-provisioning ${provisioning.status}`}>
              <div className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
              <span>
                {provisioning.status === "requested"
                  ? `CEO building tool '${provisioning.toolName}' for ${provisioning.agentId}...`
                  : `Tool '${provisioning.toolName}' provisioned to ${provisioning.agentId}.`}
              </span>
            </div>
          )}

          {/* Main Grid */}
          <div className="subagent-grid">
            {/* Left: Agent Cards */}
            <div className="subagent-agents-col">
              {swarmStatus === "planning" && (
                <div className="subagent-planning">
                  <div className="loading-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                  <span>CEO is assembling the team...</span>
                </div>
              )}
              <div className="subagent-agents-list">
                {agents.map(a => (
                  <div
                    key={a.id}
                    className={`subagent-agent-card ${selectedAgentId === a.id ? "selected" : ""} ${a.status}`}
                    onClick={() => setSelectedAgentId(a.id)}
                  >
                    <div className="subagent-agent-card-header">
                      <div className="subagent-agent-card-name-row">
                        <div className="subagent-agent-avatar">{a.id.slice(0, 2).toUpperCase()}</div>
                        <div>
                          <div className="subagent-agent-card-name">{a.id}</div>
                          <div className="subagent-agent-card-role">{a.role}</div>
                        </div>
                      </div>
                      <AgentStatusBadge status={a.status} />
                    </div>
                    {a.currentTask && <div className="subagent-agent-card-task">{a.currentTask}</div>}
                    {a.currentTool && <div className="subagent-agent-card-tool">tool: {a.currentTool}</div>}
                    <div className="subagent-agent-card-tools">
                      {a.tools.slice(0, 4).map((t, j) => <span key={j} className="subagent-tool-tag">{t}</span>)}
                      {a.tools.length > 4 && <span className="subagent-tool-tag">+{a.tools.length - 4}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Agent Logs */}
            <div className="subagent-logs-col">
              {selectedAgent ? (
                <div className="subagent-log-panel">
                  <div className="subagent-log-header">
                    <div className="subagent-log-header-left">
                      <div className="subagent-agent-avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{selectedAgent.id.slice(0, 2).toUpperCase()}</div>
                      <span className="subagent-log-header-name">{selectedAgent.id}</span>
                      <AgentStatusBadge status={selectedAgent.status} />
                    </div>
                    {selectedAgent.result && (
                      <button className="subagent-copy-btn" onClick={() => { navigator.clipboard.writeText(selectedAgent.result || ""); toast("Copied!", "success"); }}>Copy</button>
                    )}
                  </div>
                  <div className="subagent-log-body">
                    {selectedAgent.logs.map((log, i) => (
                      <div key={i} className="subagent-log-line"><span className="subagent-log-prompt">$</span><span>{log}</span></div>
                    ))}
                    {(selectedAgent.status === "running" || selectedAgent.status === "calling_tool") && (
                      <div className="subagent-log-line subagent-log-active"><span className="subagent-log-prompt">$</span><span className="subagent-log-cursor">processing...</span></div>
                    )}
                    <div ref={agentLogEndRef} />
                  </div>
                  {selectedAgent.result && (
                    <div className="subagent-log-result">
                      <div className="subagent-log-result-title">Result</div>
                      <Markdown content={selectedAgent.result} />
                    </div>
                  )}
                </div>
              ) : (
                <div className="subagent-log-empty">
                  <div className="subagent-log-empty-icon">[ ]</div>
                  <div className="subagent-log-empty-text">Select an agent to view logs</div>
                </div>
              )}
            </div>
          </div>

          {/* CEO Console */}
          <div className="subagent-ceo-console">
            <div className="subagent-ceo-console-header">
              <span>CEO Console</span>
              <span className="subagent-ceo-console-count">{ceoLogs.length} lines</span>
            </div>
            <div className="subagent-ceo-console-body">
              {ceoLogs.map((log, i) => (
                <div key={i} className="subagent-ceo-line"><span className="subagent-ceo-prompt">#</span><span>{log}</span></div>
              ))}
              {swarmStatus === "planning" && (
                <div className="subagent-ceo-line"><span className="subagent-ceo-prompt subagent-blink">#</span><span className="subagent-ceo-dim">Analyzing goal...</span></div>
              )}
              <div ref={ceoEndRef} />
            </div>
          </div>

          {/* Final Summary */}
          {finalSummary && (
            <div className="subagent-summary">
              <div className="subagent-summary-header">
                <span>Final Summary</span>
                <button className="subagent-copy-btn" onClick={() => { navigator.clipboard.writeText(finalSummary || ""); toast("Copied!", "success"); }}>Copy</button>
              </div>
              <div className="subagent-summary-body">
                <Markdown content={finalSummary} />
              </div>
              <button className="subagent-summary-new" onClick={() => setSwarmStatus("idle")}>New Swarm</button>
            </div>
          )}
        </div>
      ) : null}

      {/* ── SAVE MODAL ── */}
      {showSaveModal && (
        <div className="subagent-modal-overlay" onClick={() => { setShowSaveModal(false); setTeamNameInput(""); }}>
          <div className="subagent-modal" onClick={e => e.stopPropagation()}>
            <div className="subagent-modal-header">
              <span>Save Team</span>
              <button className="btn btn-small btn-ghost" onClick={() => { setShowSaveModal(false); setTeamNameInput(""); }}>✕</button>
            </div>
            <div className="subagent-modal-body">
              <input className="subagent-modal-input" type="text" placeholder="Team name..." value={teamNameInput} onChange={e => setTeamNameInput(e.target.value)} autoFocus />
            </div>
            <div className="subagent-modal-footer">
              <button className="btn btn-small btn-ghost" onClick={() => { setShowSaveModal(false); setTeamNameInput(""); }}>Cancel</button>
              <button className="btn btn-small btn-primary" onClick={saveCurrentTeam}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
