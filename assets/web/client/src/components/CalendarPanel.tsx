import { useState, useEffect } from "react";

export default function CalendarPanel() {
  const [events, setEvents] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", start: "", end: "", description: "", location: "" });
  const [caldavUrl, setCaldavUrl] = useState("");
  const [caldavUser, setCaldavUser] = useState("");
  const [caldavPass, setCaldavPass] = useState("");

  const load = async () => {
    try { const r = await fetch("/api/calendar/events"); const d = await r.json(); setEvents(d.events || []); } catch {}
  };
  useEffect(() => { load(); }, []);

  const addEvent = async () => {
    if (!form.title || !form.start) return;
    await fetch("/api/calendar/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, start: new Date(form.start).getTime(), end: form.end ? new Date(form.end).getTime() : undefined }) });
    setForm({ title: "", start: "", end: "", description: "", location: "" }); setShowForm(false); load();
  };

  const delEvent = async (id: string) => { await fetch(`/api/calendar/events/${id}`, { method: "DELETE" }); load(); };

  const syncCaldav = async () => {
    await fetch("/api/calendar/caldav/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverUrl: caldavUrl, username: caldavUser, password: caldavPass }) });
    load();
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleString();

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Calendar</h2>
        <button className="btn" onClick={() => setShowForm(!showForm)}>{showForm ? "Cancel" : "+ Add Event"}</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", padding: "8px 12px", border: "1px solid var(--hairline)", borderRadius: 6, fontSize: 12 }}>
        <input className="input" placeholder="CalDAV Server URL" value={caldavUrl} onChange={e => setCaldavUrl(e.target.value)} style={{ flex: 2, padding: "4px 8px", fontSize: 12 }} />
        <input className="input" placeholder="Username" value={caldavUser} onChange={e => setCaldavUser(e.target.value)} style={{ flex: 1, padding: "4px 8px", fontSize: 12 }} />
        <input className="input" type="password" placeholder="Password" value={caldavPass} onChange={e => setCaldavPass(e.target.value)} style={{ flex: 1, padding: "4px 8px", fontSize: 12 }} />
        <button className="btn" onClick={syncCaldav} style={{ fontSize: 11, padding: "4px 10px" }}>Sync CalDAV</button>
      </div>
      {showForm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, padding: 12, border: "1px solid var(--hairline)", borderRadius: 8 }}>
          <input className="input" placeholder="Event title *" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <input className="input" type="datetime-local" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
          <input className="input" type="datetime-local" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} />
          <input className="input" placeholder="Location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
          <textarea className="input" placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} />
          <button className="btn" onClick={addEvent}>Create Event</button>
        </div>
      )}
      {events.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--mute)" }}>No upcoming events.</div>
      ) : (
        events.map(e => (
          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", border: "1px solid var(--hairline)", borderRadius: 6, marginBottom: 4 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{e.title}</div>
              <div style={{ fontSize: 11, color: "var(--mute)" }}>{formatDate(e.start)}{e.end ? ` → ${formatDate(e.end)}` : ""}{e.location ? ` @ ${e.location}` : ""}</div>
              {e.description && <div style={{ fontSize: 12, marginTop: 4 }}>{e.description}</div>}
            </div>
            <button className="btn" onClick={() => delEvent(e.id)} style={{ fontSize: 11, padding: "2px 8px" }}>Del</button>
          </div>
        ))
      )}
    </div>
  );
}
