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

  app.get("/api/auth/tokens", async () => ({ tokens: loadTokens().map(t => ({ ...t, key: t.key.slice(0, 8) + "..." })) }));
  app.post("/api/auth/tokens", async (req) => {
    const { name, role } = req.body || {};
    if (!name) return { error: "name required" };
    const tokens = loadTokens();
    const key = "pi_" + crypto.randomBytes(24).toString("hex");
    tokens.push({ id: `tok_${Date.now()}`, name, key, role: role || "user", createdAt: Date.now(), lastUsed: null });
    saveTokens(tokens);
    return { success: true, token: key, id: `tok_${Date.now()}` };
  });
  app.delete("/api/auth/tokens/:id", async (req) => {
    saveTokens(loadTokens().filter(t => t.id !== req.params.id));
    return { success: true };
  });

  app.get("/api/companion/status", async () => {
    const companionDir = path.join(PI_DIR, "companion");
    try {
      if (!fs.existsSync(companionDir)) return { enabled: false };
      const config = JSON.parse(fs.readFileSync(path.join(companionDir, "config.json"), "utf8"));
      return { enabled: config.enabled !== false, autoConnect: !!config.autoConnect, deviceName: config.deviceName || "Unknown" };
    } catch { return { enabled: false }; }
  });

  app.post("/api/companion/config", async (req) => {
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

  app.get("/api/auth/sessions", async () => {
    const active = loadSessions().filter(s => s.expiresAt > Date.now());
    return { sessions: active.map(s => ({ id: s.id, device: s.device || "Unknown", createdAt: s.createdAt, expiresAt: s.expiresAt })) };
  });
  app.delete("/api/auth/sessions/:id", async (req) => {
    saveSessions(loadSessions().filter(s => s.id !== req.params.id));
    return { success: true };
  });
  app.delete("/api/auth/sessions", async () => {
    saveSessions([]);
    return { success: true };
  });
}
