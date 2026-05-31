import { useState, useEffect, useCallback } from "react";
import { useToast } from "./Toast";

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

function TeamCard({
  team,
  onDelete,
  onAddAgent,
  onRemoveAgent,
  knownAgents,
}: {
  team: Team;
  onDelete: (id: string) => void;
  onAddAgent: (teamId: string, agentId: string) => void;
  onRemoveAgent: (teamId: string, slotId: string) => void;
  knownAgents: DiscoveredAgent[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");

  const availableAgents = knownAgents.filter(a => a.available && !team.slots.some(s => s.agentId === a.name));

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-header" style={{ cursor: "pointer" }} onClick={() => setExpanded(o => !o)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 600 }}>{team.name}</span>
          <span className="badge" style={{ background: "var(--accent)", color: "#fff" }}>{team.slots.length} member{team.slots.length !== 1 ? "s" : ""}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-xs" onClick={e => { e.stopPropagation(); setExpanded(o => !o); }}>
            {expanded ? "Collapse" : "Expand"}
          </button>
          <button className="btn btn-xs btn-danger" onClick={e => { e.stopPropagation(); if (confirm(`Delete team "${team.name}"?`)) onDelete(team.id); }}>
            Delete
          </button>
        </div>
      </div>
      <div className="card-body" style={{ padding: "8px 12px" }}>
        <div className="field-row"><label>Workspace</label><code>{team.workspace}</code></div>
        <div className="field-row"><label>Created</label><span style={{ fontSize: 12, color: "var(--mute)" }}>{new Date(team.createdAt).toLocaleDateString()}</span></div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--hairline)", padding: 12 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>Members</div>

          {team.slots.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--mute)", padding: "4px 0 8px" }}>No members yet</div>
          )}

          {team.slots.map(slot => (
            <div key={slot.id} className="member-row">
              <div className="member-info">
                <span className="status-dot" style={{ background: slot.status === "active" ? "var(--success)" : "var(--mute)", width: 8, height: 8 }} />
                <span style={{ fontWeight: slot.role === "leader" ? 600 : 400 }}>{slot.agentId}</span>
                <span className="badge" style={{ fontSize: 10, background: slot.role === "leader" ? "var(--accent)" : "var(--surface2)", color: slot.role === "leader" ? "#fff" : "var(--text)" }}>
                  {slot.role}
                </span>
              </div>
              {slot.role !== "leader" && (
                <button className="btn btn-xs btn-danger" onClick={() => onRemoveAgent(team.id, slot.id)}>Remove</button>
              )}
            </div>
          ))}

          {!showAdd ? (
            <button className="btn btn-xs" style={{ marginTop: 8 }} onClick={() => setShowAdd(true)}>+ Add Agent</button>
          ) : (
            <div className="add-agent-form">
              <select
                className="input"
                value={selectedAgent}
                onChange={e => setSelectedAgent(e.target.value)}
              >
                <option value="">Select agent...</option>
                {availableAgents.map(a => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-sm" disabled={!selectedAgent} onClick={() => { onAddAgent(team.id, selectedAgent); setShowAdd(false); setSelectedAgent(""); }}>
                  Add
                </button>
                <button className="btn btn-sm" onClick={() => { setShowAdd(false); setSelectedAgent(""); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TeamPanel() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [knownAgents, setKnownAgents] = useState<DiscoveredAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", workspace: "default", leaderAgentId: "" });
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamsRes, agentsRes] = await Promise.all([
        fetch("/api/teams"),
        fetch("/api/agents/discover"),
      ]);
      const teamsData = await teamsRes.json();
      const agentsData = await agentsRes.json();
      setTeams(teamsData.teams || []);
      setKnownAgents(agentsData.agents || []);
    } catch {
      toast("Failed to load teams", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, []);

  const createTeam = useCallback(async () => {
    if (!form.name || !form.leaderAgentId) {
      toast("Name and leader agent required", "error");
      return;
    }
    try {
      const r = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      toast("Team created", "success");
      setShowCreate(false);
      setForm({ name: "", workspace: "default", leaderAgentId: "" });
      loadData();
    } catch (e: any) {
      toast(e.message || "Failed to create team", "error");
    }
  }, [form, loadData]);

  const deleteTeam = useCallback(async (teamId: string) => {
    try {
      const r = await fetch("/api/teams/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast("Team deleted", "success");
      loadData();
    } catch (e: any) {
      toast(e.message || "Failed to delete team", "error");
    }
  }, [loadData]);

  const addAgent = useCallback(async (teamId: string, agentId: string) => {
    if (!agentId) return;
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
      toast(e.message || "Failed to add agent", "error");
    }
  }, [loadData]);

  const removeAgent = useCallback(async (teamId: string, slotId: string) => {
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
      toast(e.message || "Failed to remove agent", "error");
    }
  }, [loadData]);

  const availableLeaders = knownAgents.filter(a => a.available);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Teams ({teams.length})</h2>
        <button className="btn btn-sm" onClick={() => setShowCreate(o => !o)}>
          {showCreate ? "Cancel" : "New Team"}
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: 16, border: "1px solid var(--accent)" }}>
          <div className="card-header" style={{ background: "var(--accent)", color: "#fff" }}>Create Team</div>
          <div className="card-body">
            <div className="form-group">
              <label>Team Name *</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Dev Squad" />
            </div>
            <div className="form-group">
              <label>Workspace</label>
              <input className="input" value={form.workspace} onChange={e => setForm(f => ({ ...f, workspace: e.target.value }))} placeholder="default" />
            </div>
            <div className="form-group">
              <label>Leader Agent *</label>
              <select className="input" value={form.leaderAgentId} onChange={e => setForm(f => ({ ...f, leaderAgentId: e.target.value }))}>
                <option value="">Select leader agent...</option>
                {availableLeaders.map(a => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary btn-sm" onClick={createTeam} disabled={!form.name || !form.leaderAgentId}>Create</button>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: 32, textAlign: "center" }}>
          <div className="loading-spinner" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 13, color: "var(--mute)" }}>Loading teams...</div>
        </div>
      )}

      {!loading && teams.length === 0 && (
        <div className="empty-state" style={{ padding: 48, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>[T]</div>
          <p style={{ color: "var(--mute)", marginBottom: 16 }}>No teams yet. Create one to start collaborating.</p>
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>Create Your First Team</button>
        </div>
      )}

      {!loading && teams.map(team => (
        <TeamCard
          key={team.id}
          team={team}
          onDelete={deleteTeam}
          onAddAgent={addAgent}
          onRemoveAgent={removeAgent}
          knownAgents={knownAgents}
        />
      ))}
    </div>
  );
}
