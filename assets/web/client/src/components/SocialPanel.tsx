import { useState, useEffect, useCallback } from "react";
import { showToast } from "./Toast";

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

interface QueueItem {
  id: string;
  text: string;
  platforms: string[];
  title?: string;
  subreddit?: string;
  scheduled_at: number;
  status: string;
  error?: string;
  created_at: number;
}

const ALL_PLATFORMS = ["twitter", "reddit", "linkedin", "bluesky", "discord", "telegram"] as const;
const PLATFORM_LABELS: Record<string, string> = { twitter: "Twitter", reddit: "Reddit", linkedin: "LinkedIn", bluesky: "Bluesky", discord: "Discord", telegram: "Telegram" };

export default function SocialPanel() {
  const [social, setSocial] = useState<SocialStatus | null>(null);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeConnect, setActiveConnect] = useState<"twitter" | "reddit" | "email" | "linkedin" | "bluesky" | "discord" | "telegram" | null>(null);

  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");
  const [formName, setFormName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formMsg, setFormMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleText, setScheduleText] = useState("");
  const [schedulePlatforms, setSchedulePlatforms] = useState<string[]>(["twitter"]);
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleSubreddit, setScheduleSubreddit] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);

  const [drafts, setDrafts] = useState<QueueItem[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);

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

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const res = await fetch("/api/social/queue");
      const d = await res.json();
      if (d.ok) setQueueItems(d.items || []);
    } catch { showToast("Failed to load queue", "error"); }
    setQueueLoading(false);
  }, []);

  const fetchDrafts = useCallback(async () => {
    setDraftsLoading(true);
    try {
      const res = await fetch("/api/social/drafts");
      const d = await res.json();
      if (d.ok) setDrafts(d.items || []);
    } catch { showToast("Failed to load drafts", "error"); }
    setDraftsLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); fetchQueue(); fetchDrafts(); }, [fetchQueue, fetchDrafts]);

  useEffect(() => {
    if (!scheduleOpen) return;
    const interval = setInterval(() => { fetchQueue(); fetchDrafts(); }, 15_000);
    return () => clearInterval(interval);
  }, [scheduleOpen, fetchQueue, fetchDrafts]);

  async function connectPlatform() {
    setFormLoading(true);
    setFormMsg(null);
    try {
      let r: any;
      if (activeConnect === "twitter") {
        r = await fetch("/api/social/twitter/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: formUser, password: formPass }) }).then(r => r.json());
      } else if (activeConnect === "reddit") {
        r = await fetch("/api/social/reddit/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: formUser, password: formPass }) }).then(r => r.json());
      } else if (activeConnect === "linkedin") {
        r = await fetch("/api/social/linkedin/setup", { method: "POST" }).then(r => r.json());
      } else if (activeConnect === "bluesky") {
        r = await fetch("/api/social/bluesky/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: formUser, password: formPass }) }).then(r => r.json());
      } else if (activeConnect === "discord") {
        r = await fetch("/api/social/discord/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ webhookUrl: formUser }) }).then(r => r.json());
      } else if (activeConnect === "telegram") {
        r = await fetch("/api/social/telegram/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: formUser, chatId: formPass }) }).then(r => r.json());
      } else {
        r = await fetch("/api/social/email/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: formUser, appPassword: formPass, displayName: formName }) }).then(r => r.json());
      }
      if (r.ok) {
        setFormMsg({ text: "Connected", ok: true });
        setTimeout(() => { setActiveConnect(null); setFormUser(""); setFormPass(""); setFormName(""); setFormMsg(null); }, 1200);
        fetchStatus();
      } else {
        setFormMsg({ text: r.error || r.message || "Failed", ok: false });
      }
    } catch { setFormMsg({ text: "Connection failed", ok: false }); }
    setFormLoading(false);
  }

  async function disconnectPlatform(platform: string) {
    try { await fetch(`/api/social/${platform}/disconnect`, { method: "POST" }); fetchStatus(); } catch { showToast("Failed to disconnect", "error"); }
  }

  function toggleSchedulePlatform(platform: string) {
    setSchedulePlatforms(prev =>
      prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]
    );
  }

  async function schedulePost() {
    if (!scheduleText || schedulePlatforms.length === 0 || !scheduleTime) return;
    setScheduleLoading(true);
    setScheduleMsg(null);
    try {
      const res = await fetch("/api/social/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: scheduleText,
          platforms: schedulePlatforms,
          scheduled_at: new Date(scheduleTime).getTime() / 1000,
          title: schedulePlatforms.includes("reddit") ? scheduleTitle || undefined : undefined,
          subreddit: schedulePlatforms.includes("reddit") ? scheduleSubreddit || undefined : undefined,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        setScheduleMsg({ text: "Post scheduled", ok: true });
        setScheduleText("");
        setSchedulePlatforms(["twitter"]);
        setScheduleTime("");
        setScheduleSubreddit("");
        setScheduleTitle("");
        fetchQueue();
        setTimeout(() => setScheduleMsg(null), 2000);
      } else {
        setScheduleMsg({ text: d.error || "Failed to schedule", ok: false });
      }
    } catch { setScheduleMsg({ text: "Failed to schedule", ok: false }); }
    setScheduleLoading(false);
  }

  async function cancelScheduled(id: string) {
    try {
      await fetch(`/api/social/queue/${id}`, { method: "DELETE" });
      fetchQueue();
    } catch { showToast("Failed to cancel scheduled post", "error"); }
  }

  async function approveDraft(id: string) {
    try {
      await fetch(`/api/social/drafts/${id}/approve`, { method: "POST" });
      fetchDrafts();
      fetchQueue();
    } catch { showToast("Failed to approve draft", "error"); }
  }

  async function rejectDraft(id: string) {
    try {
      await fetch(`/api/social/drafts/${id}/reject`, { method: "POST" });
      fetchDrafts();
    } catch { showToast("Failed to reject draft", "error"); }
  }

  if (loading) return <div className="social-empty"><div className="loading-spinner" /></div>;

  const platforms = social?.platforms;
  const twitterOk = platforms?.twitter?.configured;
  const redditOk = platforms?.reddit?.configured;
  const linkedinOk = platforms?.linkedin?.configured;
  const emailOk = email?.configured;
  const bskyOk = platforms?.bluesky?.configured;
  const discordOk = platforms?.discord?.configured;
  const telegramOk = platforms?.telegram?.configured;

  const now = new Date();
  const defaultScheduleTime = new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16);

  return (
    <div className="social-panel">
      <div className="social-info">
        Connect your accounts below. Then use the main chat to post — just tell the AI what to write and where.
      </div>

      <div className="social-grid">
        <AccountCard name="Twitter / X" connected={!!twitterOk} detail={twitterOk ? "Connected" : null}
          onConnect={() => { setActiveConnect("twitter"); setFormUser(""); setFormPass(""); setFormMsg(null); }}
          onDisconnect={() => disconnectPlatform("twitter")} />
        <AccountCard name="LinkedIn" connected={!!linkedinOk} detail={linkedinOk ? "Connected" : null}
          onConnect={() => { setActiveConnect("linkedin"); setFormUser(""); setFormPass(""); setFormMsg(null); }}
          onDisconnect={() => disconnectPlatform("linkedin")} />
        <AccountCard name="Reddit" connected={!!redditOk} detail={redditOk ? "Connected" : null}
          onConnect={() => { setActiveConnect("reddit"); setFormUser(""); setFormPass(""); setFormMsg(null); }}
          onDisconnect={() => disconnectPlatform("reddit")} />
        <AccountCard name="Bluesky" connected={!!bskyOk} detail={bskyOk ? "Connected" : null}
          onConnect={() => { setActiveConnect("bluesky"); setFormUser(""); setFormPass(""); setFormMsg(null); }}
          onDisconnect={() => disconnectPlatform("bluesky")} />
        <AccountCard name="Discord" connected={!!discordOk} detail={discordOk ? "Connected" : null}
          onConnect={() => { setActiveConnect("discord"); setFormUser(""); setFormPass(""); setFormMsg(null); }}
          onDisconnect={() => disconnectPlatform("discord")} />
        <AccountCard name="Telegram" connected={!!telegramOk} detail={telegramOk ? "Connected" : null}
          onConnect={() => { setActiveConnect("telegram"); setFormUser(""); setFormPass(""); setFormMsg(null); }}
          onDisconnect={() => disconnectPlatform("telegram")} />
        <AccountCard name="Email" connected={!!emailOk} detail={emailOk ? (email?.email || "Configured") : null}
          onConnect={() => { setActiveConnect("email"); setFormUser(""); setFormPass(""); setFormName(""); setFormMsg(null); }}
          onDisconnect={() => disconnectPlatform("email")} />
      </div>

      {activeConnect && (
        <div className="social-form">
          <div className="social-form-header">
            <span className="social-form-title">
              {activeConnect === "email" ? "Email (Gmail App Password)" : activeConnect.charAt(0).toUpperCase() + activeConnect.slice(1)}
            </span>
            <button className="btn btn-ghost social-form-close" onClick={() => setActiveConnect(null)}>Close</button>
          </div>

          {activeConnect === "linkedin" ? (
            <div className="social-form-info">
              <span className="social-form-info-text">Opens a browser window for manual LinkedIn login.</span>
              <button className="btn btn-primary social-form-btn" onClick={connectPlatform} disabled={formLoading}>
                {formLoading ? "Opening..." : "Open LinkedIn Login"}
              </button>
            </div>
          ) : (
            <div className="social-form-body">
              <input className="social-form-input" type="text" placeholder={
                activeConnect === "email" ? "Gmail address" :
                activeConnect === "discord" ? "Webhook URL" :
                activeConnect === "telegram" ? "Bot Token" :
                activeConnect === "twitter" ? "Username or email" :
                activeConnect === "reddit" ? "Reddit username" :
                activeConnect === "bluesky" ? "Bluesky handle" : "Username"
              } value={formUser} onChange={e => setFormUser(e.target.value)} />
              {activeConnect !== "discord" && (
                <input className="social-form-input" type={activeConnect === "telegram" ? "text" : "password"} placeholder={
                  activeConnect === "email" ? "App Password" :
                  activeConnect === "telegram" ? "Chat ID" :
                  activeConnect === "bluesky" ? "App Password" : "Password"
                } value={formPass} onChange={e => setFormPass(e.target.value)} />
              )}
              {activeConnect === "email" && (
                <input className="social-form-input-narrow" type="text" placeholder="Display name (optional)"
                  value={formName} onChange={e => setFormName(e.target.value)} />
              )}
              <button className="btn btn-primary social-form-btn" onClick={connectPlatform}
                disabled={formLoading || !formUser || (activeConnect !== "discord" && !formPass)}>
                {formLoading ? "Connecting..." : "Connect"}
              </button>
            </div>
          )}

          {formMsg && (
            <div className={`social-form-msg ${formMsg.ok ? "social-form-msg-ok" : "social-form-msg-err"}`}>
              {formMsg.text}
            </div>
          )}
        </div>
      )}

      <div className="social-queue">
        <button className="social-queue-toggle" onClick={() => setScheduleOpen(o => !o)}>
          <span>Schedule &amp; Queue</span>
          <span className={`social-queue-arrow ${scheduleOpen ? "open" : ""}`}>▾</span>
        </button>

        {scheduleOpen && (
          <div className="social-queue-body">
            {drafts.length > 0 && (
              <div className="social-queue-list" style={{ borderBottom: "1px solid var(--hairline)", paddingBottom: 14 }}>
                <div className="social-queue-list-header">
                  <span className="social-form-title" style={{ color: "var(--accent)" }}>AI Drafts</span>
                  <button className="btn btn-ghost social-card-btn" onClick={fetchDrafts} disabled={draftsLoading}>
                    {draftsLoading ? "..." : "Refresh"}
                  </button>
                </div>
                {drafts.map(item => (
                  <div key={item.id} className="social-queue-item" style={{ borderColor: "var(--accent-sunset-soft)" }}>
                    <div className="social-queue-item-top">
                      <span className="social-queue-item-status status-draft">AI Draft</span>
                      <span className="social-queue-item-time">{new Date(item.created_at * 1000).toLocaleString()}</span>
                    </div>
                    <div className="social-queue-item-text">{item.text}</div>
                    <div className="social-queue-item-bottom">
                      <div className="social-queue-item-platforms">
                        {item.platforms.map(p => (
                          <span key={p} className="social-queue-item-platform">{PLATFORM_LABELS[p] || p}</span>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-primary social-card-btn" onClick={() => approveDraft(item.id)}>Approve</button>
                        <button className="btn btn-ghost social-card-btn" style={{ color: "var(--danger)" }} onClick={() => rejectDraft(item.id)}>Reject</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="social-schedule-form">
              <div className="social-schedule-field">
                <textarea className="social-schedule-textarea" placeholder="Post content..."
                  value={scheduleText} onChange={e => setScheduleText(e.target.value)} rows={3} />
              </div>

              <div className="social-schedule-row">
                <div className="social-schedule-platforms">
                  {ALL_PLATFORMS.map(p => (
                    <label key={p} className={`social-schedule-platform ${schedulePlatforms.includes(p) ? "active" : ""}`}>
                      <input type="checkbox" checked={schedulePlatforms.includes(p)}
                        onChange={() => toggleSchedulePlatform(p)} />
                      {PLATFORM_LABELS[p]}
                    </label>
                  ))}
                </div>
                <input className="social-schedule-datetime" type="datetime-local"
                  value={scheduleTime} onChange={e => setScheduleTime(e.target.value)}
                  min={defaultScheduleTime} />
              </div>

              {schedulePlatforms.includes("reddit") && (
                <div className="social-schedule-row">
                  <input className="social-form-input" type="text" placeholder="Subreddit (e.g. artificial)"
                    value={scheduleSubreddit} onChange={e => setScheduleSubreddit(e.target.value)} />
                  <input className="social-form-input" type="text" placeholder="Post title"
                    value={scheduleTitle} onChange={e => setScheduleTitle(e.target.value)} />
                </div>
              )}

              <div className="social-schedule-row">
                <button className="btn btn-primary social-form-btn" onClick={schedulePost}
                  disabled={scheduleLoading || !scheduleText || schedulePlatforms.length === 0 || !scheduleTime}>
                  {scheduleLoading ? "Scheduling..." : "Schedule Post"}
                </button>
                {scheduleMsg && (
                  <span className={`social-form-msg ${scheduleMsg.ok ? "social-form-msg-ok" : "social-form-msg-err"}`}>
                    {scheduleMsg.text}
                  </span>
                )}
              </div>
            </div>

            <div className="social-queue-list">
              <div className="social-queue-list-header">
                <span className="social-form-title">Scheduled Posts</span>
                <button className="btn btn-ghost social-card-btn" onClick={fetchQueue} disabled={queueLoading}>
                  {queueLoading ? "..." : "Refresh"}
                </button>
              </div>
              {queueItems.length === 0 ? (
                <div className="social-queue-empty">No scheduled posts.</div>
              ) : (
                queueItems.map(item => (
                  <div key={item.id} className="social-queue-item">
                    <div className="social-queue-item-top">
                      <span className={`social-queue-item-status status-${item.status}`}>{item.status}</span>
                      <span className="social-queue-item-time">{new Date(item.scheduled_at * 1000).toLocaleString()}</span>
                    </div>
                    <div className="social-queue-item-text">{item.text}</div>
                    <div className="social-queue-item-bottom">
                      <div className="social-queue-item-platforms">
                        {item.platforms.map(p => (
                          <span key={p} className="social-queue-item-platform">{PLATFORM_LABELS[p] || p}</span>
                        ))}
                      </div>
                      {item.status === "pending" && (
                        <button className="btn btn-ghost social-card-btn" style={{ color: "var(--danger)" }}
                          onClick={() => cancelScheduled(item.id)}>Cancel</button>
                      )}
                    </div>
                    {item.error && item.status === "failed" && (
                      <div className="social-queue-item-error">{item.error}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountCard({ name, connected, detail, onConnect, onDisconnect }: {
  name: string; connected: boolean; detail: string | null;
  onConnect: () => void; onDisconnect: () => void;
}) {
  return (
    <div className={`social-card ${connected ? "social-card-connected" : ""}`}>
      <div className={`social-card-dot ${connected ? "social-card-dot-on" : "social-card-dot-off"}`} />
      <div className="social-card-body">
        <div className="social-card-name">{name}</div>
        {detail && <div className="social-card-detail">{detail}</div>}
      </div>
      <button
        className={`btn ${connected ? "btn-ghost" : "btn-primary"} social-card-btn`}
        onClick={connected ? onDisconnect : onConnect}
      >
        {connected ? "Disconnect" : "Connect"}
      </button>
    </div>
  );
}
