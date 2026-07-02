import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { SHARED_PATHS } from "../shared-constants.mjs";
import { getOrCreateDb } from "../services/db.mjs";
import { normalizeEvent, validateSignature } from "../listener.js";

const { PI_DIR } = SHARED_PATHS;
const WEBHOOK_DB_PATH = path.join(PI_DIR, "webhooks.db");

function initWebhookDb() {
  const db = getOrCreateDb(WEBHOOK_DB_PATH);
  if (db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        delivery_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_source ON webhook_events(source);
      CREATE INDEX IF NOT EXISTS idx_webhook_received ON webhook_events(received_at);
    `);
  }
  return db;
}

// In-memory dedup set when SQLite is unavailable
const recentDeliveries = new Set();

export default function registerWebhooks(app, { sendError }) {
  const db = initWebhookDb();

  app.post("/api/webhooks/:source", { schema: { body: { type: "object", additionalProperties: true }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, eventId: { type: "string" }, error: { type: "string" }, duplicate: { type: "boolean" } } } } } }, async (req, reply) => {
    try {
      const source = req.params.source;
      if (!source || typeof source !== "string" || source.length > 64) {
        return sendError(reply, 400, "Invalid webhook source");
      }
      const PAYLOAD_MAX_BYTES = 1024 * 1024;
      const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(raw, "utf8") > PAYLOAD_MAX_BYTES) {
        return sendError(reply, 413, "Payload exceeds 1MB limit");
      }
      const secret = process.env.WEBHOOK_SECRET;
      const sig = req.headers["x-webhook-signature"] || req.headers["x-hub-signature-256"] || "";
      if (secret && !validateSignature(req.body, sig, secret)) {
        return sendError(reply, 401, "Invalid webhook signature");
      }

      // Extract delivery ID for deduplication (Sentry, GitHub, Datadog all send unique IDs)
      const deliveryId = req.headers["sentry-hook-resource"]?.replace("event:", "")
        || req.headers["x-github-delivery"]
        || req.headers["x-datadog-webhook-id"]
        || req.headers["x-webhook-delivery-id"]
        || crypto.randomUUID(); // fallback

      const event = normalizeEvent(source, req.body);

      // Deduplicate via SQLite (or in-memory fallback)
      if (db) {
        const existing = db.prepare("SELECT delivery_id FROM webhook_events WHERE delivery_id = ?").get(deliveryId);
        if (existing) {
          return { ok: true, eventId: deliveryId, duplicate: true };
        }
        db.prepare(`
          INSERT INTO webhook_events (delivery_id, source, event_type, payload, received_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(deliveryId, source, event.type, JSON.stringify(event), event.receivedAt);
      } else {
        if (recentDeliveries.has(deliveryId)) {
          return { ok: true, eventId: deliveryId, duplicate: true };
        }
        recentDeliveries.add(deliveryId);
        if (recentDeliveries.size > 1000) {
          const first = recentDeliveries.values().next().value;
          if (first) recentDeliveries.delete(first);
        }
      }

      // Also write to file for backward compatibility / debugging
      const webhookDir = path.join(PI_DIR, "webhooks");
      fs.mkdirSync(webhookDir, { recursive: true });
      const filePath = path.join(webhookDir, `event_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`);
      fs.writeFileSync(filePath, JSON.stringify(event));

      return { ok: true, eventId: deliveryId, duplicate: false };
    } catch (e) {
      return sendError(reply, 500, "Failed to process webhook");
    }
  });

  app.get("/api/webhooks/events", { schema: { response: { 200: { type: "object", properties: { events: { type: "array", items: { type: "object" } } } } } } }, async () => {
    if (db) {
      const rows = db.prepare(`
        SELECT delivery_id as id, source, event_type, payload, received_at
        FROM webhook_events
        ORDER BY received_at DESC
        LIMIT 50
      `).all();
      return { events: rows.map(r => ({ ...JSON.parse(r.payload), _deliveryId: r.id, _source: r.source, _receivedAt: r.received_at })) };
    }
    // Fallback to file-based
    const webhookDir = path.join(PI_DIR, "webhooks");
    try {
      if (!fs.existsSync(webhookDir)) return { events: [] };
      const files = fs.readdirSync(webhookDir).sort().reverse().slice(0, 50);
      const events = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(webhookDir, f), "utf8")); }
        catch { return null; }
      }).filter(Boolean);
      return { events };
    } catch { return { events: [] }; }
  });
}
