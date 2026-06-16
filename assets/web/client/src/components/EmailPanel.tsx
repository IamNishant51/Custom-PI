import { useState, useEffect } from "react";
import { PanelLoadingSpinner, PanelErrorCard } from "./LoadingSkeleton";

interface EmailAccount { id: string; email: string; host: string; }
interface EmailMessage { id: string; from: string; subject: string; date: string; body?: string; }

export default function EmailPanel() {
  const [view, setView] = useState<"inbox" | "compose" | "accounts">("inbox");
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [summary, setSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [accountForm, setAccountForm] = useState({ email: "", password: "", host: "", port: "993" });
  const [compose, setCompose] = useState({ to: "", subject: "", body: "" });
  const [sending, setSending] = useState(false);
  const [draftReply, setDraftReply] = useState("");
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [emailTags, setEmailTags] = useState<string[]>([]);
  const [tagging, setTagging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmailMessage[]>([]);
  const [searching, setSearching] = useState(false);

  const loadAccounts = async () => {
    try { const r = await fetch("/api/email/accounts"); const d = await r.json(); setAccounts(d.accounts || []); } catch {}
  };
  const loadEmails = async () => {
    setLoading(true); setLoadError(null);
    try {
      const r = await fetch("/api/email/fetch");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json(); setEmails(d.emails || []);
    } catch (e: any) { setLoadError(e.message || "Failed to load emails"); }
    setLoading(false);
  };
  useEffect(() => { loadAccounts(); loadEmails(); }, []);

  const addAccount = async () => {
    await fetch("/api/email/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(accountForm) });
    setAccountForm({ email: "", password: "", host: "", port: "993" });
    loadAccounts();
  };

  const deleteAccount = async (id: string) => {
    await fetch(`/api/email/accounts/${id}`, { method: "DELETE" });
    loadAccounts();
  };

  const sendEmail = async () => {
    if (!compose.to.trim() || !compose.subject.trim()) return;
    setSending(true);
    await fetch("/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(compose) });
    setCompose({ to: "", subject: "", body: "" });
    setSending(false);
    setView("inbox");
  };

  const aiSummarize = async () => {
    if (!selected) return;
    setSummarizing(true);
    try {
      const r = await fetch("/api/email/ai-summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `${selected.from}\nSubject: ${selected.subject}\n${selected.body || ""}` }) });
      const d = await r.json();
      setSummary(d.summary || "No summary available.");
    } catch { setSummary("Failed to summarize."); }
    setSummarizing(false);
  };

  const generateDraftReply = async (tone?: string) => {
    if (!selected) return;
    setGeneratingDraft(true);
    try {
      const r = await fetch("/api/email/draft-reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emailText: `${selected.from}\nSubject: ${selected.subject}\n${selected.body || ""}`, tone: tone || "friendly" }) });
      const d = await r.json();
      setDraftReply(d.draft || "");
    } catch { setDraftReply("Failed to generate draft."); }
    setGeneratingDraft(false);
  };

  const autoTag = async () => {
    if (!selected) return;
    setTagging(true);
    try {
      const r = await fetch("/api/email/auto-tag", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `${selected.subject} ${selected.body || ""}` }) });
      const d = await r.json();
      setEmailTags(d.tags || []);
    } catch {}
    setTagging(false);
  };

  const searchEmails = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const r = await fetch("/api/email/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchQuery }) });
      const d = await r.json();
      setSearchResults(d.results || []);
    } catch {}
    setSearching(false);
  };

  const tabs = [
    { key: "inbox" as const, label: "Inbox" },
    { key: "compose" as const, label: "Compose" },
    { key: "accounts" as const, label: "Accounts" },
  ];

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabs.map(t => (
          <button key={t.key} className={`btn ${view === t.key ? "btn-primary" : ""}`} onClick={() => { setView(t.key); setSelected(null); setSummary(""); }}>{t.label}</button>
        ))}
      </div>

      {view === "accounts" && (
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, padding: 12, border: "1px solid var(--hairline)", borderRadius: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Add IMAP Account</h3>
            <input className="input" placeholder="Email" value={accountForm.email} onChange={e => setAccountForm({ ...accountForm, email: e.target.value })} />
            <input className="input" type="password" placeholder="Password" value={accountForm.password} onChange={e => setAccountForm({ ...accountForm, password: e.target.value })} />
            <input className="input" placeholder="IMAP Host" value={accountForm.host} onChange={e => setAccountForm({ ...accountForm, host: e.target.value })} />
            <input className="input" placeholder="Port (993)" value={accountForm.port} onChange={e => setAccountForm({ ...accountForm, port: e.target.value })} />
            <button className="btn btn-primary" onClick={addAccount}>Add Account</button>
          </div>
          {accounts.map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", border: "1px solid var(--hairline)", borderRadius: 6, marginBottom: 4 }}>
              <div><div style={{ fontWeight: 600 }}>{a.email}</div><div style={{ fontSize: 12, color: "var(--mute)" }}>{a.host}</div></div>
              <button className="btn" onClick={() => deleteAccount(a.id)} style={{ color: "var(--danger)" }}>Delete</button>
            </div>
          ))}
        </div>
      )}

      {view === "compose" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="input" placeholder="To" value={compose.to} onChange={e => setCompose({ ...compose, to: e.target.value })} />
          <input className="input" placeholder="Subject" value={compose.subject} onChange={e => setCompose({ ...compose, subject: e.target.value })} />
          <textarea className="input" placeholder="Body" value={compose.body} onChange={e => setCompose({ ...compose, body: e.target.value })} rows={10} />
          <button className="btn btn-primary" onClick={sendEmail} disabled={sending}>{sending ? "Sending..." : "Send"}</button>
        </div>
      )}

      {view === "inbox" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input className="input" placeholder="Search emails..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && searchEmails()}
              style={{ flex: 1, padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--text)" }} />
            <button className="btn" onClick={searchEmails} disabled={searching} style={{ fontSize: 11, padding: "4px 10px" }}>{searching ? "..." : "Search"}</button>
          </div>
          {searchResults.length > 0 && (
            <div style={{ marginBottom: 12, padding: 8, border: "1px solid var(--accent)", borderRadius: 6, background: "var(--surface)" }}>
              <div style={{ fontSize: 11, color: "var(--mute)", marginBottom: 4 }}>Search results ({searchResults.length})</div>
              {searchResults.map(e => (
                <div key={e.id} onClick={() => { setSelected(e); setSearchResults([]); }} style={{ cursor: "pointer", padding: "4px 8px", borderRadius: 4, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{e.from}</span> — {e.subject}
                </div>
              ))}
            </div>
          )}
          {selected ? (
            <div>
              <button className="btn" onClick={() => { setSelected(null); setSummary(""); }} style={{ marginBottom: 12 }}>&larr; Back</button>
              <div style={{ marginBottom: 8 }}><strong>From:</strong> {selected.from}</div>
              <div style={{ marginBottom: 8 }}><strong>Subject:</strong> {selected.subject}</div>
              <div style={{ marginBottom: 8 }}><strong>Date:</strong> {selected.date}</div>
              <div style={{ padding: 12, border: "1px solid var(--hairline)", borderRadius: 6, marginBottom: 12, whiteSpace: "pre-wrap", fontSize: 13 }}>{selected.body || "No content"}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <button className="btn" onClick={aiSummarize} disabled={summarizing} style={{ fontSize: 11, padding: "4px 10px" }}>{summarizing ? "..." : "AI Summary"}</button>
                <button className="btn" onClick={() => generateDraftReply("friendly")} disabled={generatingDraft} style={{ fontSize: 11, padding: "4px 10px" }}>{generatingDraft ? "..." : "Draft Reply"}</button>
                <button className="btn" onClick={() => generateDraftReply("formal")} style={{ fontSize: 11, padding: "4px 10px" }}>Formal Draft</button>
                <button className="btn" onClick={() => generateDraftReply("brief")} style={{ fontSize: 11, padding: "4px 10px" }}>Brief Draft</button>
                <button className="btn" onClick={autoTag} disabled={tagging} style={{ fontSize: 11, padding: "4px 10px" }}>{tagging ? "..." : "Auto-Tag"}</button>
              </div>
              {emailTags.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                  {emailTags.map(t => <span key={t} style={{ padding: "2px 8px", borderRadius: 12, background: "var(--accent)", color: "#fff", fontSize: 10 }}>{t}</span>)}
                </div>
              )}
              {summary && <div style={{ marginTop: 8, padding: 12, background: "var(--surface)", borderRadius: 6, fontSize: 13, color: "var(--accent)" }}>{summary}</div>}
              {draftReply && (
                <div style={{ marginTop: 8, padding: 12, border: "1px solid var(--hairline)", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--mute)", marginBottom: 4 }}>Draft Reply:</div>
                  <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{draftReply}</div>
                  <button className="btn" onClick={() => { navigator.clipboard.writeText(draftReply); }} style={{ marginTop: 8, fontSize: 11, padding: "4px 10px" }}>Copy to Compose</button>
                </div>
              )}
            </div>
          ) : loading ? (
            <PanelLoadingSpinner message="Loading emails..." />
          ) : loadError ? (
            <PanelErrorCard message={loadError} onRetry={loadEmails} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {emails.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--mute)" }}>No emails found.</div>
              ) : (
                emails.map(e => (
                  <div key={e.id} onClick={() => setSelected(e)} style={{ cursor: "pointer", padding: "8px 12px", border: "1px solid var(--hairline)", borderRadius: 6, transition: "background 0.1s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{e.from}</div>
                    <div style={{ fontSize: 12, color: "var(--text)" }}>{e.subject}</div>
                    <div style={{ fontSize: 11, color: "var(--mute)" }}>{e.date}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
