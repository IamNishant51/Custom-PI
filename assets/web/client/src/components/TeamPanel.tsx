import { useState, useEffect, useCallback } from "react";
import { useToast } from "./Toast";
import { useChat } from "../context/ChatContext";
import { PanelLoadingSpinner, PanelErrorCard } from "./LoadingSkeleton";

interface TeamSlot {
  id: string;
  agentId: string;
  role: string;
  status: string;
}

interface Team {
  id: string;
  name: string;
  workspace: string;
  leaderAgentId: string;
  slots: TeamSlot[];
  createdAt: string;
}

interface DiscoveredAgent {
  name: string;
  command: string;
  available: boolean;
}

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function getColor(name: string): string {
  const colors = [
    "#ff7a17", "#7c3aed", "#30d158", "#ff9f0a", "#ff3b30",
    "#22d3ee", "#c084fc", "#34d399", "#fbbf24", "#f87171",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

function AgentAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const color = getColor(name);
  return (
    <div className="agent-avatar" style={{ width: size, height: size, background: color, color: "#fff", fontSize: size * 0.4, fontWeight: 700, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1 }}>
      {getInitials(name)}
    </div>
  );
}

function TeamCard({
  team,
  onDelete,
  onAddAgent,
  onRemoveAgent,
  onRunTeam,
  knownAgents,
}: {
  team: Team;
  onDelete: (id: string) => void;
  onAddAgent: (teamId: string, agentId: string) => void;
  onRemoveAgent: (teamId: string, slotId: string) => void;
  onRunTeam: (team: Team) => void;
  knownAgents: DiscoveredAgent[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const availableAgents = knownAgents.filter(a => a.available && !team.slots.some(s => s.agentId === a.name));
  const leader = team.slots.find(s => s.role === "leader");
  const color = getColor(team.name);

  return (
    <div className="team-card" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="team-card-header" onClick={() => setExpanded(o => !o)}>
        <div className="team-card-header-left">
          <AgentAvatar name={team.name} size={36} />
          <div className="team-card-info">
            <div className="team-card-name">{team.name}</div>
            <div className="team-card-meta">
              {leader && <span>{leader.agentId}</span>}
              <span className="team-card-dot">·</span>
              <span>{team.slots.length} member{team.slots.length !== 1 ? "s" : ""}</span>
              <span className="team-card-dot">·</span>
              <span>{team.workspace}</span>
            </div>
          </div>
        </div>
        <div className="team-card-header-right">
          <button className="btn btn-small" style={{ background: "var(--accent)", color: "#fff", border: "none" }} onClick={e => { e.stopPropagation(); onRunTeam(team); }} title="Run team">
            ▶ Run
          </button>
          <button className="btn btn-small btn-ghost" onClick={e => { e.stopPropagation(); setExpanded(o => !o); }}>
            {expanded ? "▲" : "▼"}
          </button>
          {!confirmDelete ? (
            <button className="btn btn-small btn-ghost" style={{ color: "var(--danger)" }} onClick={e => { e.stopPropagation(); setConfirmDelete(true); }} title="Delete team">
              ✕
            </button>
          ) : (
            <div className="team-card-confirm" onClick={e => e.stopPropagation()}>
              <span style={{ fontSize: 12, color: "var(--mute)", marginRight: 6 }}>Delete?</span>
              <button className="btn btn-small" style={{ background: "var(--danger)", color: "#fff", border: "none" }} onClick={() => { onDelete(team.id); setConfirmDelete(false); }}>Yes</button>
              <button className="btn btn-small btn-ghost" onClick={() => setConfirmDelete(false)}>No</button>
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="team-card-body">
          <div className="team-card-section">
            <div className="team-card-section-title">Members</div>
            {team.slots.length === 0 && <div className="team-card-empty">No members yet</div>}
            <div className="team-card-members">
              {team.slots.map(slot => (
                <div key={slot.id} className="team-member-row">
                  <div className="team-member-info">
                    <AgentAvatar name={slot.agentId} size={24} />
                    <div className="team-member-details">
                      <span className="team-member-name">{slot.agentId}</span>
                      <span className={`team-member-role role-${slot.role}`}>{slot.role}</span>
                    </div>
                    <span className={`team-member-status status-${slot.status}`}>{slot.status}</span>
                  </div>
                  {slot.role !== "leader" && (
                    <button className="btn btn-small btn-ghost" style={{ color: "var(--danger)", opacity: 0.6 }} onClick={() => onRemoveAgent(team.id, slot.id)} title="Remove agent">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="team-card-section">
            {!showAdd ? (
              <button className="btn btn-small" style={{ border: "1px dashed var(--hairline-strong)", width: "100%", justifyContent: "center", borderRadius: 4 }} onClick={() => { setShowAdd(true); setSelectedAgent(""); }}>
                + Add Agent
              </button>
            ) : (
              <div className="team-card-add-agent">
                <select className="select-input" value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}>
                  <option value="">Select an available agent...</option>
                  {availableAgents.map(a => (
                    <option key={a.name} value={a.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <div className="team-card-add-actions">
                  <button className="btn btn-small btn-primary" disabled={!selectedAgent} onClick={() => { onAddAgent(team.id, selectedAgent); setShowAdd(false); setSelectedAgent(""); }}>
                    Add
                  </button>
                  <button className="btn btn-small btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RunTeamModal({ team, onClose, onRun }: { team: Team; onClose: () => void; onRun: (goal: string) => void }) {
  const [goal, setGoal] = useState("");
  return (
    <div className="create-team-overlay" onClick={onClose}>
      <div className="create-team-form" onClick={e => e.stopPropagation()}>
        <div className="create-team-form-header">
          <span>Run Team: {team.name}</span>
          <button className="btn btn-small btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="create-team-form-body">
          <div className="form-field">
            <label className="form-label">Goal</label>
            <textarea
              className="text-input"
              style={{ minHeight: 80, resize: "vertical", fontFamily: "var(--font-sans)" }}
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="What should this team accomplish?"
              autoFocus
            />
          </div>
          <div className="team-card-members" style={{ marginTop: 4 }}>
            <div className="section-label" style={{ marginBottom: 6 }}>Team</div>
            {team.slots.map(slot => (
              <div key={slot.id} className="team-member-row" style={{ padding: "4px 0" }}>
                <div className="team-member-info">
                  <AgentAvatar name={slot.agentId} size={20} />
                  <span className="team-member-name">{slot.agentId}</span>
                  <span className={`team-member-role role-${slot.role}`}>{slot.role}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="create-team-form-footer">
          <button className="btn btn-small btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-small btn-primary" disabled={!goal.trim()} onClick={() => onRun(goal.trim())}>
            Launch Team
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateTeamForm({
  knownAgents,
  onClose,
  onCreated,
  onCreating,
  onCreateError,
}: {
  knownAgents: DiscoveredAgent[];
  onClose: () => void;
  onCreated: () => void;
  onCreating?: (data: { name: string; workspace: string; leaderAgentId: string }) => string | undefined;
  onCreateError?: (tempId: string) => void;
}) {
  const [form, setForm] = useState({ name: "", workspace: "default", leaderAgentId: "" });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const availableLeaders = knownAgents.filter(a => a.available);

  const handleSubmit = useCallback(async () => {
    if (!form.name.trim()) { toast("Team name is required", "error"); return; }
    if (!form.leaderAgentId) { toast("Select a leader agent", "error"); return; }
    setSaving(true);
    const tempId = onCreating?.({ name: form.name.trim(), workspace: form.workspace || "default", leaderAgentId: form.leaderAgentId });
    try {
      const r = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), workspace: form.workspace || "default", leaderAgentId: form.leaderAgentId }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast("Team created", "success");
      onCreated();
      onClose();
    } catch (e: any) {
      if (tempId) onCreateError?.(tempId);
      toast(e.message || "Failed to create team", "error");
    } finally {
      setSaving(false);
    }
  }, [form, onClose, onCreated, onCreating, onCreateError]);

  return (
    <div className="create-team-overlay" onClick={onClose}>
      <div className="create-team-form" onClick={e => e.stopPropagation()}>
        <div className="create-team-form-header">
          <span>New Team</span>
          <button className="btn btn-small btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="create-team-form-body">
          <div className="form-field">
            <label className="form-label">Team Name</label>
            <input className="text-input" type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Dev Squad" autoFocus />
          </div>
          <div className="form-field">
            <label className="form-label">Workspace</label>
            <input className="text-input" type="text" value={form.workspace} onChange={e => setForm(f => ({ ...f, workspace: e.target.value }))} placeholder="default" />
          </div>
          <div className="form-field">
            <label className="form-label">Leader Agent</label>
            <select className="select-input" value={form.leaderAgentId} onChange={e => setForm(f => ({ ...f, leaderAgentId: e.target.value }))}>
              <option value="">Select a leader...</option>
              {availableLeaders.map(a => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="create-team-form-footer">
          <button className="btn btn-small btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-small btn-primary" onClick={handleSubmit} disabled={!form.name.trim() || !form.leaderAgentId || saving}>
            {saving ? "Creating..." : "Create Team"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TeamPanel({ onNavigate }: { onNavigate?: (view: any) => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [knownAgents, setKnownAgents] = useState<DiscoveredAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [runTeam, setRunTeam] = useState<Team | null>(null);
  const { toast } = useToast();
  const { ws } = useChat();

  function normalizeTeam(raw: any): Team {
    return {
      id: raw.id,
      name: raw.name,
      workspace: raw.workspace || "default",
      leaderAgentId: raw.leaderAgentId || "",
      slots: (raw.agents || raw.slots || []).map((s: any) => ({
        id: s.slotId || s.id || "",
        agentId: s.agentId || s.agentName || "",
        role: s.role || "teammate",
        status: s.status || "idle",
      })),
      createdAt: raw.createdAt || new Date().toISOString(),
    };
  }

  const loadData = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [teamsRes, agentsRes] = await Promise.all([
        fetch("/api/teams"),
        fetch("/api/agents/discover"),
      ]);
      if (!teamsRes.ok) throw new Error(`HTTP ${teamsRes.status}`);
      if (!agentsRes.ok) throw new Error(`HTTP ${agentsRes.status}`);
      const teamsData = await teamsRes.json();
      const agentsData = await agentsRes.json();
      setTeams((teamsData.teams || []).map(normalizeTeam));
      setKnownAgents(agentsData.agents || []);
    } catch (e: any) {
      setLoadError(e.message || "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, []);

  const handleCreating = useCallback((data: { name: string; workspace: string; leaderAgentId: string }) => {
    const tempId = `temp-${Date.now()}`;
    const tempTeam: Team = {
      id: tempId,
      name: data.name,
      workspace: data.workspace,
      leaderAgentId: data.leaderAgentId,
      slots: [],
      createdAt: new Date().toISOString(),
    };
    setTeams(prev => [tempTeam, ...prev]);
    return tempId;
  }, []);

  const handleCreateError = useCallback((tempId: string) => {
    setTeams(prev => prev.filter(t => t.id !== tempId));
  }, []);

  const deleteTeam = useCallback(async (teamId: string) => {
    let removedTeam: Team | undefined;
    setTeams(prev => {
      removedTeam = prev.find(t => t.id === teamId);
      return prev.filter(t => t.id !== teamId);
    });
    try {
      const r = await fetch("/api/teams/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast("Team deleted", "success");
    } catch (e: any) {
      if (removedTeam) setTeams(prev => [removedTeam!, ...prev]);
      toast(e.message || "Failed to delete team", "error");
    }
  }, [toast]);

  const addAgent = useCallback(async (teamId: string, agentId: string) => {
    if (!agentId) return;
    const tempSlot: TeamSlot = { id: `temp-${Date.now()}`, agentId, role: "teammate", status: "idle" };
    setTeams(prev => prev.map(t => t.id === teamId ? { ...t, slots: [...t.slots, tempSlot] } : t));
    try {
      const r = await fetch("/api/teams/add-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, agentId }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast("Agent added to team", "success");
      loadData();
    } catch (e: any) {
      setTeams(prev => prev.map(t => t.id === teamId ? { ...t, slots: t.slots.filter(s => s.id !== tempSlot.id) } : t));
      toast(e.message || "Failed to add agent", "error");
    }
  }, [loadData]);

  const removeAgent = useCallback(async (teamId: string, slotId: string) => {
    let removedSlot: TeamSlot | undefined;
    setTeams(prev => {
      const team = prev.find(t => t.id === teamId);
      removedSlot = team?.slots.find(s => s.id === slotId);
      return prev.map(t => t.id === teamId ? { ...t, slots: t.slots.filter(s => s.id !== slotId) } : t);
    });
    try {
      const r = await fetch("/api/teams/remove-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, slotId }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast("Agent removed", "success");
      loadData();
    } catch (e: any) {
      if (removedSlot) setTeams(prev => prev.map(t => t.id === teamId ? { ...t, slots: [...t.slots, removedSlot!] } : t));
      toast(e.message || "Failed to remove agent", "error");
    }
  }, [loadData]);

  const openRunModal = useCallback((team: Team) => { setRunTeam(team); }, []);

  const handleRunTeam = useCallback((goal: string) => {
    if (!runTeam || !ws) { toast("WebSocket not connected", "error"); return; }
    const agents = runTeam.slots.map(s => s.agentId);
    ws.send(JSON.stringify({ type: "swarm_saved_team", goal, agents }));
    setRunTeam(null);
    toast(`Team "${runTeam.name}" launched!`, "success");
    if (onNavigate) onNavigate("agents");
  }, [runTeam, ws, onNavigate]);

  if (loading) return <PanelLoadingSpinner message="Loading teams..." />;
  if (loadError) return <PanelErrorCard message={loadError} onRetry={loadData} />;

  return (
    <div className="team-panel">
      {runTeam && <RunTeamModal team={runTeam} onClose={() => setRunTeam(null)} onRun={handleRunTeam} />}

      <div className="team-panel-topbar">
        <div className="team-panel-topbar-left">
          <h2 className="team-panel-title">Teams</h2>
          <span className="team-panel-count">{teams.length}</span>
        </div>
        <button className="btn btn-small" onClick={() => setShowCreate(true)}>+ New Team</button>
      </div>

      {showCreate && <CreateTeamForm knownAgents={knownAgents} onClose={() => setShowCreate(false)} onCreated={loadData} onCreating={handleCreating} onCreateError={handleCreateError} />}

      {teams.length === 0 && (
        <div className="team-panel-empty">
          <div className="team-panel-empty-icon">👥</div>
          <div className="team-panel-empty-title">No Teams Yet</div>
          <div className="team-panel-empty-desc">Create a team to organize your agents and start collaborating.</div>
          <button className="btn btn-small btn-primary" onClick={() => setShowCreate(true)}>Create Your First Team</button>
        </div>
      )}

      {teams.map(team => (
        <TeamCard key={team.id} team={team} onDelete={deleteTeam} onAddAgent={addAgent} onRemoveAgent={removeAgent} onRunTeam={openRunModal} knownAgents={knownAgents} />
      ))}
    </div>
  );
}
