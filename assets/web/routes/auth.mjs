import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { getOrCreateDb } from "../services/db.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;

export default function registerAuth(app, { sendError }) {
  const TOKENS_FILE = path.join(PI_DIR, "api-tokens.json");
  function loadTokens() {
    try { return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); } catch { return []; }
  }
  function saveTokens(tokens) { fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2)); }

  const WEB_PASSWORD = process.env.WEB_PASSWORD || process.env.CUSTOM_PI_WEB_KEY || "";
  function timingSafeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  app.post("/api/auth/login", { schema: { body: { type: "object", additionalProperties: true, properties: { password: { type: "string" } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } } } }, async (req, reply) => {
    const { password } = req.body || {};
    if (!WEB_PASSWORD) return reply.code(500).send({ error: "No password configured. Set WEB_PASSWORD env var." });
    if (!password || !timingSafeEqual(password, WEB_PASSWORD)) return reply.code(401).send({ error: "Invalid password" });
    return { success: true };
  });

  app.get("/api/auth/tokens", { schema: { response: { 200: { type: "object", properties: { tokens: { type: "array", items: { type: "object" } } } } } }, async () => ({ tokens: loadTokens().map(t => ({ ...t, key: t.key.slice(0, 8) + "..." })) }));
  app.post("/api/auth/tokens", { schema: { body: { type: "object", additionalProperties: true, properties: { name: { type: "string" }, role: { type: "string" } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" }, token: { type: "string" }, id: { type: "string" }, error: { type: "string" } } } } } }, async (req) => {
    const { name, role } = req.body || {};
    if (!name) return { error: "name required" };
    const tokens = loadTokens();
    const key = "pi_" + crypto.randomBytes(24).toString("hex");
    tokens.push({ id: `tok_${Date.now()}`, name, key, role: role || "user", createdAt: Date.now(), lastUsed: null });
    saveTokens(tokens);
    return { success: true, token: key, id: `tok_${Date.now()}` };
  });
  app.delete("/api/auth/tokens/:id", { schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" } } } } } }, async (req) => {
    saveTokens(loadTokens().filter(t => t.id !== req.params.id));
    return { success: true };
  });

  app.get("/api/companion/status", { schema: { response: { 200: { type: "object", properties: { enabled: { type: "boolean" }, autoConnect: { type: "boolean" }, deviceName: { type: "string" } } } } } }, async () => {
    const companionDir = path.join(PI_DIR, "companion");
    try {
      if (!fs.existsSync(companionDir)) return { enabled: false };
      const config = JSON.parse(fs.readFileSync(path.join(companionDir, "config.json"), "utf8"));
      return { enabled: config.enabled !== false, autoConnect: !!config.autoConnect, deviceName: config.deviceName || "Unknown" };
    } catch { return { enabled: false }; }
  });

  app.post("/api/companion/config", { schema: { body: { type: "object", additionalProperties: true }, response: { 200: { type: "object", properties: { success: { type: "boolean" } } } } } }, async (req) => {
    const companionDir = path.join(PI_DIR, "companion");
    fs.mkdirSync(companionDir, { recursive: true });
    fs.writeFileSync(path.join(companionDir, "config.json"), JSON.stringify(req.body || {}, null, 2));
    return { success: true };
  });

  const SESSIONS_FILE = path.join(PI_DIR, "sessions.json");
  function loadSessions() {
    try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")); } catch { return []; }
  }
  function saveSessions(sessions) { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2)); }

  app.get("/api/auth/sessions", { schema: { response: { 200: { type: "object", properties: { sessions: { type: "array", items: { type: "object" } } } } } }, async () => {
    const active = loadSessions().filter(s => s.expiresAt > Date.now());
    return { sessions: active.map(s => ({ id: s.id, device: s.device || "Unknown", createdAt: s.createdAt, expiresAt: s.expiresAt })) };
  });
  app.delete("/api/auth/sessions/:id", { schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" } } } } } }, async (req) => {
    saveSessions(loadSessions().filter(s => s.id !== req.params.id));
    return { success: true };
  });
  app.delete("/api/auth/sessions", { schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" } } } } } }, async () => {
    saveSessions([]);
    return { success: true };
  });
}
