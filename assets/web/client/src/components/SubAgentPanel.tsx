import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "./Toast";
import { useChat } from "../context/ChatContext";
import Markdown from "./Markdown";
import PostEditorCanvas from "./PostEditorCanvas";
import QuestionModal from "./QuestionModal";
import SwarmCommander from "./SwarmCommander";
import TeamRenderer from "./TeamRenderer";
import { AgentCardCompact, AgentLogView } from "./AgentCard";
import { renderCeoLine, formatTime } from "./SwarmLog";
import { type Agent, type SavedTeam, type SwarmMessage } from "./types";

const PLATFORM_META: Record<string, { label: string; tool: string; color: string }> = {
  twitter: { label: "Twitter / X", tool: "post_to_twitter", color: "#1da1f2" },
  reddit: { label: "Reddit", tool: "post_to_reddit", color: "#ff4500" },
  bluesky: { label: "Bluesky", tool: "post_to_bluesky", color: "#0085ff" },
  discord: { label: "Discord", tool: "post_to_discord", color: "#5865f2" },
  telegram: { label: "Telegram", tool: "post_to_telegram", color: "#26a5e4" },
};

export default function SubAgentPanel({ ws }: { ws: WebSocket | null }) {
  const { sendInterrupt, swarmRecovery, clearSwarmRecovery } = useChat();
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
  const [launchTarget, setLaunchTarget] = useState<SavedTeam | null>(null);
  const [topicInput, setTopicInput] = useState("");
  const [platformStatus, setPlatformStatus] = useState<Record<string, boolean>>({});
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [paused, setPaused] = useState(false);
  const [chatMessages, setChatMessages] = useState<Record<string, Array<{ role: "user" | "agent"; content: string }>>>({});

  const [leftColW, setLeftColW] = useState(() => {
    try { return Number(localStorage.getItem("subagent-lcw")) || 40; } catch { return 40; }
  });
  const [ceoH, setCeoH] = useState(() => {
    try { return Number(localStorage.getItem("subagent-ceoh")) || 120; } catch { return 120; }
  });
  const colResize = useRef<{ startX: number; startW: number } | null>(null);
  const ceoResize = useRef<{ startY: number; startH: number } | null>(null);
  const leftColWRef = useRef(leftColW);
  const ceoHRef = useRef(ceoH);
  useEffect(() => { leftColWRef.current = leftColW; }, [leftColW]);
  useEffect(() => { ceoHRef.current = ceoH; }, [ceoH]);
  const gridRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ceoEndRef = useRef<HTMLDivElement | null>(null);
  const agentLogEndRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  useEffect(() => { ceoEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [ceoLogs]);

  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    if (swarmStatus !== "idle" && swarmStatus !== "done" && swarmStatus !== "error") {
      setElapsedTime(0);
      timerRef.current = setInterval(() => {
        if (!pausedRef.current) setElapsedTime(prev => prev + 1);
      }, 1000);
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
            if (data.agentId && (data.status === "running" || data.status === "calling_tool")) {
              setSelectedAgentId(data.agentId);
            }
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
          case "swarm_paused":
            setPaused(true);
            setCeoLogs(prev => [...prev, "Swarm paused."]);
            break;
          case "swarm_resumed":
            setPaused(false);
            setCeoLogs(prev => [...prev, "Swarm resumed."]);
            break;
          case "swarm_recovery": {
            const rc = data;
            setActiveGoal(rc.goal || activeGoal);
            setCeoLogs(rc.ceoLogs || []);
            setPaused(!!rc.paused);
            if (rc.agents && rc.agents.length > 0) {
              setAgents(rc.agents.map(a => ({
                id: a.id, role: a.role, tools: a.tools,
                status: (a.status as Agent["status"]) || "idle",
                currentTask: a.currentTask || rc.goal,
                logs: a.logs || []
              })));
              if (rc.agents.length > 0) setSelectedAgentId(rc.agents[0].id);
            }
            if (rc.summary) { setFinalSummary(rc.summary); setSwarmStatus("done"); }
            else if (rc.status === "completed") { setSwarmStatus("done"); if (!rc.summary) setFinalSummary("Swarm completed."); }
            else if (rc.status === "running" && (!rc.agents || rc.agents.length === 0)) { setSwarmStatus("planning"); }
            else if (rc.status === "running" || rc.status === "planning") { setSwarmStatus("running"); }
            else if (rc.status === "error") { setSwarmStatus("error"); }
            break;
          }
          case "agent_chat": {
            const chatData = data as SwarmMessage & { agentId: string; message?: string; fromAgent?: boolean };
            const { agentId, message, fromAgent } = chatData;
            if (!agentId) break;
            setChatMessages(prev => ({
              ...prev,
              [agentId]: [...(prev[agentId] || []), { role: fromAgent ? "agent" : "user", content: message || "" }]
            }));
            break;
          }
          case "gmail_auth_required": {
            const { verificationUrl, userCode } = data as any;
            toast(`Gmail auth required: Visit ${verificationUrl} and enter code: ${userCode}`, "info");
            break;
          }
        }
      } catch {}
    };
    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws, toast, activeGoal]);

  useEffect(() => {
    if (!swarmRecovery) return;
    const rc = swarmRecovery;
    setActiveGoal(rc.goal || activeGoal);
    setCeoLogs(rc.ceoLogs || []);
    setPaused(!!rc.paused);
    if (rc.agents && rc.agents.length > 0) {
      setAgents(rc.agents.map((a: any) => ({
        id: a.id, role: a.role, tools: a.tools,
        status: (a.status as Agent["status"]) || "idle",
        currentTask: a.currentTask || rc.goal,
        logs: a.logs || []
      })));
      if (rc.agents.length > 0) setSelectedAgentId(rc.agents[0].id);
    }
    if (rc.summary) { setFinalSummary(rc.summary); setSwarmStatus("done"); }
    else if (rc.status === "completed") { setSwarmStatus("done"); if (!rc.summary) setFinalSummary("Swarm completed."); }
    else if (rc.status === "running" && (!rc.agents || rc.agents.length === 0)) { setSwarmStatus("planning"); }
    else if (rc.status === "running" || rc.status === "planning") { setSwarmStatus("running"); }
    else if (rc.status === "error") { setSwarmStatus("error"); }
    clearSwarmRecovery();
  }, [swarmRecovery, clearSwarmRecovery]);

  const fetchSavedTeams = useCallback(async () => {
    try { const r = await fetch("/api/swarm/teams"); if (r.ok) setSavedTeams((await r.json()).teams || []); } catch { toast("Failed to load teams", "error"); }
  }, [toast]);
  useEffect(() => { fetchSavedTeams(); }, [fetchSavedTeams]);

  const doLaunchTeam = useCallback((team: SavedTeam, topic: string) => {
    if (!ws) return;
    const platforms = selectedPlatforms;
    const PLATFORM_LABELS: Record<string, string> = { twitter: "Twitter / X", reddit: "Reddit", bluesky: "Bluesky", discord: "Discord", telegram: "Telegram" };
    const platformList = platforms.map(p => PLATFORM_LABELS[p] || p).join(", ");
    const goal = topic
      ? `${team.goal} — Topic: ${topic} [Platforms: ${platformList}]`
      : `${team.goal} [Platforms: ${platformList}]`;
    const platformToolSuffix = platforms.map(p => PLATFORM_META[p]?.tool).filter(Boolean);
    const agentTasks = team.agents.map(a => {
      let task = a.task;
      if (topic && a.id === "researcher") task = `Research the topic: "${topic}". ${task}`;
      if (a.id === "writer" || a.id === "publisher") {
        task = `Target platforms: ${platformList}. ${task}`;
      }
      let tools = [...a.tools];
      if (a.id === "publisher") {
        tools = [...platformToolSuffix, "request_post_approval"];
      }
      return { ...a, task, tools };
    });
    ws.send(JSON.stringify({ type: "swarm_saved_team", goal, agents: agentTasks }));
    setSwarmStatus("planning"); setActiveGoal(goal);
    setCeoLogs([`Launching saved team: "${team.name}". Goal: "${goal}"`]);
    setAgents([]); setFinalSummary(null); setProvisioning(null); setSelectedAgentId(null); setIsCurrentTeamSaved(true);
    setLaunchTarget(null); setTopicInput(""); setSelectedPlatforms([]);
    toast(`Running saved team: ${team.name}`, "success");
  }, [ws, toast, selectedPlatforms]);

  const launchSavedTeam = useCallback((team: SavedTeam) => {
    setLaunchTarget(team);
    setTopicInput("");
    fetch("/api/social/status").then(r => r.json()).then(d => {
      if (!d.ok) return;
      const connected: Record<string, boolean> = {};
      const p = d.platforms || {};
      const PLATFORM_KEYS = ["twitter", "reddit", "bluesky", "discord", "telegram"];
      for (const key of PLATFORM_KEYS) {
        const info = p[key];
        connected[key] = !!(info?.configured || info?.sessionActive);
      }
      setPlatformStatus(connected);
      setSelectedPlatforms(Object.keys(connected).filter(k => connected[k]));
    }).catch(() => {});
  }, []);

  const saveCurrentTeam = async () => {
    if (!teamNameInput.trim()) { toast("Enter a team name.", "error"); return; }
    try {
      const r = await fetch("/api/swarm/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: teamNameInput.trim(), goal: activeGoal, agents: agents.map(a => ({ id: a.id, role: a.role, tools: a.tools, task: a.currentTask || "" })) }) });
      if (r.ok) { toast(`Team saved.`, "success"); setTeamNameInput(""); setShowSaveModal(false); setIsCurrentTeamSaved(true); fetchSavedTeams(); }
      else { const e = await r.json(); toast(`Error: ${e.message}`, "error"); }
    } catch (e: any) { toast(`Failed: ${e.message}`, "error"); }
  };

  const deleteSavedTeam = async (name: string) => {
    try { const r = await fetch("/api/swarm/teams/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); if (r.ok) { toast("Team deleted.", "success"); fetchSavedTeams(); } } catch { toast("Failed to delete team", "error"); }
  };

  const onColDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    colResize.current = { startX: e.clientX, startW: leftColWRef.current };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!colResize.current) return;
      const totalW = gridRef.current?.offsetWidth || 800;
      const pct = Math.max(20, Math.min(80, ((colResize.current.startW / 100) * totalW + ev.clientX - colResize.current.startX) / totalW * 100));
      setLeftColW(pct);
    };
    const onUp = () => {
      if (colResize.current) {
        localStorage.setItem("subagent-lcw", String(leftColWRef.current));
        colResize.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const onCeoDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    ceoResize.current = { startY: e.clientY, startH: ceoHRef.current };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!ceoResize.current) return;
      const gridBottom = gridRef.current?.getBoundingClientRect().bottom || 0;
      const h = Math.max(60, Math.min(500, ceoResize.current.startH + (gridBottom - ev.clientY)));
      setCeoH(h);
    };
    const onUp = () => {
      if (ceoResize.current) {
        localStorage.setItem("subagent-ceoh", String(ceoHRef.current));
        ceoResize.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const startSwarm = useCallback(() => {
    if (!goal.trim() || !ws || swarmStatus === "running" || swarmStatus === "planning") return;
    ws.send(JSON.stringify({ type: "swarm_goal", goal }));
    setGoal("");
  }, [goal, ws, swarmStatus]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  const sendChat = (agentId: string, message: string) => {
    if (!ws || !message.trim()) return;
    ws.send(JSON.stringify({ type: "agent_chat", agentId, message }));
  };

  return (
    <div className="subagent-panel">
      {(swarmStatus === "idle" || swarmStatus === "done" || swarmStatus === "error") ? (
        <SwarmCommander
          goal={goal}
          onGoalChange={setGoal}
          onLaunch={startSwarm}
          canLaunch={!!goal.trim() && !!ws}
          savedTeams={savedTeams}
          onLaunchTeam={launchSavedTeam}
          onDeleteTeam={deleteSavedTeam}
        />
      ) : null}

      {swarmStatus !== "idle" ? (
        <div className="subagent-active">
          <div className="subagent-bar">
            <div className="subagent-bar-left">
              <span className="subagent-bar-status">
                {(swarmStatus === "planning" || swarmStatus === "running") ? (
                  <span className="spinner-geo" />
                ) : (
                  <span className={`subagent-bar-dot ${swarmStatus}`} />
                )}
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
                <>
                  {paused ? (
                    <button className="subagent-bar-resume" onClick={() => { ws?.send(JSON.stringify({ type: "swarm_resume" })); }}>
                      ▶ Resume
                    </button>
                  ) : (
                    <button className="subagent-bar-pause" onClick={() => { ws?.send(JSON.stringify({ type: "swarm_pause" })); }}>
                      ⏸ Pause
                    </button>
                  )}
                  <button className="subagent-bar-abort" onClick={() => { if (confirm("Abort this swarm?")) sendInterrupt(); }}>
                    ■ Abort
                  </button>
                </>
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

          <div className="subagent-grid" ref={gridRef} style={{ gridTemplateColumns: `${leftColW}fr 4px ${100 - leftColW}fr` }}>
            <div className="subagent-agents-col">
              {swarmStatus === "planning" && (
                <div className="subagent-planning">
                  <div className="loading-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                  <span>CEO is assembling the team...</span>
                </div>
              )}
              <div className="subagent-agents-list">
                {agents.map(a => (
                  <AgentCardCompact
                    key={a.id}
                    agent={a}
                    selected={selectedAgentId === a.id}
                    onClick={() => setSelectedAgentId(a.id)}
                  />
                ))}
              </div>
            </div>

            <div className="subagent-col-handle" onMouseDown={onColDragStart} />

            <div className="subagent-logs-col">
              {selectedAgent ? (
                <AgentLogView
                  agent={selectedAgent}
                  chatMessages={chatMessages}
                  onSendChat={sendChat}
                  onSetChatMessages={fn => setChatMessages(fn)}
                  toast={toast}
                />
              ) : (
                <div className="subagent-log-empty">
                  <div className="subagent-log-empty-icon">[ ]</div>
                  <div className="subagent-log-empty-text">Select an agent to view logs</div>
                </div>
              )}
            </div>
          </div>

          <div className="subagent-ceo-handle" onMouseDown={onCeoDragStart} />

          <div className="subagent-ceo-console" style={{ maxHeight: ceoH, minHeight: ceoH }}>
            <div className="subagent-ceo-console-header">
              <span>CEO Console</span>
              <span className="subagent-ceo-console-count">{ceoLogs.length} lines</span>
            </div>
            <div className="subagent-ceo-console-body">
              {ceoLogs.map((log, i) => renderCeoLine(log, i))}
              {swarmStatus === "planning" && (
                <div className="ceo-thought-omp" style={{ opacity: 0.7 }}>
                  <div className="ceo-thought-header">⟳ Planning</div>
                  <div className="ceo-thought-body" style={{ color: "var(--text-dim)" }}>Analyzing goal...</div>
                </div>
              )}
              <div ref={ceoEndRef} />
            </div>
          </div>

          {finalSummary && (
            <div className="ceo-thought-omp summary" style={{ marginTop: 8 }}>
              <div className="ceo-thought-header">✓ Final Summary</div>
              <div className="ceo-thought-body"><Markdown content={finalSummary} /></div>
              <button className="btn btn-small btn-primary" style={{ marginTop: 8 }} onClick={() => setSwarmStatus("idle")}>New Swarm</button>
            </div>
          )}

          <QuestionModal ws={ws} />
          <PostEditorCanvas ws={ws} />
        </div>
      ) : null}

      <TeamRenderer
        launchTarget={launchTarget}
        topicInput={topicInput}
        onTopicChange={setTopicInput}
        platformStatus={platformStatus}
        selectedPlatforms={selectedPlatforms}
        onTogglePlatform={(key) => setSelectedPlatforms(prev =>
          prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
        )}
        onSelectAllConnected={() => setSelectedPlatforms(Object.keys(platformStatus).filter(k => platformStatus[k]))}
        onClearPlatforms={() => setSelectedPlatforms([])}
        onClose={() => { setLaunchTarget(null); setTopicInput(""); }}
        onLaunch={(topic) => doLaunchTeam(launchTarget!, topic)}
      />

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
