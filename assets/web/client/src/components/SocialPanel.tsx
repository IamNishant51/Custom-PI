import { useState, useEffect } from "react";

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

export default function SocialPanel() {
  const [social, setSocial] = useState<SocialStatus | null>(null);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Twitter form
  const [twUser, setTwUser] = useState("");
  const [twPass, setTwPass] = useState("");
  const [twLoading, setTwLoading] = useState(false);
  const [twMsg, setTwMsg] = useState("");

  // Reddit form
  const [rdUser, setRdUser] = useState("");
  const [rdPass, setRdPass] = useState("");
  const [rdLoading, setRdLoading] = useState(false);
  const [rdMsg, setRdMsg] = useState("");

  // Email form
  const [emEmail, setEmEmail] = useState("");
  const [emPass, setEmPass] = useState("");
  const [emName, setEmName] = useState("");
  const [emLoading, setEmLoading] = useState(false);
  const [emMsg, setEmMsg] = useState("");

  // Post form
  const [postPlatform, setPostPlatform] = useState<"twitter" | "reddit">("twitter");
  const [postText, setPostText] = useState("");
  const [postSub, setPostSub] = useState("");
  const [postTitle, setPostTitle] = useState("");
  const [postLoading, setPostLoading] = useState(false);
  const [postMsg, setPostMsg] = useState("");

  // Email send form
  const [emTo, setEmTo] = useState("");
  const [emSubject, setEmSubject] = useState("");
  const [emBody, setEmBody] = useState("");
  const [emSendLoading, setEmSendLoading] = useState(false);
  const [emSendMsg, setEmSendMsg] = useState("");

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

  useEffect(() => { fetchStatus(); const t = setInterval(fetchStatus, 10000); return () => clearInterval(t); }, []);

  async function loginTwitter() {
    setTwLoading(true); setTwMsg("");
    try {
      const r = await fetch("/api/social/twitter/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: twUser, password: twPass }),
      }).then(r => r.json());
      setTwMsg(r.ok ? "✅ " + r.message : "❌ " + r.error);
      if (r.ok) { setTwUser(""); setTwPass(""); fetchStatus(); }
    } catch { setTwMsg("❌ Connection failed"); }
    setTwLoading(false);
  }

  async function loginReddit() {
    setRdLoading(true); setRdMsg("");
    try {
      const r = await fetch("/api/social/reddit/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: rdUser, password: rdPass }),
      }).then(r => r.json());
      setRdMsg(r.ok ? "✅ " + r.message : "❌ " + r.error);
      if (r.ok) { setRdUser(""); setRdPass(""); fetchStatus(); }
    } catch { setRdMsg("❌ Connection failed"); }
    setRdLoading(false);
  }

  async function configureEmail() {
    setEmLoading(true); setEmMsg("");
    try {
      const r = await fetch("/api/social/email/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emEmail, appPassword: emPass, displayName: emName }),
      }).then(r => r.json());
      setEmMsg(r.ok ? "✅ " + r.message : "❌ " + r.error);
      if (r.ok) { setEmEmail(""); setEmPass(""); setEmName(""); fetchStatus(); }
    } catch { setEmMsg("❌ Connection failed"); }
    setEmLoading(false);
  }

  async function submitPost() {
    setPostLoading(true); setPostMsg("");
    try {
      let r;
      if (postPlatform === "twitter") {
        r = await fetch("/api/social/twitter/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: postText }),
        }).then(r => r.json());
      } else {
        r = await fetch("/api/social/reddit/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subreddit: postSub, title: postTitle, body: postText }),
        }).then(r => r.json());
      }
      setPostMsg(r.ok ? "✅ " + r.message : "❌ " + r.error);
      if (r.ok) { setPostText(""); setPostTitle(""); fetchStatus(); }
    } catch { setPostMsg("❌ Connection failed"); }
    setPostLoading(false);
  }

  async function sendEmail() {
    setEmSendLoading(true); setEmSendMsg("");
    try {
      const r = await fetch("/api/social/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emTo, subject: emSubject, body: emBody }),
      }).then(r => r.json());
      setEmSendMsg(r.ok ? "✅ " + r.message : "❌ " + r.error);
      if (r.ok) { setEmTo(""); setEmSubject(""); setEmBody(""); fetchStatus(); }
    } catch { setEmSendMsg("❌ Connection failed"); }
    setEmSendLoading(false);
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>;

  const twitterOk = social?.platforms?.twitter?.configured;
  const redditOk = social?.platforms?.reddit?.configured;
  const emailOk = email?.configured;

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 20 }}>Social Accounts</h2>

      {/* ── Status Cards ──────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 30 }}>
        <StatusCard
          title="Twitter / X"
          connected={!!twitterOk}
          detail={twitterOk ? `Posts today: ${social?.rateLimits?.twitter?.count || 0}/10` : "Not connected"}
          color="#1DA1F2"
        />
        <StatusCard
          title="Reddit"
          connected={!!redditOk}
          detail={redditOk ? `Posts today: ${social?.rateLimits?.reddit?.count || 0}/10` : "Not connected"}
          color="#FF4500"
        />
        <StatusCard
          title="Email (Gmail)"
          connected={!!emailOk}
          detail={emailOk ? `${email?.email} — ${email?.rateLimit?.sent || 0}/${email?.rateLimit?.limit || 500}` : "Not configured"}
          color="#EA4335"
        />
      </div>

      {/* ── Connect Forms ─────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 30 }}>
        {!twitterOk && (
          <ConnectForm
            title="Connect Twitter"
            userLabel="Username or email"
            username={twUser} setUsername={setTwUser}
            password={twPass} setPassword={setTwPass}
            loading={twLoading} message={twMsg}
            onSubmit={loginTwitter}
          />
        )}
        {!redditOk && (
          <ConnectForm
            title="Connect Reddit"
            userLabel="Reddit username"
            username={rdUser} setUsername={setRdUser}
            password={rdPass} setPassword={setRdPass}
            loading={rdLoading} message={rdMsg}
            onSubmit={loginReddit}
          />
        )}
        {!emailOk && (
          <ConnectForm
            title="Connect Email"
            userLabel="Gmail address"
            username={emEmail} setUsername={setEmEmail}
            password={emPass} setPassword={setEmPass}
            loading={emLoading} message={emMsg}
            onSubmit={configureEmail}
            extraField={{ label: "Display name", value: emName, onChange: setEmName }}
          />
        )}
      </div>

      {/* ── Post Form ─────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Quick Post</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            className={`btn ${postPlatform === "twitter" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setPostPlatform("twitter")}
            disabled={!twitterOk}
          >Twitter</button>
          <button
            className={`btn ${postPlatform === "reddit" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setPostPlatform("reddit")}
            disabled={!redditOk}
          >Reddit</button>
        </div>

        {postPlatform === "reddit" && (
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              className="input"
              placeholder="Subreddit (e.g. programming)"
              value={postSub}
              onChange={e => setPostSub(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              className="input"
              placeholder="Post title"
              value={postTitle}
              onChange={e => setPostTitle(e.target.value)}
              style={{ flex: 2 }}
            />
          </div>
        )}

        <textarea
          className="input"
          placeholder={postPlatform === "twitter" ? "What's happening? (max 280 chars)" : "Post body (optional for link posts)"}
          value={postText}
          onChange={e => setPostText(e.target.value)}
          rows={3}
          style={{ resize: "vertical", marginBottom: 8 }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            className="btn btn-primary"
            onClick={submitPost}
            disabled={postLoading || (!twitterOk && !redditOk) || !postText}
          >
            {postLoading ? "Posting..." : `Post to ${postPlatform === "twitter" ? "Twitter" : "Reddit"}`}
          </button>
          {postMsg && <span style={{ fontSize: 13 }}>{postMsg}</span>}
        </div>
      </div>

      {/* ── Email Send Form ───────────────────────────────────────────── */}
      {emailOk && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <h3 style={{ marginBottom: 12 }}>Send Email</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input className="input" placeholder="To (email)" value={emTo} onChange={e => setEmTo(e.target.value)} style={{ flex: 1 }} />
            <input className="input" placeholder="Subject" value={emSubject} onChange={e => setEmSubject(e.target.value)} style={{ flex: 2 }} />
          </div>
          <textarea
            className="input"
            placeholder="Email body"
            value={emBody}
            onChange={e => setEmBody(e.target.value)}
            rows={4}
            style={{ resize: "vertical", marginBottom: 8 }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn btn-primary" onClick={sendEmail} disabled={emSendLoading || !emTo || !emSubject || !emBody}>
              {emSendLoading ? "Sending..." : "Send Email"}
            </button>
            {emSendMsg && <span style={{ fontSize: 13 }}>{emSendMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCard({ title, connected, detail, color }: { title: string; connected: boolean; detail: string; color: string }) {
  return (
    <div className="card" style={{ padding: 16, borderLeft: `4px solid ${connected ? color : "#666"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: connected ? color : "#666" }} />
        <strong>{title}</strong>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{detail}</div>
    </div>
  );
}

function ConnectForm({
  title, userLabel, username, setUsername, password, setPassword,
  loading, message, onSubmit, extraField,
}: {
  title: string; userLabel: string; username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void; loading: boolean; message: string;
  onSubmit: () => void; extraField?: { label: string; value: string; onChange: (v: string) => void };
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <h4 style={{ marginBottom: 8 }}>{title}</h4>
      <input className="input" placeholder={userLabel} value={username} onChange={e => setUsername(e.target.value)} style={{ width: "100%", marginBottom: 6 }} />
      <input className="input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ width: "100%", marginBottom: 6 }} />
      {extraField && (
        <input className="input" placeholder={extraField.label} value={extraField.value} onChange={e => extraField.onChange(e.target.value)} style={{ width: "100%", marginBottom: 6 }} />
      )}
      <button className="btn btn-primary" onClick={onSubmit} disabled={loading || !username || !password} style={{ width: "100%" }}>
        {loading ? "Connecting..." : "Connect"}
      </button>
      {message && <div style={{ fontSize: 12, marginTop: 6 }}>{message}</div>}
    </div>
  );
}
