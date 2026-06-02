import { useState, useEffect, useRef } from "react";

interface SocialStatus {
  ok: boolean;
  platforms?: {
    twitter: { configured: boolean; sessionActive: boolean };
    reddit: { configured: boolean; sessionActive: boolean };
  };
  rateLimits?: {
    twitter: { count: number };
    reddit: { count: number };
  };
  error?: string;
}

interface EmailStatus {
  ok: boolean;
  configured: boolean;
  email: string | null;
  displayName: string | null;
  rateLimit?: { sent: number; limit: number };
  error?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: number;
  action?: string;
}

export default function SocialPanel() {
  const [social, setSocial] = useState<SocialStatus | null>(null);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeConnect, setActiveConnect] = useState<"twitter" | "reddit" | "email" | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Connect form state
  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");
  const [formName, setFormName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formMsg, setFormMsg] = useState("");

  let msgId = 0;
  function nextId() { return `sm_${++msgId}_${Date.now()}`; }

  async function fetchStatus() {
    try {
      const [s, e] = await Promise.all([
        fetch("/api/social/status").then(r => r.json()).catch(() => ({ ok: false })),
        fetch("/api/social/email/status").then(r => r.json()).catch(() => ({ ok: false })),
      ]);
      setSocial(s);
      setEmail(e);
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    fetchStatus();
    // Welcome message
    setMessages([{
      id: nextId(),
      role: "assistant",
      text: "Hey! I can post to Twitter, Reddit, or send emails for you. What would you like to do?",
      timestamp: Date.now(),
    }]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendChat() {
    const text = input.trim();
    if (!text || chatLoading) return;
    setInput("");

    const userMsg: ChatMessage = { id: nextId(), role: "user", text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const r = await fetch("/api/social/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      }).then(r => r.json());

      setMessages(prev => [...prev, {
        id: nextId(),
        role: "assistant",
        text: r.message || "Done.",
        timestamp: Date.now(),
        action: r.action,
      }]);

      // Refresh status after any action
      if (r.ok && r.action !== "help") fetchStatus();
    } catch {
      setMessages(prev => [...prev, {
        id: nextId(),
        role: "assistant",
        text: "Something went wrong. Is the social bridge running?",
        timestamp: Date.now(),
      }]);
    }
    setChatLoading(false);
    inputRef.current?.focus();
  }

  async function connectPlatform() {
    if (!activeConnect) return;
    setFormLoading(true);
    setFormMsg("");
    try {
      let r;
      if (activeConnect === "twitter") {
        r = await fetch("/api/social/twitter/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: formUser, password: formPass }),
        }).then(r => r.json());
      } else if (activeConnect === "reddit") {
        r = await fetch("/api/social/reddit/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: formUser, password: formPass }),
        }).then(r => r.json());
      } else {
        r = await fetch("/api/social/email/configure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: formUser, appPassword: formPass, displayName: formName }),
        }).then(r => r.json());
      }
      setFormMsg(r.ok ? "✅ Connected!" : `❌ ${r.error}`);
      if (r.ok) {
        setTimeout(() => { setActiveConnect(null); setFormUser(""); setFormPass(""); setFormName(""); setFormMsg(""); }, 1500);
        fetchStatus();
      }
    } catch { setFormMsg("❌ Bridge not running"); }
    setFormLoading(false);
  }

  async function disconnectPlatform(platform: string) {
    try {
      await fetch(`/api/social/${platform}/disconnect`, { method: "POST" });
      fetchStatus();
    } catch {}
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>;

  const twitterOk = social?.platforms?.twitter?.configured;
  const redditOk = social?.platforms?.reddit?.configured;
  const emailOk = email?.configured;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ── Account Cards ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--hairline)", flexShrink: 0 }}>
        <AccountCard
          name="Twitter / X"
          connected={!!twitterOk}
          detail={twitterOk ? `${social?.rateLimits?.twitter?.count || 0}/10 posts today` : null}
          color="#1DA1F2"
          onConnect={() => { setActiveConnect("twitter"); setFormUser(""); setFormPass(""); setFormMsg(""); }}
          onDisconnect={() => disconnectPlatform("twitter")}
        />
        <AccountCard
          name="Reddit"
          connected={!!redditOk}
          detail={redditOk ? `${social?.rateLimits?.reddit?.count || 0}/10 posts today` : null}
          color="#FF4500"
          onConnect={() => { setActiveConnect("reddit"); setFormUser(""); setFormPass(""); setFormMsg(""); }}
          onDisconnect={() => disconnectPlatform("reddit")}
        />
        <AccountCard
          name="Email (Gmail)"
          connected={!!emailOk}
          detail={emailOk ? `${email?.rateLimit?.sent || 0}/${email?.rateLimit?.limit || 500} sent today` : null}
          color="#EA4335"
          onConnect={() => { setActiveConnect("email"); setFormUser(""); setFormPass(""); setFormName(""); setFormMsg(""); }}
          onDisconnect={() => disconnectPlatform("email")}
        />
      </div>

      {/* ── Connect Modal ─────────────────────────────────────────────── */}
      {activeConnect && (
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--hairline)", background: "var(--surface)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Connect {activeConnect === "email" ? "Email" : activeConnect === "twitter" ? "Twitter" : "Reddit"}</strong>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setActiveConnect(null)}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="input"
              placeholder={activeConnect === "email" ? "Gmail address" : activeConnect === "twitter" ? "Username or email" : "Reddit username"}
              value={formUser}
              onChange={e => setFormUser(e.target.value)}
              style={{ flex: 1, height: 32, fontSize: 13 }}
            />
            <input
              className="input"
              type="password"
              placeholder={activeConnect === "email" ? "App Password (16 chars)" : "Password"}
              value={formPass}
              onChange={e => setFormPass(e.target.value)}
              style={{ flex: 1, height: 32, fontSize: 13 }}
            />
            {activeConnect === "email" && (
              <input
                className="input"
                placeholder="Display name (optional)"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                style={{ flex: 1, height: 32, fontSize: 13 }}
              />
            )}
            <button
              className="btn btn-primary"
              onClick={connectPlatform}
              disabled={formLoading || !formUser || !formPass}
              style={{ height: 32, fontSize: 13, padding: "0 16px" }}
            >
              {formLoading ? "..." : "Connect"}
            </button>
          </div>
          {formMsg && <div style={{ fontSize: 12, marginTop: 6, color: formMsg.startsWith("✅") ? "var(--success)" : "var(--danger)" }}>{formMsg}</div>}
          {activeConnect === "email" && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Enable 2-Step Verification on Gmail → Google Account → Security → App Passwords → Generate
            </div>
          )}
        </div>
      )}

      {/* ── Chat Agent ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {messages.map(msg => (
            <div key={msg.id} style={{ marginBottom: 12, display: "flex", flexDirection: "column" }}>
              <div style={{
                display: "inline-flex",
                alignItems: "flex-start",
                gap: 8,
                maxWidth: "80%",
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              }}>
                {msg.role !== "user" && (
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, flexShrink: 0, marginTop: 2,
                  }}>
                    {msg.action === "status" ? "📊" : msg.action?.includes("twitter") ? "🐦" : msg.action?.includes("reddit") ? "🔴" : msg.action?.includes("email") ? "✉️" : "🤖"}
                  </div>
                )}
                <div style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: msg.role === "user" ? "var(--accent)" : "var(--surface)",
                  color: msg.role === "user" ? "#fff" : "var(--body)",
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {msg.text}
                </div>
              </div>
            </div>
          ))}
          {chatLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, flexShrink: 0,
              }}>🤖</div>
              <div style={{ padding: "10px 14px", borderRadius: 12, background: "var(--surface)", fontSize: 13, display: "flex", gap: 4 }}>
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--hairline)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
              className="input"
              placeholder="Tell me what to do... (e.g. post about my project on twitter)"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              rows={1}
              style={{ flex: 1, resize: "none", fontSize: 13, minHeight: 38, maxHeight: 100 }}
            />
            <button
              className="btn btn-primary"
              onClick={sendChat}
              disabled={chatLoading || !input.trim()}
              style={{ height: 38, padding: "0 16px", flexShrink: 0 }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountCard({ name, connected, detail, color, onConnect, onDisconnect }: {
  name: string; connected: boolean; detail: string | null; color: string;
  onConnect: () => void; onDisconnect: () => void;
}) {
  return (
    <div style={{
      flex: 1, padding: "12px 16px", borderRadius: 8,
      border: `1px solid ${connected ? color + "40" : "var(--hairline)"}`,
      background: connected ? color + "08" : "var(--surface)",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? color : "var(--muted)" }} />
          <strong style={{ fontSize: 13 }}>{name}</strong>
        </div>
        {connected ? (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "var(--danger)" }} onClick={onDisconnect}>
            disconnect
          </button>
        ) : (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={onConnect}>
            connect
          </button>
        )}
      </div>
      {detail && <div style={{ fontSize: 11, color: "var(--muted)" }}>{detail}</div>}
    </div>
  );
}
