import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

import { streamSimple } from "@earendil-works/pi-ai";
import { encrypt, decrypt, readVault, vaultSet, vaultGet, vaultDelete, vaultList, vaultHealth, vaultImportFromEnv } from "../services/vault.mjs";
import { getOrCreateDb } from "../services/db.mjs";
import { resolveModel, getModelAuth, loadSettings } from "../services/settings.mjs";
import { webSearch } from "../services/web-search.mjs";
import { generateImageOpenAI, generateImageGemini, generateImageGrok } from "../lib/image-generator.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;

const SOCIAL_BRIDGE = process.env.SOCIAL_BRIDGE_URL || "http://localhost:9877";
const EMAIL_BRIDGE = process.env.EMAIL_BRIDGE_URL || "http://localhost:9878";
const ASSETS_DIR = path.join(PI_DIR, "assets");

const ERROR_RESPONSE = {
  type: "object",
  properties: { error: { type: "string" } },
};
const POSTED_CONTENT_FILE = path.join(PI_DIR, "posted-content.json");
const QUEUE_DB_PATH = path.join(PI_DIR, "social-queue.db");
const AUTONOMOUS_INTERVAL = 6 * 60 * 60 * 1000;

function resolveAssetPath(filename) {
  const searchPaths = [
    ASSETS_DIR,
    process.cwd(),
    path.join(process.cwd(), "assets"),
  ];
  for (const dir of searchPaths) {
    try {
      const full = path.join(dir, filename);
      if (fs.existsSync(full)) return full;
    } catch {} // Ignored
  }
  return null;
}

function loadPostedContent() {
  try {
    if (fs.existsSync(POSTED_CONTENT_FILE)) {
      return JSON.parse(fs.readFileSync(POSTED_CONTENT_FILE, "utf8"));
    }
  } catch {} // Ignored
  return [];
}

function savePostedContent(entries) {
  try {
    fs.mkdirSync(path.dirname(POSTED_CONTENT_FILE), { recursive: true });
    const keep = entries.slice(-500);
    fs.writeFileSync(POSTED_CONTENT_FILE, JSON.stringify(keep, null, 2));
  } catch (e) { console.error("[PostedContent] Failed to save:", e.message); }
}

function addPostedEntry(platform, content, topic, url) {
  const entries = loadPostedContent();
  const fingerprint = content.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
  entries.push({
    platform,
    content: fingerprint,
    fullContent: content.slice(0, 500),
    topic: topic || "",
    url: url || "",
    postedAt: new Date().toISOString(),
  });
  savePostedContent(entries);
}

function findSimilarPosted(platform, content, threshold) {
  const entries = loadPostedContent();
  if (entries.length === 0) return [];
  const words = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (words.size === 0) return [];
  const results = [];
  for (const entry of entries) {
    if (platform && entry.platform !== platform) continue;
    const entryWords = new Set(entry.content.split(/\s+/).filter(w => w.length > 3));
    const intersection = new Set([...words].filter(w => entryWords.has(w)));
    const union = new Set([...words, ...entryWords]);
    const similarity = intersection.size / (union.size || 1);
    if (similarity >= (threshold || 0.35)) {
      results.push({ similarity, entry });
    }
  }
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

// ── Posting Functions ───────────────────────────────────────────────────

async function postWithRetry(fn, platform, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      console.log(`[${platform}] post failed (attempt ${attempt}), retrying in ${delay}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function postToTwitter(text, mediaPath) {
  const bridgeUrl = process.env.SOCIAL_BRIDGE_URL || "http://localhost:9877";
  return postWithRetry(async () => {
    const body = { text };
    if (mediaPath) {
      const resolvedPath = resolveAssetPath(path.basename(mediaPath)) || mediaPath;
      if (fs.existsSync(resolvedPath)) body.mediaPath = resolvedPath;
    }
    const res = await fetch(`${bridgeUrl}/twitter/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) return `Tweet posted successfully! ${data.message || ""}`;
    return `Twitter post failed: ${data.error || "unknown error"}`;
  }, "twitter");
}

