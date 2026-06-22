import path from "node:path";
import fs from "node:fs";
import { encrypt, decrypt } from "../services/vault.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;

export default function registerEmail(app, { sendError }) {
  const EMAIL_STATE_FILE = path.join(PI_DIR, "email-state.json");
  function getEmailState() {
    try { return JSON.parse(fs.readFileSync(EMAIL_STATE_FILE, "utf8")); } catch { return { accounts: [], cachedEmails: [] }; }
  }
  function saveEmailState(state) { fs.writeFileSync(EMAIL_STATE_FILE, JSON.stringify(state, null, 2)); }

  app.post("/api/email/accounts", { schema: { body: { type: "object", additionalProperties: true, properties: { imapHost: { type: "string" }, imapPort: { type: "number" }, smtpHost: { type: "string" }, smtpPort: { type: "number" }, username: { type: "string" }, password: { type: "string" }, useTls: { type: "boolean" } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" }, id: { type: "string" }, error: { type: "string" } } } } } }, async (req) => {
    const { imapHost, imapPort, smtpHost, smtpPort, username, password, useTls } = req.body || {};
    if (!imapHost || !username) return { error: "imapHost and username required" };
    const state = getEmailState();
    const id = `email_${Date.now()}`;
    state.accounts.push({ id, imapHost, imapPort: imapPort || 993, smtpHost: smtpHost || imapHost, smtpPort: smtpPort || 465, username, password: encrypt(password || ""), useTls: useTls !== false });
    saveEmailState(state);
    return { success: true, id };
  });

  app.get("/api/email/accounts", { schema: { response: { 200: { type: "object", properties: { accounts: { type: "array" } } } } } }, async () => {
    const state = getEmailState();
    return { accounts: state.accounts.map(a => ({ ...a, password: "***" })) };
  });
  app.delete("/api/email/accounts/:id", { schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } } } }, async (req) => {
    const state = getEmailState();
    const idx = state.accounts.findIndex(a => a.id === req.params.id);
    if (idx === -1) return { error: "Account not found" };
    state.accounts.splice(idx, 1);
    saveEmailState(state);
    return { success: true };
  });

  app.post("/api/email/fetch", { schema: { body: { type: "object", additionalProperties: true, properties: { accountId: { type: "string" }, folder: { type: "string" }, maxMessages: { type: "number" } } }, response: { 200: { type: "object", properties: { emails: { type: "array" }, error: { type: "string" } } } } } }, async (req) => {
    const { accountId, folder, maxMessages } = req.body || {};
    const state = getEmailState();
    const account = state.accounts.find(a => a.id === accountId);
    if (!account) return { error: "Account not found" };
    try {
      const password = decrypt(account.password);
      const net = await import("node:net");
      const tls = await import("node:tls");
      const port = account.imapPort || 993;
      const useTls = account.useTls !== false;
      const client = useTls ? tls : net;
      return new Promise((resolve) => {
        const socket = client.connect(port, account.imapHost, () => {
          let buf = "";
          let step = 0;
          const tag = `a${Date.now() % 1000}`;
          const onData = (data) => {
            buf += data.toString();
            if (step === 0 && buf.includes("* OK")) {
              socket.write(`${tag} LOGIN ${account.username} ${password}\r\n`);
              step = 1; buf = "";
            } else if (step === 1 && buf.includes(`${tag} OK`)) {
              socket.write(`${tag} SELECT "${folder || "INBOX"}"\r\n`);
              step = 2; buf = "";
            } else if (step === 2 && buf.includes(`${tag} OK`)) {
              socket.write(`${tag} FETCH 1:${maxMessages || 10} (BODY[HEADER.FIELDS (SUBJECT FROM DATE)])\r\n`);
              step = 3; buf = "";
            } else if (step === 3 && (buf.includes(`${tag} OK`) || buf.includes(`${tag} BAD`))) {
              socket.end();
              const emails = (buf.match(/\* \d+ FETCH[\s\S]*?\)\)/g) || []).map(raw => ({
                raw: raw.slice(0, 500),
                subject: raw.match(/SUBJECT:? "?([^"\r\n]+)/i)?.[1]?.trim() || "(no subject)",
                from: raw.match(/FROM:? "?([^"\r\n]+)/i)?.[1]?.trim() || "(unknown)",
                date: raw.match(/DATE:? "?([^"\r\n]+)/i)?.[1]?.trim() || "",
              }));
              resolve({ emails });
            }
          };
          socket.on("data", onData);
          setTimeout(() => { socket.end(); resolve({ emails: [] }); }, 10000);
        });
        socket.on("error", () => resolve({ error: "Connection failed", emails: [] }));
      });
    } catch (e) { return { error: e.message, emails: [] }; }
  });

  app.post("/api/email/send", { schema: { body: { type: "object", additionalProperties: true, properties: { accountId: { type: "string" }, to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } } } }, async (req) => {
    const { accountId, to, subject, body } = req.body || {};
    if (!to || !subject) return { error: "to and subject required" };
    const state = getEmailState();
    const account = state.accounts.find(a => a.id === accountId);
    if (!account) return { error: "Account not found" };
    try {
      const password = decrypt(account.password);
      const net = await import("node:net");
      const tls = await import("node:tls");
      return new Promise((resolve) => {
        const socket = tls.connect(account.smtpPort || 465, account.smtpHost, () => {
          let buf = "";
          let step = 0;
          const onData = (data) => {
            buf += data.toString();
            if (step === 0 && buf.includes("220")) {
              socket.write(`EHLO pi-custom-pack\r\n`); step = 1; buf = "";
            } else if (step === 1 && buf.includes("250")) {
              socket.write(`AUTH LOGIN\r\n`); step = 2; buf = "";
            } else if (step === 2 && buf.includes("334")) {
              socket.write(Buffer.from(account.username).toString("base64") + "\r\n"); step = 3; buf = "";
            } else if (step === 3 && buf.includes("334")) {
              socket.write(Buffer.from(password).toString("base64") + "\r\n"); step = 4; buf = "";
            } else if (step === 4 && buf.includes("235")) {
              socket.write(`MAIL FROM:<${account.username}>\r\n`); step = 5; buf = "";
            } else if (step === 5 && buf.includes("250")) {
              socket.write(`RCPT TO:<${to}>\r\n`); step = 6; buf = "";
            } else if (step === 6 && buf.includes("250")) {
              socket.write("DATA\r\n"); step = 7; buf = "";
            } else if (step === 7 && buf.includes("354")) {
              socket.write(`From: ${account.username}\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${body}\r\n.\r\n`);
              step = 8; buf = "";
            } else if (step === 8 && (buf.includes("250") || buf.includes("OK"))) {
              socket.write("QUIT\r\n"); socket.end();
              resolve({ success: true });
            }
          };
          socket.on("data", onData);
          setTimeout(() => { socket.end(); resolve({ success: false, error: "Timeout" }); }, 15000);
        });
        socket.on("error", (e) => resolve({ success: false, error: e.message }));
      });
    } catch (e) { return { error: e.message, success: false }; }
  });

  app.post("/api/email/ai-summarize", { schema: { body: { type: "object", additionalProperties: true, properties: { text: { type: "string" } } }, response: { 200: { type: "object", properties: { summary: { type: "string" } } } } } }, async (req) => {
    const { text } = req.body || {};
    if (!text) return { summary: "No text provided" };
    const lines = text.split("\n").filter(Boolean).slice(0, 50);
    const summary = `Summary of ${lines.length} email(s):\n` + lines.map(l => {
      if (l.includes("Subject:")) return `📧 ${l.replace("Subject:", "").trim()}`;
      if (l.includes("From:")) return `👤 ${l.replace("From:", "").trim()}`;
      return "";
    }).filter(Boolean).join("\n");
    return { summary: summary || "Could not summarize" };
  });

  app.post("/api/email/draft-reply", { schema: { body: { type: "object", additionalProperties: true, properties: { emailText: { type: "string" }, tone: { type: "string" } } }, response: { 200: { type: "object", properties: { draft: { type: "string" } } } } } }, async (req) => {
    const { emailText, tone } = req.body || {};
    if (!emailText) return { draft: "No email text provided" };
    const toneGuide = tone === "formal" ? "Write a formal, professional reply." : tone === "brief" ? "Write a short, concise reply." : "Write a friendly, conversational reply.";
    try {
      const r = await fetch("http://127.0.0.1:1234/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "", messages: [{ role: "system", content: `You are an email assistant. ${toneGuide} Generate ONLY the reply body, no subject line, no explanation.` }, { role: "user", content: `Generate a reply to this email:\n\n${emailText.slice(0, 2000)}` }], stream: false, max_tokens: 500 }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await r.json();
      return { draft: data.choices?.[0]?.message?.content || "Dear colleague,\n\nThank you for your message.\n\nBest regards" };
    } catch { return { draft: "Dear colleague,\n\nThank you for your message.\n\nBest regards" }; }
  });

  app.post("/api/email/auto-tag", { schema: { body: { type: "object", additionalProperties: true, properties: { text: { type: "string" } } }, response: { 200: { type: "object", properties: { tags: { type: "array" } } } } } }, async (req) => {
    const { text } = req.body || {};
    if (!text) return { tags: [] };
    const lower = text.toLowerCase();
    const tags = [];
    if (/invoice|bill|payment|receipt|transaction/i.test(lower)) tags.push("billing");
    if (/meeting|schedule|appointment|calendar|invite/i.test(lower)) tags.push("calendar");
    if (/job|application|hiring|interview|resume|recruiter/i.test(lower)) tags.push("career");
    if (/newsletter|digest|update|announcement/i.test(lower)) tags.push("newsletter");
    if (/password|reset|login|account|security|verify|authentication/i.test(lower)) tags.push("security");
    if (/order|shipping|delivery|tracking|purchase/i.test(lower)) tags.push("shopping");
    if (/support|help|issue|bug|problem|error|fail/i.test(lower)) tags.push("support");
    if (/friend|family|dinner|lunch|party|weekend|thanks|love/i.test(lower)) tags.push("personal");
    if (/report|analysis|summary|review|project|deadline|submission/i.test(lower)) tags.push("work");
    if (tags.length === 0) tags.push("inbox");
    return { tags: [...new Set(tags)] };
  });

  app.post("/api/email/search", { schema: { body: { type: "object", additionalProperties: true, properties: { query: { type: "string" } } }, response: { 200: { type: "object", properties: { results: { type: "array" }, total: { type: "number" } } } } } }, async (req) => {
    const { query } = req.body || {};
    if (!query) return { results: [] };
    const state = getEmailState();
    const q = query.toLowerCase();
    const results = state.cachedEmails.filter(e =>
      (e.subject || "").toLowerCase().includes(q) ||
      (e.from || "").toLowerCase().includes(q) ||
      (e.body || "").toLowerCase().includes(q)
    ).slice(0, 20);
    return { results, total: results.length };
  });

  app.post("/api/email/cache", { schema: { body: { type: "object", additionalProperties: true, properties: { emails: { type: "array" } } }, response: { 200: { type: "object", properties: { cached: { type: "number" } } } } } }, async (req) => {
    const { emails } = req.body || {};
    if (!Array.isArray(emails)) return { cached: 0 };
    const state = getEmailState();
    state.cachedEmails = [...emails, ...state.cachedEmails].slice(0, 500);
    saveEmailState(state);
    return { cached: emails.length };
  });
}
