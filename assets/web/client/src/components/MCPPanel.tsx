import { useState, useEffect, useCallback } from "react";
import { useToast } from "./Toast";
import { AsciiPlus, AsciiCheck, AsciiX, AsciiPlay, AsciiTrash } from "./Icons";

interface McpServer {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  description?: string;
}

export default function MCPPanel() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<McpServer>({ name: "", command: "", args: [], enabled: true, description: "" });
  const [testOutput, setTestOutput] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/mcp/config")
      .then(r => r.json())
      .then(d => setServers(d.servers || []))
      .catch(() => toast("Failed to load MCP config", "error"));
  }, []);

  const save = useCallback(async () => {
    await fetch("/api/mcp/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servers }),
    });
    setDirty(false);
    toast("MCP configuration saved", "success");
  }, [servers, toast]);

  const testServer = useCallback(async (s: McpServer) => {
    setTestOutput(`Testing ${s.command}...`);
    try {
      const res = await fetch("/api/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: s.name, command: s.command, args: s.args }),
      });
      const d = await res.json();
      setTestOutput(d.ok ? d.output : `Failed: ${d.output}`);
    } catch {
      setTestOutput("Connection failed");
    }
  }, []);

  const addServer = () => {
    if (!form.name || !form.command) return;
    setServers(prev => [...prev, { ...form, args: form.args.filter(Boolean) }]);
    setForm({ name: "", command: "", args: [], enabled: true, description: "" });
    setAdding(false);
    setDirty(true);
  };

  const removeServer = (name: string) => {
    setServers(prev => prev.filter(s => s.name !== name));
    setDirty(true);
  };

  const toggleServer = (name: string) => {
    setServers(prev => prev.map(s => s.name === name ? { ...s, enabled: !s.enabled } : s));
    setDirty(true);
  };

  return (
    <div>
      <div className="mcp-status-grid">
        <div className="stat-card">
          <div className="stat-label">Configured Servers</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{servers.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Enabled</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{servers.filter(s => s.enabled).length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Disabled</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{servers.filter(s => !s.enabled).length}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={adding} style={{ display: "flex", alignItems: "center", gap: 6 }}><AsciiPlus size={16} /> Add Server</button>
        {dirty && <button className="btn btn-primary" onClick={save}>Save Changes</button>}
      </div>

      {adding && (
        <div className="card">
          <div className="card-header">New MCP Server</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 500 }}>
            <input type="text" placeholder="Name (e.g., filesystem)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input type="text" placeholder="Command (e.g., npx)" value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} />
            <input type="text" placeholder="Args (comma-separated, e.g., -y, @modelcontextprotocol/server-filesystem, /path)" value={form.args.join(", ")} onChange={e => setForm(f => ({ ...f, args: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))} />
            <input type="text" placeholder="Description (optional)" value={form.description || ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={addServer} disabled={!form.name || !form.command}>Add</button>
              <button className="btn btn-ghost" onClick={() => { setAdding(false); setForm({ name: "", command: "", args: [], enabled: true, description: "" }); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">MCP Servers</div>
        {servers.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}>
            <div className="empty-state-desc">No MCP servers configured. Add one to extend agent capabilities.</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Enabled</th><th>Name</th><th>Command</th><th>Args</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {servers.map((s, i) => (
                <tr key={s.name} className="stagger-item">
                  <td>
                    <button
                      className={`btn btn-ghost`}
                      onClick={() => toggleServer(s.name)}
                      style={{ padding: "4px 8px", background: s.enabled ? "var(--success)" : "transparent", color: s.enabled ? "#fff" : "var(--ash)" }}
                    >
                      {s.enabled ? <AsciiCheck size={14} /> : <AsciiX size={14} />}
                    </button>
                  </td>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{s.command}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.args.join(" ")}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-ghost" onClick={() => testServer(s)} style={{ display: "flex", alignItems: "center", gap: 4 }}><AsciiPlay size={12} /> test</button>
                      <button className="btn btn-ghost" onClick={() => removeServer(s.name)} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--danger)" }}><AsciiTrash size={12} /> remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {testOutput && (
        <div className="card">
          <div className="card-header">Test Output</div>
          <div style={{ fontFamily: "inherit", fontSize: 12, color: testOutput.startsWith("Testing") ? "var(--mute)" : testOutput.startsWith("Failed") || testOutput === "Connection failed" ? "var(--danger)" : "var(--success)", whiteSpace: "pre-wrap" }}>
            {testOutput}
          </div>
        </div>
      )}
    </div>
  );
}
