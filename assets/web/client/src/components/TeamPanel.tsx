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

export default function TeamPanel() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [addAgentTeam, setAddAgentTeam] = useState<string | null>(null);
  const [addAgentId, setAddAgentId] = useState("");
  const [form, setForm] = useState({ name: "", workspace: "", leaderAgentId: "" });
  const { toast } = useToast();

  const loadTeams = useCallback(() => {
    setLoading(true);
    fetch("/api/teams")
      .then(r => r.json())
      .then(d => setTeams(d.teams || []))
      .catch(() => toast("Failed to load teams", "error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadTeams(); }, []);

  const createTeam = useCallback(async () => {
    if (!form.name || !form.leaderAgentId) {
      toast("Name and leader agent required", "error");
      return;
    }
    try {
      const r = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          workspace: form.workspace || "default",
          leaderAgentId: form.leaderAgentId,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast("Team created", "success");
      setShowCreate(false);
      setForm({ name: "", workspace: "", leaderAgentId: "" });
      loadTeams();
    } catch (e: any) {
      toast(e.message || "Failed to create team", "error");
    }
  }, [form, loadTeams]);

  const deleteTeam = useCallback(async (teamId: string) => {
    try {
      const r = await fetch("/api/teams/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast("Team deleted", "success");
      loadTeams();
    } catch (e: any) {
      toast(e.message || "Failed to delete team", "error");
    }
  }, [loadTeams]);

  const addAgent = useCallback(async (teamId: string) => {
    if (!addAgentId) { toast("Agent ID required", "error"); return; }
    try {
      const r = await fetch("/api/teams/add-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, agentId: addAgentId }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast("Agent added to team", "success");
      setAddAgentTeam(null);
      setAddAgentId("");
      loadTeams();
    } catch (e: any) {
      toast(e.message || "Failed to add agent", "error");
    }
  }, [addAgentId, loadTeams]);

  const removeAgent = useCallback(async (teamId: string, slotId: string) => {
    try {
      const r = await fetch("/api/teams/remove-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, slotId }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast("Agent removed from team", "success");
      loadTeams();
    } catch (e: any) {
      toast(e.message || "Failed to remove agent", "error");
    }
  }, [loadTeams]);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Teams</h2>
        <button className="btn btn-sm" onClick={() => setShowCreate(o => !o)}>
          {showCreate ? "Cancel" : "New Team"}
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><span>Create Team</span></div>
          <div className="card-body">
            <div className="form-group">
              <label>Team Name</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Team" />
            </div>
            <div className="form-group">
              <label>Workspace</label>
              <input className="input" value={form.workspace} onChange={e => setForm(f => ({ ...f, workspace: e.target.value }))} placeholder="default" />
            </div>
            <div className="form-group">
              <label>Leader Agent ID</label>
              <input className="input" value={form.leaderAgentId} onChange={e => setForm(f => ({ ...f, leaderAgentId: e.target.value }))} placeholder="agent_id" />
            </div>
            <button className="btn btn-primary btn-sm" onClick={createTeam}>Create</button>
          </div>
        </div>
      )}

      {loading && <div style={{ padding: 20, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>}

      {!loading && teams.length === 0 && (
        <div className="empty-state">
          <p>No teams yet</p>
          <button className="btn btn-sm" onClick={() => setShowCreate(true)}>Create your first team</button>
        </div>
      )}

      {!loading && teams.map(team => (
        <div key={team.id} className="card" style={{ marginBottom: 12 }}>
          <div className="card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{team.name}</span>
              <span className="badge">{team.slots.length} member{team.slots.length !== 1 ? "s" : ""}</span>
              {team.leaderAgentId && <span className="badge badge-leader">leader: {team.leaderAgentId}</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-xs" onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}>
                {expandedTeam === team.id ? "Collapse" : "Members"}
              </button>
              <button className="btn btn-xs btn-danger" onClick={() => deleteTeam(team.id)}>Delete</button>
            </div>
          </div>
          <div className="card-body">
            <div className="field-row"><label>Workspace</label><code>{team.workspace}</code></div>
            <div className="field-row"><label>Created</label><span>{new Date(team.createdAt).toLocaleString()}</span></div>

            {expandedTeam === team.id && (
              <>
                <div className="section-label" style={{ marginTop: 12 }}>Members</div>
                {team.slots.map(slot => (
                  <div key={slot.id} className="list-item">
                    <div className="list-item-primary">
                      <span className="status-dot" style={{ background: slot.status === "active" ? "var(--success)" : "var(--mute)" }} />
                      <span>{slot.agentId}</span>
                      <span className="badge">{slot.role}</span>
                    </div>
                    <div className="list-item-secondary">
                      <span style={{ fontSize: 11, color: "var(--mute)" }}>{slot.status}</span>
                      {slot.role !== "leader" && (
                        <button className="btn btn-xs btn-danger" style={{ marginLeft: 8 }} onClick={() => removeAgent(team.id, slot.id)}>Remove</button>
                      )}
                    </div>
                  </div>
                ))}

                {addAgentTeam === team.id ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input
                      className="input"
                      placeholder="Agent ID"
                      value={addAgentId}
                      onChange={e => setAddAgentId(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addAgent(team.id)}
                    />
                    <button className="btn btn-sm" onClick={() => addAgent(team.id)}>Add</button>
                    <button className="btn btn-sm" onClick={() => { setAddAgentTeam(null); setAddAgentId(""); }}>Cancel</button>
                  </div>
                ) : (
                  <button className="btn btn-xs" style={{ marginTop: 8 }} onClick={() => setAddAgentTeam(team.id)}>+ Add Agent</button>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
