import { useState, useEffect } from "react";
import { useToast } from "./Toast";
import { AsciiEye, AsciiTrash, AsciiRefresh } from "./Icons";

export default function VaultPanel() {
  const [keys, setKeys] = useState<string[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const refreshKeys = () => {
    fetch("/api/vault/list")
      .then(r => r.json())
      .then(d => setKeys(d.keys || []))
      .catch(() => toast("Failed to load secrets", "error"));
  };

  useEffect(() => { refreshKeys(); }, []);

  const addSecret = async () => {
    if (!newKey || !newValue) return;
    setLoading(true);
    try {
      const res = await fetch("/api/vault/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newKey, value: newValue }),
      });
      const d = await res.json();
      if (d.ok) {
        toast("Secret stored", "success");
        setNewKey(""); setNewValue("");
        refreshKeys();
      }
    } catch { toast("Failed to store secret", "error"); }
    setLoading(false);
  };

  const revealSecret = async (key: string) => {
    if (revealed[key]) { setRevealed(prev => { const r = { ...prev }; delete r[key]; return r; }); return; }
    try {
      const res = await fetch("/api/vault/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const d = await res.json();
      if (d.ok) setRevealed(prev => ({ ...prev, [key]: d.value }));
    } catch { toast("Failed to reveal secret", "error"); }
  };

  const deleteSecret = async (key: string) => {
    try {
      const res = await fetch("/api/vault/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const d = await res.json();
      if (d.ok) { toast("Secret deleted", "info"); refreshKeys(); }
    } catch { toast("Failed to delete", "error"); }
  };

  return (
    <div>
      <div className="vault-grid">
        <div className="card">
          <div className="card-header">Add Secret</div>
          <div className="vault-add-form">
            <input type="text" placeholder="Key (e.g., MY_API_KEY)" value={newKey} onChange={e => setNewKey(e.target.value)} />
            <input type="password" placeholder="Value" value={newValue} onChange={e => setNewValue(e.target.value)} />
            <button className="btn btn-primary" onClick={addSecret} disabled={loading}>
              {loading ? "Storing..." : "Store Secret"}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Vault Health</div>
          <div style={{ fontSize: 13 }}>
            <div style={{ marginBottom: 8 }}>Keys stored: <strong>{keys.length}</strong></div>
            <button className="btn btn-ghost" onClick={refreshKeys} style={{ display: "flex", alignItems: "center", gap: 4 }}><AsciiRefresh size={14} /> refresh</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Stored Secrets</div>
        {keys.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}>
            <div className="empty-state-desc">No secrets stored. Use the form above to add one.</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Key</th><th>Value</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {keys.map(key => (
                <tr key={key}>
                  <td style={{ fontWeight: 600 }}>{key}</td>
                  <td>
                    {revealed[key] ? (
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--ink)" }}>{revealed[key]}</span>
                    ) : (
                      <span style={{ color: "var(--muted-soft)" }}>********</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-ghost" onClick={() => revealSecret(key)} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <AsciiEye size={14} />
                        {revealed[key] ? "hide" : "show"}
                      </button>
                      <button className="btn btn-ghost" onClick={() => deleteSecret(key)} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--danger)" }}>
                        <AsciiTrash size={14} />
                        del
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
