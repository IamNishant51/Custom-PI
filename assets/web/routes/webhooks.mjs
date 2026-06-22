import path from "node:path";
import fs from "node:fs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;

export default function registerWebhooks(app, { sendError }) {
  app.post("/api/webhooks/:source", { schema: { body: { type: "object", additionalProperties: true }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, eventId: { type: "string" }, error: { type: "string" } } } } } }, async (req) => {
    try {
      const source = req.params.source;
      if (!source || typeof source !== "string" || source.length > 64) {
        return { error: "Invalid webhook source" };
      }
      const PAYLOAD_MAX_BYTES = 1024 * 1024;
      const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(raw, "utf8") > PAYLOAD_MAX_BYTES) {
        return { error: "Payload exceeds 1MB limit" };
      }
      const { normalizeEvent, validateSignature } = await import("../listener.js");
      const secret = process.env.WEBHOOK_SECRET;
      const sig = req.headers["x-webhook-signature"] || req.headers["x-hub-signature-256"] || "";
      if (secret && !validateSignature(req.body, sig, secret)) {
        return { error: "Invalid webhook signature" };
      }
      const event = normalizeEvent(source, req.body);
      const webhookDir = path.join(PI_DIR, "webhooks");
      fs.mkdirSync(webhookDir, { recursive: true });
      const filePath = path.join(webhookDir, `event_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`);
      fs.writeFileSync(filePath, JSON.stringify(event));
      return { ok: true, eventId: path.basename(filePath, ".json") };
    } catch (e) {
      return { error: "Failed to process webhook" };
    }
  });

  app.get("/api/webhooks/events", { schema: { response: { 200: { type: "object", properties: { events: { type: "array" } } } } } }, async () => {
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