async function postToReddit(subreddit, title, text, mediaPath) {
  const bridgeUrl = process.env.SOCIAL_BRIDGE_URL || "http://localhost:9877";
  return postWithRetry(async () => {
    const body = { subreddit, title, body: text };
    if (mediaPath) {
      const resolvedPath = resolveAssetPath(path.basename(mediaPath)) || mediaPath;
      if (fs.existsSync(resolvedPath)) body.mediaPath = resolvedPath;
    }
    const res = await fetch(`${bridgeUrl}/reddit/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) return `Posted to r/${subreddit}! ${data.message || ""}`;
    return `Reddit post failed: ${data.error || "unknown error"}`;
  }, "reddit");
}

async function postToBluesky(text, mediaPath) {
  const identifier = vaultGet("BLUESKY_IDENTIFIER");
  const password = vaultGet("BLUESKY_APP_PASSWORD");
  if (!identifier || !password) {
    return "Bluesky credentials not configured. Store BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD in vault.";
  }

  try {
    const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
      signal: AbortSignal.timeout(15000),
    });
    const session = await sessionRes.json();
    if (!session.accessJwt) return `Bluesky auth failed: ${JSON.stringify(session)}`;

    let embed;
    if (mediaPath) {
      const resolvedPath = resolveAssetPath(path.basename(mediaPath)) || mediaPath;
      if (fs.existsSync(resolvedPath)) {
        const imageBuffer = fs.readFileSync(resolvedPath);
        const ext = path.extname(resolvedPath).toLowerCase();
        const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
        const uploadRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", {
          method: "POST",
          headers: {
            "Content-Type": mime,
            Authorization: `Bearer ${session.accessJwt}`,
          },
          body: imageBuffer,
          signal: AbortSignal.timeout(20000),
        });
        const uploadData = await uploadRes.json();
        if (uploadData.blob) {
          embed = {
            $type: "app.bsky.embed.images",
            images: [{ alt: "", image: uploadData.blob }],
          };
        }
      }
    }

    const now = new Date().toISOString();
    const record = {
      $type: "app.bsky.feed.post",
      text: text.slice(0, 300),
      createdAt: now,
    };
    if (embed) record.embed = embed;

    const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
      signal: AbortSignal.timeout(15000),
    });
    const postData = await postRes.json();
    if (postData.uri) return `Posted to Bluesky! URI: ${postData.uri}`;
    return `Bluesky error: ${JSON.stringify(postData)}`;
  } catch (e) {
    return `Bluesky error: ${e.message}`;
  }
}

async function postToDiscord(message, mediaPath) {
  const url = vaultGet("DISCORD_WEBHOOK_URL");
  if (!url) return "Discord webhook not configured. Store DISCORD_WEBHOOK_URL in vault.";
  try {
    const resolvedPath = mediaPath && ((resolveAssetPath(path.basename(mediaPath)) || mediaPath));
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      const { Blob } = globalThis;
      const imageData = fs.readFileSync(resolvedPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
      const formData = new FormData();
      formData.append("content", message.slice(0, 2000));
      formData.append("file", new Blob([imageData], { type: mime }), path.basename(resolvedPath));
      const res = await fetch(url, { method: "POST", body: formData, signal: AbortSignal.timeout(20000) });
      if (res.ok) return "Posted to Discord with image!";
      return `Discord error: ${res.status} ${await res.text()}`;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message.slice(0, 2000) }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return "Posted to Discord!";
    return `Discord error: ${res.status} ${await res.text()}`;
  } catch (e) {
    return `Discord error: ${e.message}`;
  }
}

async function postToTelegram(message, mediaPath) {
  const token = vaultGet("TELEGRAM_BOT_TOKEN");
  const chatId = vaultGet("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return "Telegram not configured. Store TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in vault.";
  try {
    const resolvedPath = mediaPath && ((resolveAssetPath(path.basename(mediaPath)) || mediaPath));
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      const { Blob } = globalThis;
      const imageData = fs.readFileSync(resolvedPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("photo", new Blob([imageData], { type: mime }), path.basename(resolvedPath));
      formData.append("caption", message.slice(0, 1024));
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: "POST", body: formData, signal: AbortSignal.timeout(20000),
      });
      const data = await res.json();
      if (data.ok) return "Posted photo to Telegram!";
      return `Telegram photo error: ${JSON.stringify(data)}`;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message.slice(0, 4096) }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.ok) return "Posted to Telegram!";
    return `Telegram error: ${JSON.stringify(data)}`;
  } catch (e) {
    return `Telegram error: ${e.message}`;
  }
}

async function proxyToBridge(bridgeUrl, endpoint, method, body) {
  const url = `${bridgeUrl}${endpoint}`;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return resp.json();
}

// ── Social bridge process management ───────────────────────────────────

let socialBridgePid = null;
let emailBridgePid = null;

function killBridge(pid) {
  if (pid === null) return;
  try { process.kill(pid, "SIGTERM"); } catch {} // cleanup
  socialBridgePid = socialBridgePid === pid ? null : socialBridgePid;
  emailBridgePid = emailBridgePid === pid ? null : emailBridgePid;
}

async function ensureSocialBridge() {
  if (socialBridgePid !== null) {
    try { process.kill(socialBridgePid, 0); return; } catch { socialBridgePid = null; }
  }
  try {
    await fetch(`${SOCIAL_BRIDGE}/status`);
    return;
  } catch {
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const bridgePath = path.join(__dirname, "..", "social-bridge.mjs");
    if (fs.existsSync(bridgePath)) {
      const { spawn } = await import("node:child_process");
      const child = spawn(process.execPath, [bridgePath], {
        detached: true,
        stdio: "ignore",
      });
      socialBridgePid = child.pid;
      child.unref();
      console.log("  ✦ Social bridge started on port 9877");
    }
  }
}

async function ensureEmailBridge() {
  if (emailBridgePid !== null) {
    try { process.kill(emailBridgePid, 0); return; } catch { emailBridgePid = null; }
  }
  try {
    await fetch(`${EMAIL_BRIDGE}/status`);
    return;
  } catch {
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const bridgePath = path.join(__dirname, "..", "email-bridge.mjs");
    if (fs.existsSync(bridgePath)) {
      const { spawn } = await import("node:child_process");
      const child = spawn(process.execPath, [bridgePath], {
        detached: true,
        stdio: "ignore",
      });
      emailBridgePid = child.pid;
      child.unref();
      console.log("  ✦ Email bridge started on port 9878");
    }
  }
}

export {
  postToTwitter, postToReddit, postToBluesky, postToDiscord, postToTelegram,
  addPostedEntry, findSimilarPosted,
  socialBridgePid, emailBridgePid, SOCIAL_BRIDGE, EMAIL_BRIDGE,
};

export default function registerSocial(app, { sendError, broadcast }) {
  async function getLLMCompletion(systemPrompt, userPrompt) {
    const model = resolveModel();
    const auth = getModelAuth(model);
    let text = "";
    try {
      const stream = streamSimple(model, {
        systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }]
      }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" });
      for await (const event of stream) {
        if (event.type === "text_delta") text += event.delta;
      }
    } catch (e) {
      console.error("LLM Error:", e);
    }
    return text.trim();
  }

  async function generatePostImage(prompt) {
    const provider = vaultGet("OPENAI_API_KEY") ? "openai" : vaultGet("GEMINI_API_KEY") ? "gemini" : vaultGet("XAI_API_KEY") ? "grok" : null;
    if (!provider) return { error: "No image generation keys in vault." };

    try {
      if (provider === "openai") return await generateImageOpenAI(prompt, "1024x1024", "base64");
      if (provider === "gemini") return await generateImageGemini(prompt);
      if (provider === "grok") return await generateImageGrok(prompt, "base64");
    } catch (e) {
      return { error: e.message };
    }
    return { error: "Failed to generate image." };
  }

  async function getConnectedPlatforms() {
    const connected = [];
    try {
      const social = await proxyToBridge(SOCIAL_BRIDGE, "/status", "GET").catch(() => ({ platforms: {} }));
      if (social.platforms?.twitter?.sessionActive) connected.push("twitter");
      if (social.platforms?.reddit?.sessionActive) connected.push("reddit");
    } catch {} // Ignored
    if (vaultGet("BLUESKY_IDENTIFIER") && vaultGet("BLUESKY_APP_PASSWORD")) connected.push("bluesky");
    if (vaultGet("DISCORD_WEBHOOK_URL")) connected.push("discord");
    if (vaultGet("TELEGRAM_BOT_TOKEN") && vaultGet("TELEGRAM_CHAT_ID")) connected.push("telegram");
    return connected;
  }

  // ── Social Queue (Scheduling) ─────────────────────────────────────────

  let queueDb = null;
  try {
    const Database = _require("better-sqlite3");
    queueDb = new Database(QUEUE_DB_PATH);
    queueDb.pragma("journal_mode = WAL");
    queueDb.pragma("synchronous = NORMAL");
    queueDb.exec(`
      CREATE TABLE IF NOT EXISTS social_queue (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        media_path TEXT,
        platforms TEXT NOT NULL,
        title TEXT,
        subreddit TEXT,
        scheduled_at INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        error TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);
    console.log("  ✦ Social queue initialized");
  } catch (e) {
    console.log("  ⚠ Social queue not available (better-sqlite3?):", e.message);
  }

  function addToQueue(text, platforms, scheduledAt, opts = {}) {
    if (!queueDb) return { ok: false, error: "Queue database not available" };
    const id = crypto.randomUUID();
    const stmt = queueDb.prepare(`
      INSERT INTO social_queue (id, text, media_path, platforms, title, subreddit, scheduled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `);
    stmt.run(id, text, opts.mediaPath || null, JSON.stringify(platforms), opts.title || null, opts.subreddit || null, scheduledAt);
    return { ok: true, id };
  }

  async function processQueue() {
    if (!queueDb) return;
    try {
      const now = Math.floor(Date.now() / 1000);
      const rows = queueDb.prepare("SELECT * FROM social_queue WHERE status = 'pending' AND scheduled_at <= ? LIMIT 5").all(now);
      for (const row of rows) {
        const id = row.id;
        queueDb.prepare("UPDATE social_queue SET status = 'processing' WHERE id = ?").run(id);
        const platforms = JSON.parse(row.platforms);
        const errors = [];
        for (const platform of platforms) {
          try {
            let result;
            if (platform === "twitter") result = await postToTwitter(row.text);
            else if (platform === "reddit") result = await postToReddit(row.subreddit || "programming", row.title || "Shared via Custom-PI", row.text);
            else if (platform === "bluesky") result = await postToBluesky(row.text);
            else if (platform === "discord") result = await postToDiscord(row.text);
            else if (platform === "telegram") result = await postToTelegram(row.text);
            else if (platform === "linkedin") {
              const bridgeUrl = process.env.SOCIAL_BRIDGE_URL || "http://localhost:9877";
              const bridgeRes = await fetch(`${bridgeUrl}/linkedin/post`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: row.text, mediaPath: row.media_path }),
              });
              const bridgeData = await bridgeRes.json();
              result = bridgeData.ok ? "Posted to LinkedIn!" : `LinkedIn error: ${bridgeData.error}`;
            } else {
              result = `Unknown platform: ${platform}`;
            }
            errors.push(`${platform}: ${result}`);
          } catch (e) {
            errors.push(`${platform}: ${e.message}`);
          }
        }
        const allOk = errors.every(e => !e.includes("error") && !e.includes("fail") && !e.includes("unreachable"));
        queueDb.prepare("UPDATE social_queue SET status = ?, error = ? WHERE id = ?")
          .run(allOk ? "published" : "failed", errors.join("; "), id);
      }
    } catch (e) {
      console.error("Queue processor error:", e.message);
    }
  }

  setInterval(processQueue, 30_000);
  setTimeout(processQueue, 5_000);

  // ── Bridge auto-start ───────────────────────────────────────────────

  ensureSocialBridge();
  ensureEmailBridge();

  // ── Social Bridge Status ──────────────────────────────────────────

  app.get("/api/social/status", {
    schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, platforms: { type: "object" }, error: { type: "string" } } } } },
  }, async () => {
    try {
      const social = await proxyToBridge(SOCIAL_BRIDGE, "/status", "GET").catch(() => ({ platforms: {} }));
      const bskyConfigured = !!(vaultGet("BLUESKY_IDENTIFIER") && vaultGet("BLUESKY_APP_PASSWORD"));
      const discordConfigured = !!vaultGet("DISCORD_WEBHOOK_URL");
      const telegramConfigured = !!(vaultGet("TELEGRAM_BOT_TOKEN") && vaultGet("TELEGRAM_CHAT_ID"));

      return {
        ok: true,
        platforms: {
          ...social.platforms,
          bluesky: { configured: bskyConfigured },
          discord: { configured: discordConfigured },
          telegram: { configured: telegramConfigured },
        }
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Email Bridge Status
  app.get("/api/social/email/status", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, configured: { type: "boolean" }, email: { type: "string" }, displayName: { type: "string" }, error: { type: "string" } } }, "4xx": ERROR_RESPONSE, "5xx": ERROR_RESPONSE } } }, async () => {
    try {
      const result = await fetch(`${EMAIL_BRIDGE}/status`).then(r => r.json());
      return {
        ok: true,
        configured: result.configured || false,
        email: result.email || null,
        displayName: result.displayName || null,
      };
    } catch (e) {
      return { ok: false, configured: false, email: null, displayName: null, error: e.message };
    }
  });

  // Twitter Proxy
  app.post("/api/social/twitter/login", { schema: { body: { type: "object", additionalProperties: true, properties: { oauth_token: { type: "string" }, oauth_verifier: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async (req) => proxyToBridge(SOCIAL_BRIDGE, "/twitter/login", "POST", req.body));
  app.post("/api/social/twitter/post", { schema: { body: { type: "object", additionalProperties: true, properties: { text: { type: "string" }, mediaPath: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async (req) => proxyToBridge(SOCIAL_BRIDGE, "/twitter/post", "POST", req.body));
  app.post("/api/social/twitter/reply", { schema: { body: { type: "object", additionalProperties: true, properties: { text: { type: "string" }, in_reply_to_status_id: { type: "string" }, mediaPath: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async (req) => proxyToBridge(SOCIAL_BRIDGE, "/twitter/reply", "POST", req.body));
  // Parameterized disconnect — single handler for all platforms
  async function handleDisconnect(platform) {
    if (platform === "bluesky") {
      vaultDelete("BLUESKY_IDENTIFIER");
      vaultDelete("BLUESKY_APP_PASSWORD");
      return { ok: true, message: "Bluesky disconnected" };
    }
    if (platform === "discord") {
      vaultDelete("DISCORD_WEBHOOK_URL");
      return { ok: true, message: "Discord disconnected" };
    }
    if (platform === "telegram") {
      vaultDelete("TELEGRAM_BOT_TOKEN");
      vaultDelete("TELEGRAM_CHAT_ID");
      return { ok: true, message: "Telegram disconnected" };
    }
    return proxyToBridge(SOCIAL_BRIDGE, `/${platform}/disconnect`, "POST");
  }

  app.post("/api/social/:platform/disconnect", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async (req) => {
    const { platform } = req.params;
    return handleDisconnect(platform);
  });

  app.post("/api/social/twitter/disconnect", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async () => handleDisconnect("twitter"));

  // Reddit Proxy
  app.post("/api/social/reddit/login", { schema: { body: { type: "object", additionalProperties: true, properties: {} }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async (req) => proxyToBridge(SOCIAL_BRIDGE, "/reddit/login", "POST", req.body));
  app.post("/api/social/reddit/post", { schema: { body: { type: "object", additionalProperties: true, properties: { subreddit: { type: "string" }, title: { type: "string" }, body: { type: "string" }, mediaPath: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async (req) => proxyToBridge(SOCIAL_BRIDGE, "/reddit/post", "POST", req.body));
  app.post("/api/social/reddit/comment", { schema: { body: { type: "object", additionalProperties: true, properties: { post_id: { type: "string" }, text: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async (req) => proxyToBridge(SOCIAL_BRIDGE, "/reddit/comment", "POST", req.body));
  app.post("/api/social/reddit/disconnect", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async () => handleDisconnect("reddit"));

  // LinkedIn Proxy
  app.post("/api/social/linkedin/login", { schema: { body: { type: "object", additionalProperties: true, properties: {} }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async (req) => proxyToBridge(SOCIAL_BRIDGE, "/linkedin/login", "POST", req.body));
  app.post("/api/social/linkedin/setup", { schema: { body: { type: "object", nullable: true, additionalProperties: true }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async (req) => proxyToBridge(SOCIAL_BRIDGE, "/linkedin/setup", "POST", req.body));
  app.post("/api/social/linkedin/post", { schema: { body: { type: "object", additionalProperties: true, properties: { text: { type: "string" }, mediaPath: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async (req) => proxyToBridge(SOCIAL_BRIDGE, "/linkedin/post", "POST", req.body));
  app.post("/api/social/linkedin/disconnect", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } }, additionalProperties: true } } } }, async () => handleDisconnect("linkedin"));

  // Bluesky
  app.post("/api/social/bluesky/configure", { schema: { body: { type: "object", additionalProperties: true, properties: { username: { type: "string" }, password: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } } }, "4xx": ERROR_RESPONSE, "5xx": ERROR_RESPONSE } } }, async (req) => {
    const { username, password } = req.body;
    if (!username || !password) return { ok: false, error: "username and password required" };
    vaultSet("BLUESKY_IDENTIFIER", username);
    vaultSet("BLUESKY_APP_PASSWORD", password);
    return { ok: true, message: "Bluesky configured successfully" };
  });
  app.post("/api/social/bluesky/disconnect", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, message: { type: "string" } } } } } }, async () => handleDisconnect("bluesky"));
  app.post("/api/social/bluesky/post", { schema: { body: { type: "object", additionalProperties: true, properties: { text: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } } } } } }, async (req) => {
    const { text } = req.body;
    if (!text) return { ok: false, error: "text required" };
    const res = await postToBluesky(text);
    return { ok: !res.toLowerCase().includes("error"), message: res };
  });

  // Discord
  app.post("/api/social/discord/configure", { schema: { body: { type: "object", additionalProperties: true, properties: { webhookUrl: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } } }, "4xx": ERROR_RESPONSE, "5xx": ERROR_RESPONSE } } }, async (req) => {
    const { webhookUrl } = req.body;
    if (!webhookUrl) return { ok: false, error: "webhookUrl required" };
    vaultSet("DISCORD_WEBHOOK_URL", webhookUrl);
    return { ok: true, message: "Discord configured successfully" };
  });
  app.post("/api/social/discord/disconnect", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, message: { type: "string" } } } } } }, async () => handleDisconnect("discord"));
  app.post("/api/social/discord/post", { schema: { body: { type: "object", additionalProperties: true, properties: { text: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } } } } } }, async (req) => {
    const { text } = req.body;
    if (!text) return { ok: false, error: "text required" };
    const res = await postToDiscord(text);
    return { ok: !res.toLowerCase().includes("error"), message: res };
  });

  // Telegram
  app.post("/api/social/telegram/configure", { schema: { body: { type: "object", additionalProperties: true, properties: { token: { type: "string" }, chatId: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } } }, "4xx": ERROR_RESPONSE, "5xx": ERROR_RESPONSE } } }, async (req) => {
    const { token, chatId } = req.body;
    if (!token || !chatId) return { ok: false, error: "token and chatId required" };
    vaultSet("TELEGRAM_BOT_TOKEN", token);
    vaultSet("TELEGRAM_CHAT_ID", chatId);
    return { ok: true, message: "Telegram configured successfully" };
  });
  app.post("/api/social/telegram/disconnect", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, message: { type: "string" } } } } } }, async () => handleDisconnect("telegram"));
  app.post("/api/social/telegram/post", { schema: { body: { type: "object", additionalProperties: true, properties: { text: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } } } } } }, async (req) => {
    const { text } = req.body;
    if (!text) return { ok: false, error: "text required" };
    const res = await postToTelegram(text);
    return { ok: !res.toLowerCase().includes("error"), message: res };
  });

  // Cross-platform Publish Draft
  app.post("/api/social/publish", { schema: { body: { type: "object", additionalProperties: true, properties: { text: { type: "string" }, mediaPath: { type: "string" }, platforms: { type: "array", items: { type: "string" } }, drafts: { type: "object" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } } }, "4xx": ERROR_RESPONSE, "5xx": ERROR_RESPONSE } } }, async (req) => {
    const { text, mediaPath, platforms, drafts } = req.body;
    if (!text) return { ok: false, error: "text required" };

    const results = [];
    const targetPlatforms = platforms || ["twitter"];

    for (const platform of targetPlatforms) {
      let platformText = text;
      if (drafts && drafts[platform]) {
        platformText = drafts[platform];
        if (typeof platformText === "object") {
          platformText = platformText.body || platformText.text || JSON.stringify(platformText);
        }
      }

      try {
        if (platform === "twitter") {
          const res = await proxyToBridge(SOCIAL_BRIDGE, "/twitter/post", "POST", { text: platformText, mediaPath });
          results.push(`Twitter: ${res.ok ? "Success" : "Failed (" + res.error + ")"}`);
        } else if (platform === "linkedin") {
          const res = await proxyToBridge(SOCIAL_BRIDGE, "/linkedin/post", "POST", { text: platformText, mediaPath });
          results.push(`LinkedIn: ${res.ok ? "Success" : "Failed (" + res.error + ")"}`);
        } else if (platform === "reddit") {
          const title = (drafts?.reddit?.title) || "Shared via Custom-PI";
          const res = await proxyToBridge(SOCIAL_BRIDGE, "/reddit/post", "POST", { subreddit: "programming", title, body: platformText });
          results.push(`Reddit: ${res.ok ? "Success" : "Failed (" + res.error + ")"}`);
        } else if (platform === "bluesky") {
          const res = await postToBluesky(platformText);
          results.push(`Bluesky: ${res.includes("Posted") ? "Success" : "Failed (" + res + ")"}`);
        } else if (platform === "discord") {
          const res = await postToDiscord(platformText);
          results.push(`Discord: ${res.includes("Posted") ? "Success" : "Failed (" + res + ")"}`);
        } else if (platform === "telegram") {
          const res = await postToTelegram(platformText);
          results.push(`Telegram: ${res.includes("Posted") ? "Success" : "Failed (" + res + ")"}`);
        }
      } catch (err) {
        results.push(`${platform}: Failed (${err.message})`);
      }
    }

    return { ok: true, message: `Publish execution completed:\n${results.join("\n")}` };
  });

  // Social Queue Routes
  app.post("/api/social/queue", { schema: { body: { type: "object", additionalProperties: true, properties: { text: { type: "string" }, platforms: { type: "array", items: { type: "string" } }, scheduled_at: { type: "number" }, title: { type: "string" }, subreddit: { type: "string" }, mediaPath: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, id: { type: "string" }, error: { type: "string" } } } } } }, async (req) => {
    const { text, platforms, scheduled_at, title, subreddit, mediaPath } = req.body || {};
    if (!text || !platforms || !scheduled_at) return { ok: false, error: "text, platforms, and scheduled_at required" };
    if (!Array.isArray(platforms) || platforms.length === 0) return { ok: false, error: "platforms must be a non-empty array" };
    return addToQueue(text, platforms, scheduled_at, { title, subreddit, mediaPath });
  });

  app.get("/api/social/queue", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, items: { type: "array", items: { type: "object" } }, error: { type: "string" } } } } } }, async () => {
    if (!queueDb) return { ok: false, error: "Queue database not available", items: [] };
    const rows = queueDb.prepare("SELECT * FROM social_queue ORDER BY scheduled_at ASC").all();
    return { ok: true, items: rows.map(r => ({ ...r, platforms: JSON.parse(r.platforms) })) };
  });

  app.delete("/api/social/queue/:id", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } } } } } }, async (req) => {
    if (!queueDb) return { ok: false, error: "Queue database not available" };
    const { id } = req.params;
    const stmt = queueDb.prepare("DELETE FROM social_queue WHERE id = ? AND status = 'pending'");
    const info = stmt.run(id);
    if (info.changes === 0) return { ok: false, error: "Post not found or already processed" };
    return { ok: true, message: "Post cancelled" };
  });

  // ── Autonomous Content Strategy ───────────────────────────────────────

  const SECRET_PATTERNS = [
    /sk-[a-zA-Z0-9]{20,}/,
    /ghp_[a-zA-Z0-9]{36,}/,
    /gho_[a-zA-Z0-9]{36,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/,
    /(password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i,
    /https?:\/\/[^\/\s]+@[^\/\s]+/,
    /\/home\/[a-z_][a-z0-9_-]*\//,
    /~\/\.(pi|ssh|aws|config)\//,
  ];

  function securityScan(text) {
    const issues = [];
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        issues.push(`Matched: ${pattern}`);
      }
    }
    return issues;
  }

  const PLATFORM_WRITE_GUIDES = {
    twitter: "Twitter (max 260 chars, conversational, hashtags ok)",
    reddit: "Reddit (conversational + informative, 200-800 chars, suitable for a subreddit post)",
    bluesky: "Bluesky (concise, max 300 chars, hashtags ok)",
    discord: "Discord (casual announcement, 100-500 chars, informal)",
    telegram: "Telegram (direct update, 100-500 chars, direct tone)",
  };

  async function autonomousContentTick() {
    console.log("[autonomous] Starting content generation tick...");
    const drafts = [];

    const connectedPlatforms = await getConnectedPlatforms();
    if (connectedPlatforms.length === 0) {
      console.log("[autonomous] No connected platforms, skipping content generation.");
      return;
    }
    const platformGuides = connectedPlatforms.map(p => PLATFORM_WRITE_GUIDES[p] || p).join(", ");

    let codeChanges = "";
    try {
      const { execSync } = await import("node:child_process");
      const since = new Date(Date.now() - 86400000).toISOString().split("T")[0];
      const log = execSync(`git log --since="${since}" --oneline --no-decorate -20`, {
        cwd: path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".."),
        encoding: "utf8",
        timeout: 10000,
      }).trim();
      if (log) codeChanges = log;
    } catch {} // Ignored

    let trends = "";
    try {
      const results = await webSearch("latest in AI agentic frameworks LLM tools 2026", 5);
      trends = typeof results === "string" ? results : results;
    } catch {} // Ignored

    const systemPrompt = `You are a senior developer writing social media content about AI and software engineering. 
Write engaging, expert-level posts that teach something valuable.

RULES:
- Each post must be self-contained and ready to publish
- Only write for these connected platforms: ${platformGuides}
- Do NOT write for any other platforms
- Use the cheat sheet format for maximum engagement
- Lead with a hook, teach a framework, end with insight
- No buzzwords, no fluff, no weasel words
- Never include API keys, paths, passwords, or secrets`;

    const platformNames = connectedPlatforms.join(", ");
    const userPrompt = `Generate 2 social media posts based on this context:

RECENT CODE CHANGES:
${codeChanges || "No significant changes in the last 24 hours."}

TRENDING TOPICS:
${trends || "General AI and software development trends."}

CONNECTED PLATFORMS (ONLY write for platforms from this list — do NOT use any others):
${platformNames}

Return a JSON array. Each item:
{
  "platforms": ["twitter"] or ["twitter", "reddit"] (only from the connected platforms list above),
  "text": "The post content",
  "title": "Title (only for reddit posts)",
  "subreddit": "Subreddit name (only for reddit posts)
}`;

    let generated = [];
    try {
      const raw = await getLLMCompletion(systemPrompt, userPrompt);
      const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) generated = parsed;
    } catch (e) {
      console.error("[autonomous] LLM generation error:", e.message);
    }

    for (const post of generated) {
      if (!post.text || !post.platforms) continue;
      const issues = securityScan(post.text);
      if (issues.length > 0) {
        console.log(`[autonomous] Draft blocked by security: ${issues.join(", ")}`);
        continue;
      }
      const id = crypto.randomUUID();
      try {
        const stmt = queueDb.prepare(`
          INSERT INTO social_queue (id, text, media_path, platforms, title, subreddit, scheduled_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
        `);
        stmt.run(id, post.text, null, JSON.stringify(post.platforms), post.title || null, post.subreddit || null, Math.floor(Date.now() / 1000));
        drafts.push(id);
      } catch {} // Ignored
    }

    console.log(`[autonomous] Generated ${drafts.length} draft(s)`);
  }

  // Drafts API
  app.get("/api/social/drafts", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, items: { type: "array", items: { type: "object" } } } } } } }, async () => {
    if (!queueDb) return { ok: false, items: [] };
    const rows = queueDb.prepare("SELECT * FROM social_queue WHERE status = 'draft' ORDER BY created_at DESC").all();
    return { ok: true, items: rows.map(r => ({ ...r, platforms: JSON.parse(r.platforms) })) };
  });

  app.post("/api/social/drafts/:id/approve", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } } } } } }, async (req) => {
    if (!queueDb) return { ok: false, error: "Queue not available" };
    const { id } = req.params;
    const stmt = queueDb.prepare("UPDATE social_queue SET status = 'pending' WHERE id = ? AND status = 'draft'");
    const info = stmt.run(id);
    if (info.changes === 0) return { ok: false, error: "Draft not found or already approved" };
    return { ok: true, message: "Draft approved and queued for publishing" };
  });

  app.post("/api/social/drafts/:id/reject", { schema: { response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, message: { type: "string" } } } } } }, async (req) => {
    if (!queueDb) return { ok: false, error: "Queue not available" };
    const { id } = req.params;
    queueDb.prepare("DELETE FROM social_queue WHERE id = ? AND status = 'draft'").run(id);
    return { ok: true, message: "Draft rejected" };
  });

  // Manual trigger for autonomous tick
  app.post("/api/social/autonomous/tick", { schema: { body: { type: "object", additionalProperties: true, properties: {} }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, message: { type: "string" } } } } } }, async () => {
    autonomousContentTick();
    return { ok: true, message: "Autonomous content generation started. Check /api/social/drafts in a minute." };
  });

  if (process.env.AUTONOMOUS_ENABLED === "true") {
    setInterval(autonomousContentTick, AUTONOMOUS_INTERVAL);
  }
}
