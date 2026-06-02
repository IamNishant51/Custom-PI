import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "./Toast";
import Markdown from "./Markdown";
import ToolCallCard from "./ToolCallCard";
import QuestionModal from "./QuestionModal";
import PostApproval from "./PostApproval";
import AssetSelector from "./AssetSelector";
import AssetGallery from "./AssetGallery";
import { useChat } from "../context/ChatContext";

interface Agent {
  id: string;
  role: string;
  tools: string[];
  status: "idle" | "running" | "calling_tool" | "paused" | "done" | "error" | "completed" | "planning";
  currentTool?: string;
  currentTask?: string;
  logs: string[];
  result?: string;
}

interface SwarmMessage {
  type: "swarm_start" | "ceo_thought" | "ceo_plan" | "agent_status" | "agent_log" | "agent_done" | "tool_request" | "tool_provisioned" | "ceo_summary" | "swarm_error" | "interrupted" | "swarm_recovery" | "swarm_paused" | "swarm_resumed" | "agent_chat" | "gmail_auth_required";
  goal?: string;
  message?: string;
  agents?: Array<{ id: string; role: string; tools: string[]; task: string; status?: string; currentTask?: string; logs?: string[] }>;
  agentId?: string;
  status?: Agent["status"];
  currentTool?: string;
  currentTask?: string;
  toolName?: string;
  reason?: string;
  result?: string;
  summary?: string;
  paused?: boolean;
  agentResults?: Record<string, string>;
  ceoLogs?: string[];
  fromAgent?: boolean;
}

