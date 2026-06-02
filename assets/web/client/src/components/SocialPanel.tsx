import { useState, useEffect } from "react";

interface SocialStatus {
  ok: boolean;
  platforms?: {
    twitter: { configured: boolean; sessionActive: boolean };
    reddit: { configured: boolean; sessionActive: boolean };
    linkedin?: { configured: boolean; sessionActive: boolean };
    bluesky?: { configured: boolean };
    discord?: { configured: boolean };
    telegram?: { configured: boolean };
  };
  error?: string;
}

interface EmailStatus {
  ok: boolean;
  configured: boolean;
  email: string | null;
  displayName: string | null;
  error?: string;
}

export default function SocialPanel() {
  const [social, setSocial] = useState<SocialStatus | null>(null);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeConnect, setActiveConnect] = useState<"twitter" | "reddit" | "email" | "linkedin" | "bluesky" | "discord" | "telegram" | null>(null);

  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");
  const [formName, setFormName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formMsg, setFormMsg] = useState("");

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

  useEffect(() => { fetchStatus(); }, []);

  async function connectPlatform() {
    setFormLoading(true);
    setFormMsg("");
    try {
      let r: any;
      if (activeConnect === "twitter") {
        r = await fetch("/api/social/twitter/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: formUser, password: formPass }) }).then(r => r.json());
      } else if (activeConnect === "reddit") {
        r = await fetch("/api/social/reddit/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: formUser, password: formPass }) }).then(r => r.json());
      } else if (activeConnect === "linkedin") {
        r = await fetch("/api/social/linkedin/setup", { method: "POST" }).then(r => r.json());
      } else if (activeConnect === "bluesky") {
        r = await fetch("/api/social/bluesky/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: formUser, appPassword: formPass }) }).then(r => r.json());
      } else if (activeConnect === "discord") {
        r = await fetch("/api/social/discord/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ webhookUrl: formUser }) }).then(r => r.json());
      } else if (activeConnect === "telegram") {
        r = await fetch("/api/social/telegram/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: formUser, chatId: formPass }) }).then(r => r.json());
      } else {
        r = await fetch("/api/social/email/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: formUser, appPassword: formPass, displayName: formName }) }).then(r => r.json());
      }
      setFormMsg(r.ok ? "Connected" : `Error: ${r.error || r.message}`);
      if (r.ok) {
        setTimeout(() => { setActiveConnect(null); setFormUser(""); setFormPass(""); setFormName(""); setFormMsg(""); }, 1500);
        fetchStatus();
      }
    } catch { setFormMsg("Connection failed"); }
    setFormLoading(false);
  }

  async function disconnectPlatform(platform: string) {
    try { await fetch(`/api/social/${platform}/disconnect`, { method: "POST" }); fetchStatus(); } catch {}
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><div className="loading-spinner" style={{ margin: "0 auto" }} /></div>;

  const twitterOk = social?.platforms?.twitter?.configured;
  const redditOk = social?.platforms?.reddit?.configured;
  const linkedinOk = social?.platforms?.linkedin?.configured;
  const emailOk = email?.configured;
  const bskyOk = social?.platforms?.bluesky?.configured;
  const discordOk = social?.platforms?.discord?.configured;
  const telegramOk = social?.platforms?.telegram?.configured;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--hairline)", fontSize: 12, color: "var(--muted)" }}>
        Connect your accounts below. Then use the main chat to post — just tell the AI what to write and where.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--hairline)", flexShrink: 0 }}>
        <AccountCard name="Twitter / X" connected={!!twitterOk} detail={twitterOk ? "Connected" : null} color="#1DA1F2"
          onConnect={() => { setActiveConnect("twitter"); setFormUser(""); setFormPass(""); setFormMsg(""); }}
          onDisconnect={() => disconnectPlatform("twitter")} />
        <AccountCard name="LinkedIn" connected={!!linkedinOk} detail={linkedinOk ? "Connected" : null} color="#0A66C2"
          onConnect={() => { setActiveConnect("linkedin"); setFormUser(""); setFormPass(""); setFormMsg(""); }}
          onDisconnect={() => disconnectPlatform("linkedin")} />
        <AccountCard name="Reddit" connected={!!redditOk} detail={redditOk ? "Connected" : null} color="#FF4500"
          onConnect={() => { setActiveConnect("reddit"); setFormUser(""); setFormPass(""); setFormMsg(""); }}
          onDisconnect={() => disconnectPlatform("reddit")} />
        <AccountCard name="Bluesky" connected={!!bskyOk} detail={bskyOk ? "Connected" : null} color="#0285FF"
          onConnect={() => { setActiveConnect("bluesky"); setFormUser(""); setFormPass(""); setFormMsg(""); }}
          onDisconnect={() => disconnectPlatform("bluesky")} />
        <AccountCard name="Discord" connected={!!discordOk} detail={discordOk ? "Connected" : null} color="#5865F2"
          onConnect={() => { setActiveConnect("discord"); setFormUser(""); setFormPass(""); setFormMsg(""); }}
          onDisconnect={() => disconnectPlatform("discord")} />
        <AccountCard name="Telegram" connected={!!telegramOk} detail={telegramOk ? "Connected" : null} color="#24A1DE"
          onConnect={() => { setActiveConnect("telegram"); setFormUser(""); setFormPass(""); setFormMsg(""); }}
          onDisconnect={() => disconnectPlatform("telegram")} />
        <AccountCard name="Email" connected={!!emailOk} detail={emailOk ? `${email?.email || "Configured"}` : null} color="#EA4335"
          onConnect={() => { setActiveConnect("email"); setFormUser(""); setFormPass(""); setFormName(""); setFormMsg(""); }}
          onDisconnect={() => disconnectPlatform("email")} />
      </div>

      {activeConnect && (
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--hairline)", background: "var(--surface)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>
              {activeConnect === "email" ? "Email (Gmail App Password)" : activeConnect.charAt(0).toUpperCase() + activeConnect.slice(1)}
            </strong>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setActiveConnect(null)}>X</button>
          </div>
          {activeConnect === "linkedin" ? (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 13 }}>Opens browser for manual login.</span>
              <button className="btn btn-primary" onClick={connectPlatform} disabled={formLoading}
                style={{ height: 32, fontSize: 13, padding: "0 16px" }}>
                {formLoading ? "Starting..." : "Open LinkedIn Login"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input className="input" placeholder={
                activeConnect === "email" ? "Gmail address" :
                activeConnect === "discord" ? "Webhook URL" :
                activeConnect === "telegram" ? "Bot Token" :
                activeConnect === "twitter" ? "Username or email" :
                activeConnect === "reddit" ? "Reddit username" :
                activeConnect === "bluesky" ? "Bluesky handle" : "Username"
              } value={formUser} onChange={e => setFormUser(e.target.value)} style={{ flex: 2, height: 32, fontSize: 13 }} />
              {activeConnect !== "discord" && (
                <input className="input" type={activeConnect === "telegram" ? "text" : "password"} placeholder={
                  activeConnect === "email" ? "App Password" :
                  activeConnect === "telegram" ? "Chat ID" :
                  activeConnect === "bluesky" ? "App Password" : "Password"
                } value={formPass} onChange={e => setFormPass(e.target.value)} style={{ flex: 2, height: 32, fontSize: 13 }} />
              )}
              {activeConnect === "email" && (
                <input className="input" placeholder="Display name (optional)" value={formName}
                  onChange={e => setFormName(e.target.value)} style={{ flex: 1, height: 32, fontSize: 13 }} />
              )}
              <button className="btn btn-primary" onClick={connectPlatform} disabled={formLoading || !formUser || (activeConnect !== "discord" && !formPass)}
                style={{ height: 32, fontSize: 13, padding: "0 16px" }}>
                {formLoading ? "..." : "Connect"}
              </button>
            </div>
          )}
          {formMsg && <div style={{ fontSize: 12, marginTop: 6 }}>{formMsg}</div>}
        </div>
      )}
    </div>
  );
}

function AccountCard({ name, connected, detail, color, onConnect, onDisconnect }: {
  name: string; connected: boolean; detail: string | null; color: string;
  onConnect: () => void; onDisconnect: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 14px", borderRadius: 8,
      border: "1px solid var(--hairline)", background: "var(--surface)",
      fontSize: 13, minWidth: 150,
    }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? "#22c55e" : "#666", flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
        {detail && <div style={{ fontSize: 11, color: "var(--muted)" }}>{detail}</div>}
      </div>
      <button
        className={connected ? "btn btn-ghost" : "btn btn-primary"}
        onClick={connected ? onDisconnect : onConnect}
        style={{ height: 28, fontSize: 11, padding: "0 10px", whiteSpace: "nowrap" }}
      >
        {connected ? "Disconnect" : "Connect"}
      </button>
    </div>
  );
}
