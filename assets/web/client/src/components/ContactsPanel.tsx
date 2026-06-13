import { useState, useEffect } from "react";

interface Contact {
  id: string; name: string; email: string; phone: string;
  organization: string; notes: string; created_at: number; updated_at: number;
}

export default function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", organization: "", notes: "" });
  const [editId, setEditId] = useState<string | null>(null);

  const load = async () => {
    try { const r = await fetch("/api/contacts"); const d = await r.json(); setContacts(d.contacts || []); } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) return;
    const url = editId ? `/api/contacts/${editId}` : "/api/contacts";
    const method = editId ? "PUT" : "POST";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setForm({ name: "", email: "", phone: "", organization: "", notes: "" });
    setEditId(null); setShowForm(false); load();
  };

  const del = async (id: string) => { await fetch(`/api/contacts/${id}`, { method: "DELETE" }); load(); };
  const edit = (c: Contact) => { setForm({ name: c.name, email: c.email, phone: c.phone, organization: c.organization, notes: c.notes }); setEditId(c.id); setShowForm(true); };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Contacts</h2>
        <button className="btn" onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ name: "", email: "", phone: "", organization: "", notes: "" }); }}>
          {showForm ? "Cancel" : "+ Add Contact"}
        </button>
      </div>
      {showForm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, padding: 12, border: "1px solid var(--hairline)", borderRadius: 8 }}>
          <input className="input" placeholder="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input className="input" placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          <input className="input" placeholder="Organization" value={form.organization} onChange={e => setForm({ ...form, organization: e.target.value })} />
          <textarea className="input" placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
          <button className="btn" onClick={save}>{editId ? "Update" : "Create"}</button>
        </div>
      )}
      {contacts.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--mute)" }}>No contacts yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {contacts.map(c => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", border: "1px solid var(--hairline)", borderRadius: 6 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "var(--mute)" }}>{c.email}{c.phone && ` · ${c.phone}`}{c.organization && ` · ${c.organization}`}</div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="btn" onClick={() => edit(c)}>Edit</button>
                <button className="btn" onClick={() => del(c.id)}>Del</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