interface SavedTeam {
  name: string;
  goal: string;
  agents: Array<{ id: string; role: string; tools: string[]; task: string }>;
  createdAt: string;
  default?: boolean;
}

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

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

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

  const PLATFORM_META: Record<string, { label: string; tool: string; color: string }> = {
    twitter: { label: "Twitter / X", tool: "post_to_twitter", color: "#1da1f2" },
    reddit: { label: "Reddit", tool: "post_to_reddit", color: "#ff4500" },
    bluesky: { label: "Bluesky", tool: "post_to_bluesky", color: "#0085ff" },
    discord: { label: "Discord", tool: "post_to_discord", color: "#5865f2" },
    telegram: { label: "Telegram", tool: "post_to_telegram", color: "#26a5e4" },
  };
  const [elapsedTime, setElapsedTime] = useState(0);
  const [paused, setPaused] = useState(false);
  const [chatMessages, setChatMessages] = useState<Record<string, Array<{ role: "user" | "agent"; content: string }>>>({});

  // Resizable panes
  const [leftColW, setLeftColW] = useState(() => {
    try { return Number(localStorage.getItem("subagent-lcw")) || 40; } catch { return 40; }
  });
  const [ceoH, setCeoH] = useState(() => {
    try { return Number(localStorage.getItem("subagent-ceoh")) || 120; } catch { return 120; }
  });
  const colResize = useRef<{ startX: number; startW: number } | null>(null);
  const ceoResize = useRef<{ startY: number; startH: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

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
                id: a.id,
                role: a.role,
                tools: a.tools,
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
  }, [ws, toast]);

  // Swarm recovery from context (survives page refresh — message arrives before this component mounts)
  useEffect(() => {
    if (!swarmRecovery) return;
    const rc = swarmRecovery;
    setActiveGoal(rc.goal || activeGoal);
    setCeoLogs(rc.ceoLogs || []);
    setPaused(!!rc.paused);
    if (rc.agents && rc.agents.length > 0) {
      setAgents(rc.agents.map((a: any) => ({
        id: a.id,
        role: a.role,
        tools: a.tools,
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
    try { const r = await fetch("/api/swarm/teams"); if (r.ok) setSavedTeams((await r.json()).teams || []); } catch {}
  }, []);
  useEffect(() => { fetchSavedTeams(); }, [fetchSavedTeams]);

  const doLaunchTeam = useCallback((team: SavedTeam, topic: string) => {
    if (!ws) return;
    const platforms = selectedPlatforms;
    const platformList = platforms.map(p => PLATFORM_META[p]?.label || p).join(", ");
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
      for (const key of Object.keys(PLATFORM_META)) {
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
    try { const r = await fetch("/api/swarm/teams/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); if (r.ok) { toast("Team deleted.", "success"); fetchSavedTeams(); } } catch {}
  };

  // Drag-to-resize handlers
  const onColDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    colResize.current = { startX: e.clientX, startW: leftColW };
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
        localStorage.setItem("subagent-lcw", String(leftColW));
        colResize.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [leftColW]);

  const onCeoDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    ceoResize.current = { startY: e.clientY, startH: ceoH };
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
        localStorage.setItem("subagent-ceoh", String(ceoH));
        ceoResize.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [ceoH]);

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

  const renderCeoLine = (log: string, i: number) => {
    const lower = log.toLowerCase();
    if (lower.startsWith("team plan") || lower.includes("assembling") || lower.includes("deployed")) {
      return (
        <div key={i} className="ceo-plan-omp">
          <div className="ceo-plan-header">⚙ Plan</div>
          <div className="ceo-plan-body">{log}</div>
        </div>
      );
    }
    if (lower.includes("complete") || lower.startsWith("swarm") || lower.includes("campaign") || lower.includes("final")) {
      return (
        <div key={i} className="ceo-thought-omp summary">
          <div className="ceo-thought-header">✓ Summary</div>
          <div className="ceo-thought-body">{log}</div>
        </div>
      );
    }
    if (lower.startsWith("initialized") || lower.startsWith("launching")) {
      return (
        <div key={i} className="ceo-thought-omp" style={{ opacity: 0.7 }}>
          <div className="ceo-thought-header">⟳ Init</div>
          <div className="ceo-thought-body">{log}</div>
        </div>
      );
    }
    if (lower.includes("error")) {
      return (
        <div key={i} className="ceo-thought-omp" style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(45,27,27,0.4)" }}>
          <div className="ceo-thought-header" style={{ color: "var(--accent-coral)" }}>⚠ Error</div>
          <div className="ceo-thought-body">{log}</div>
        </div>
      );
    }
    return (
      <div key={i} className="ceo-thought-omp">
        <div className="ceo-thought-header">💭 CEO Thought</div>
        <div className="ceo-thought-body">{log}</div>
      </div>
    );
  };

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
                      <span className="saved-team-item-name">{team.name}{team.default ? <span className="saved-team-item-badge" style={{marginLeft:6,fontSize:10,opacity:0.5}}>built-in</span> : null}</span>
                      {!team.default && <button className="saved-team-item-delete" onClick={e => { e.stopPropagation(); deleteSavedTeam(team.name); }} title="Delete">✕</button>}
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
          <div className="subagent-saved-section">
            <AssetGallery />
          </div>
        </div>
      ) : null}

      {/* ── ACTIVE STATE ── */}
      {swarmStatus !== "idle" ? (
        <div className="subagent-active">

          {/* Status Bar */}
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
          <div className="subagent-grid" ref={gridRef} style={{ gridTemplateColumns: `${leftColW}fr 4px ${100 - leftColW}fr` }}>
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
                    className={`agent-card-omp ${selectedAgentId === a.id ? "selected" : ""} ${a.status}`}
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
                    {a.status === "running" && <span className="omp-badge running">◐ WORKING</span>}
                    {a.status === "done" && <span className="omp-badge done">✓ DONE</span>}
                    {a.status === "error" && <span className="omp-badge error">✗ FAILED</span>}
                    {a.currentTask && <div className="subagent-agent-card-task">{a.currentTask}</div>}
                    {a.currentTool && <div className="subagent-agent-card-tool">tool: {a.currentTool}</div>}
                    <div className="subagent-agent-card-tools">
                      {a.tools.slice(0, 4).map((t, j) => <span key={j} className="subagent-tool-tag">{t}</span>)}
                      {a.tools.length > 4 && <span className="subagent-tool-tag">+{a.tools.length - 4}</span>}
                    </div>
                    {a.status === "running" && (
                      <div className="agent-card-progress-bar">
                        <div className="agent-card-progress-fill" style={{ width: `${Math.min(100, a.logs.filter(l => l.includes("Calling tool")).length * 25)}%` }} />
                      </div>
                    )}
                    {a.status === "running" && <div className="agent-card-connection-line" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Column Drag Handle */}
            <div className="subagent-col-handle" onMouseDown={onColDragStart} />

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
                    {selectedAgent.logs.map((log, i) => {
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
                    {(selectedAgent.status === "running" || selectedAgent.status === "calling_tool") && (
                      <div className="subagent-log-line subagent-log-active"><span className="subagent-log-prompt">$</span><span className="subagent-log-cursor">processing...</span></div>
                    )}
                    <div ref={agentLogEndRef} />
                  </div>

                  {/* Chat messages */}
                  {chatMessages[selectedAgent.id]?.length > 0 && (
                    <div className="subagent-chat-messages">
                      {chatMessages[selectedAgent.id].map((msg, i) => (
                        <div key={i} className={`subagent-chat-msg ${msg.role}`}>
                          <span className="subagent-chat-role">{msg.role === "user" ? "You" : selectedAgent.id}</span>
                          <span className="subagent-chat-text">{msg.content}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Chat input */}
                  <div className="subagent-chat-input-row">
                    <input
                      className="subagent-chat-input"
                      type="text"
                      placeholder="Message agent..."
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          const input = e.currentTarget;
                          sendChat(selectedAgent.id, input.value);
                          setChatMessages(prev => ({
                            ...prev,
                            [selectedAgent.id]: [...(prev[selectedAgent.id] || []), { role: "user" as const, content: input.value }]
                          }));
                          input.value = "";
                        }
                      }}
                    />
                    <button className="subagent-chat-send" onClick={() => {
                      const input = document.querySelector(".subagent-chat-input") as HTMLInputElement;
                      if (input && input.value.trim()) {
                        sendChat(selectedAgent.id, input.value);
                        setChatMessages(prev => ({
                          ...prev,
                          [selectedAgent.id]: [...(prev[selectedAgent.id] || []), { role: "user" as const, content: input.value }]
                        }));
                        input.value = "";
                      }
                    }}>Send</button>
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

          {/* CEO Drag Handle */}
          <div className="subagent-ceo-handle" onMouseDown={onCeoDragStart} />

          {/* CEO Console */}
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

          {/* Final Summary */}
          {finalSummary && (
            <div className="ceo-thought-omp summary" style={{ marginTop: 8 }}>
              <div className="ceo-thought-header">✓ Final Summary</div>
              <div className="ceo-thought-body"><Markdown content={finalSummary} /></div>
              <button className="btn btn-small btn-primary" style={{ marginTop: 8 }} onClick={() => setSwarmStatus("idle")}>New Swarm</button>
            </div>
          )}

          {/* Question Modal */}
          <QuestionModal ws={ws} />
          <PostApproval ws={ws} />
          <AssetSelector ws={ws} />
        </div>
      ) : null}

      {/* ── LAUNCH SETUP MODAL ── */}
      {launchTarget && (
        <div className="subagent-modal-overlay" onClick={() => { setLaunchTarget(null); }}>
          <div className="launch-team-modal" onClick={e => e.stopPropagation()} style={{
            background: "var(--surface-card)",
            border: "1px solid var(--hairline-strong)",
            borderRadius: 12,
            padding: 28,
            maxWidth: 540,
            width: "90%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            animation: "slideUp 0.25s ease-out",
          }}>
            {/* Header */}
            <div className="launch-team-header" style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              marginBottom: 20,
            }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.3px" }}>{launchTarget.name}</div>
                <div style={{ fontSize: 13, color: "var(--mute)", marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>{launchTarget.agents.length} agent{launchTarget.agents.length > 1 ? "s" : ""}</span>
                  <span style={{ opacity: 0.3 }}>/</span>
                  {launchTarget.agents.map((a, i) => (
                    <span key={a.id} style={{
                      background: "var(--surface-soft)", padding: "1px 8px", borderRadius: 4,
                      fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent-teal)",
                    }}>{a.id}</span>
                  ))}
                </div>
              </div>
              <button className="btn btn-small btn-ghost" onClick={() => setLaunchTarget(null)}
                style={{ fontSize: 16, opacity: 0.5, padding: "4px 8px" }}>x</button>
            </div>

            {/* Topic Input */}
            <div style={{ marginBottom: 16 }}>
              <label style={{
                fontSize: 12, color: "var(--mute)", display: "flex", alignItems: "center", gap: 6,
                marginBottom: 8, fontFamily: "var(--font-mono)", textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}>
                Topic
                <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, opacity: 0.6 }}>(optional)</span>
              </label>
              <div style={{ position: "relative" }}>
                <textarea
                  className="text-input"
                  value={topicInput}
                  onChange={e => setTopicInput(e.target.value)}
                  placeholder="e.g. AI in healthcare, Rust vs Go, latest tech trends..."
                  rows={2}
                  style={{
                    width: "100%", background: "var(--surface-soft)", border: "1px solid var(--hairline)",
                    borderRadius: 8, padding: "10px 12px", color: "var(--ink)", fontSize: 13,
                    fontFamily: "var(--font-sans)", resize: "vertical", outline: "none",
                    transition: "border-color 0.15s",
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = "var(--accent-teal)"}
                  onBlur={e => e.currentTarget.style.borderColor = "var(--hairline)"}
                  autoFocus
                />
              </div>
              <button
                onClick={async () => {
                  const btn = document.getElementById("ai-generate-btn") as HTMLButtonElement;
                  if (btn) { btn.disabled = true; btn.textContent = "Generating..."; }
                  try {
                    const r = await fetch("/api/generate/topic", { method: "POST" });
                    const d = await r.json();
                    if (d.ok) setTopicInput(d.topic);
                  } catch {}
                  if (btn) { btn.disabled = false; btn.textContent = "Generate with AI"; }
                }}
                id="ai-generate-btn"
                style={{
                  marginTop: 8, padding: "6px 14px", background: "var(--surface-soft)",
                  border: "1px solid var(--hairline)", borderRadius: 6, color: "var(--accent-teal)",
                  fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer",
                  transition: "all 0.15s",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent-teal)"; e.currentTarget.style.background = "var(--surface-card)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--hairline)"; e.currentTarget.style.background = "var(--surface-soft)"; }}
              >
                <span className="ai-sparkle" style={{ fontSize: 14, lineHeight: 1 }}>+</span>
                Generate with AI
              </button>
            </div>

            {/* Platform Selector */}
            <div style={{ marginBottom: 16 }}>
              <label style={{
                fontSize: 12, color: "var(--mute)", display: "flex", alignItems: "center", gap: 6,
                marginBottom: 8, fontFamily: "var(--font-mono)", textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}>
                Platforms
                <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, opacity: 0.6 }}>
                  ({selectedPlatforms.length} selected)
                </span>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(PLATFORM_META).map(([key, meta]) => {
                  const connected = platformStatus[key];
                  const selected = selectedPlatforms.includes(key);
                  return (
                    <button
                      key={key}
                      disabled={!connected}
                      onClick={() => {
                        setSelectedPlatforms(prev =>
                          prev.includes(key)
                            ? prev.filter(p => p !== key)
                            : [...prev, key]
                        );
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "6px 12px", borderRadius: 6, fontSize: 12,
                        fontFamily: "var(--font-mono)",
                        border: selected
                          ? `1px solid ${meta.color}`
                          : "1px solid var(--hairline)",
                        background: selected
                          ? `${meta.color}15`
                          : "var(--surface-soft)",
                        color: selected ? meta.color : "var(--mute)",
                        cursor: connected ? "pointer" : "not-allowed",
                        opacity: connected ? 1 : 0.35,
                        transition: "all 0.15s",
                        outline: "none",
                      }}
                      onMouseEnter={e => { if (connected) e.currentTarget.style.background = selected ? `${meta.color}25` : "var(--surface-card)"; }}
                      onMouseLeave={e => { if (connected) e.currentTarget.style.background = selected ? `${meta.color}15` : "var(--surface-soft)"; }}
                    >
                      <span style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: selected ? meta.color : "var(--hairline-strong)",
                        flexShrink: 0,
                      }} />
                      {meta.label}
                      {!connected && <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 2 }}>(not connected)</span>}
                    </button>
                  );
                })}
              </div>
              {Object.values(platformStatus).some(Boolean) && (
                <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setSelectedPlatforms(Object.keys(platformStatus).filter(k => platformStatus[k]))}
                    style={{ fontSize: 10, padding: "2px 8px", background: "transparent", border: "none", color: "var(--accent-teal)", cursor: "pointer", fontFamily: "var(--font-mono)", opacity: 0.7 }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "0.7"}
                  >Select all connected</button>
                  <button
                    onClick={() => setSelectedPlatforms([])}
                    style={{ fontSize: 10, padding: "2px 8px", background: "transparent", border: "none", color: "var(--mute)", cursor: "pointer", fontFamily: "var(--font-mono)", opacity: 0.5 }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "0.5"}
                  >Clear</button>
                </div>
              )}
            </div>

            {/* Pipeline */}
            <div className="launch-team-agents" style={{
              background: "var(--surface-soft)", borderRadius: 8, padding: 14, marginBottom: 20,
              border: "1px solid var(--hairline)",
            }}>
              <div style={{
                fontSize: 11, color: "var(--mute)", marginBottom: 10,
                fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.5px",
              }}>Pipeline</div>
              {launchTarget.agents.map((a, i) => (
                <div key={a.id} className="launch-agent-row" style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
                  fontSize: 12, color: "var(--mute)",
                  animation: "slideUp 0.2s ease-out",
                  animationDelay: `${i * 0.05}s`,
                  animationFillMode: "both",
                }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: "50%",
                    background: i === launchTarget.agents.length - 1
                      ? "rgba(90,176,176,0.15)"
                      : "var(--surface-card)",
                    border: i === launchTarget.agents.length - 1
                      ? "1px solid var(--accent-teal)"
                      : "1px solid var(--hairline-strong)",
                    color: i === launchTarget.agents.length - 1 ? "var(--accent-teal)" : "var(--mute)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 600, flexShrink: 0,
                    transition: "all 0.2s",
                  }}>{i + 1}</span>
                  <span style={{ fontWeight: 500, color: "var(--ink)", width: 110, fontFamily: "var(--font-mono)", fontSize: 11 }}>{a.id}</span>
                  <span style={{ flex: 1, color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.3 }}>{a.role}</span>
                  <span style={{
                    fontSize: 10, color: "var(--mute)", background: "var(--surface-card)",
                    padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
                  }}>{a.tools.length} tools</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
              <button className="btn btn-small btn-ghost" onClick={() => setLaunchTarget(null)}
                style={{ fontSize: 12, padding: "8px 16px", borderRadius: 6 }}>Cancel</button>
              <button className="btn btn-small btn-primary" onClick={() => doLaunchTeam(launchTarget, topicInput.trim())}
                style={{
                  background: "var(--accent-teal)", color: "#000", border: "none",
                  padding: "8px 22px", borderRadius: 6, fontWeight: 600, fontSize: 13,
                  cursor: "pointer", transition: "opacity 0.15s",
                  fontFamily: "var(--font-mono)",
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >
                Start Campaign
              </button>
            </div>
          </div>
        </div>
      )}

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
