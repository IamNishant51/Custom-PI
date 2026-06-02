#!/usr/bin/env node
/**
 * email-bridge.mjs — Nodemailer + IMAP email bridge
 * Sends and reads email via Gmail App Password.
 *
 * Usage:
 *   node email-bridge.mjs              # start server on :9878
 *   node email-bridge.mjs --port 9879  # custom port
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ── Lazy-load nodemailer/imapflow ───────────────────────────────────────────

let nodemailer, ImapFlow;
async function loadDeps() {
  if (!nodemailer) nodemailer = await import("nodemailer");
  if (!ImapFlow) ImapFlow = (await import("imapflow")).ImapFlow;
}

// ── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.EMAIL_BRIDGE_PORT || "9878", 10);
const PI_DIR = path.join(os.homedir(), ".pi", "agent");
const CREDS_FILE = path.join(PI_DIR, "email-creds.json");
const DAILY_LIMIT = 500;
const RATE_FILE = path.join(PI_DIR, "social-state", "email-rate.json");

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
ensureDir(path.join(PI_DIR, "social-state"));

function loadCreds() {
  try { return JSON.parse(fs.readFileSync(CREDS_FILE, "utf8")); } catch { return null; }
}

function saveCreds(creds) {
  fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

function loadEmailRate() {
  try { return JSON.parse(fs.readFileSync(RATE_FILE, "utf8")); } catch { return { date: "", count: 0 }; }
}

function saveEmailRate(rate) {
  fs.writeFileSync(RATE_FILE, JSON.stringify(rate));
}

function checkEmailRate() {
  const rate = loadEmailRate();
  const today = new Date().toISOString().slice(0, 10);
  if (rate.date !== today) return { allowed: true, sent: 0, limit: DAILY_LIMIT };
  if (rate.count >= DAILY_LIMIT) return { allowed: false, sent: rate.count, limit: DAILY_LIMIT, reason: "Daily email limit reached" };
  return { allowed: true, sent: rate.count, limit: DAILY_LIMIT };
}

function recordEmailSent() {
  const rate = loadEmailRate();
  const today = new Date().toISOString().slice(0, 10);
  if (rate.date !== today) { rate.date = today; rate.count = 0; }
  rate.count++;
  saveEmailRate(rate);
}

// ── Transporter ─────────────────────────────────────────────────────────────

function createTransporter(creds) {
  return nodemailer.default.createTransport({
    service: "gmail",
    auth: {
      user: creds.email,
      pass: creds.appPassword,
    },
  });
}

// ── Send Email ──────────────────────────────────────────────────────────────

async function sendEmail(to, subject, body, isHtml, attachments) {
  const creds = loadCreds();
  if (!creds) return { ok: false, error: "Email not configured — set email and appPassword first" };

  const rateCheck = checkEmailRate();
  if (!rateCheck.allowed) return { ok: false, error: rateCheck.reason };

  const transporter = createTransporter(creds);

  const mailOptions = {
    from: `"${creds.displayName || "PI Agent"}" <${creds.email}>`,
    to,
    subject,
  };

  if (isHtml) {
    mailOptions.html = body;
  } else {
    mailOptions.text = body;
  }

  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments.map(a => ({
      filename: a.filename || path.basename(a.path),
      path: a.path,
    }));
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    recordEmailSent();
    return { ok: true, messageId: info.messageId, message: `Email sent to ${to}` };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ── Read Email (IMAP) ──────────────────────────────────────────────────────

async function readEmails(folder, limit) {
  const creds = loadCreds();
  if (!creds) return { ok: false, error: "Email not configured" };

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword },
    logger: false,
  });

  try {
    await client.connect();
    const mailbox = folder || "INBOX";
    const lock = await client.getMailboxLock(mailbox);

    try {
      const messages = [];
      const maxCount = Math.min(limit || 20, 50);

      // Get latest messages
      for (let i = client.mailbox.exists; i > Math.max(1, client.mailbox.exists - maxCount); i--) {
        try {
          const msg = await client.fetchOne(i, { source: true, envelope: true, uid: true });
          if (msg && msg.envelope) {
            messages.push({
              id: msg.uid,
              from: msg.envelope.from?.[0]?.address || "",
              subject: msg.envelope.subject || "",
              date: msg.envelope.date?.toISOString() || "",
            });
          }
        } catch {}
      }

      return { ok: true, emails: messages };
    } finally {
      lock.release();
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    try { await client.logout(); } catch {}
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  await loadDeps();

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // ── Health ──────────────────────────────────────────────────────────
    if (url.pathname === "/status" && req.method === "GET") {
      const creds = loadCreds();
      const rate = checkEmailRate();
      return jsonResponse(res, 200, {
        ok: true,
        configured: !!creds,
        email: creds?.email || null,
        displayName: creds?.displayName || null,
        rateLimit: rate,
      });
    }

    // ── Configure Credentials ───────────────────────────────────────────
    if (url.pathname === "/configure" && req.method === "POST") {
      const { email, appPassword, displayName } = await parseBody(req);
      if (!email || !appPassword) return jsonResponse(res, 400, { ok: false, error: "email and appPassword required" });
      saveCreds({ email, appPassword, displayName: displayName || "" });

      // Test connection
      const transporter = createTransporter({ email, appPassword });
      try {
        await transporter.verify();
        return jsonResponse(res, 200, { ok: true, message: "Email configured and verified" });
      } catch (e) {
        fs.unlinkSync(CREDS_FILE);
        return jsonResponse(res, 400, { ok: false, error: `Verification failed: ${e.message}` });
      }
    }

    // ── Send Email ──────────────────────────────────────────────────────
    if (url.pathname === "/send" && req.method === "POST") {
      const { to, subject, body, isHtml, attachments } = await parseBody(req);
      if (!to || !subject || !body) return jsonResponse(res, 400, { ok: false, error: "to, subject, and body required" });
      const result = await sendEmail(to, subject, body, isHtml, attachments);
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    // ── Read Emails ─────────────────────────────────────────────────────
    if (url.pathname === "/read" && req.method === "GET") {
      const folder = url.searchParams.get("folder") || "INBOX";
      const limit = parseInt(url.searchParams.get("limit") || "20", 10);
      const result = await readEmails(folder, limit);
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    // ── Delete Credentials ──────────────────────────────────────────────
    if (url.pathname === "/disconnect" && req.method === "POST") {
      try { fs.unlinkSync(CREDS_FILE); } catch {}
      return jsonResponse(res, 200, { ok: true, message: "Email disconnected" });
    }

    jsonResponse(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    jsonResponse(res, 500, { ok: false, error: e.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`Email Bridge running on http://localhost:${PORT}`);
});
