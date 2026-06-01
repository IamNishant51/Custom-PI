/**
 * Webhook Listener — receives events from Sentry, Datadog, CI pipelines, etc.
 * Usage: import { handleWebhookEvent } from "./listener.js";
 * Or run standalone: node listener.js (for testing)
 */
import crypto from "node:crypto";

export const WEBHOOK_SOURCES = ["sentry", "datadog", "github", "custom-ci", "custom"];

export function validateSignature(payload, signature, secret) {
  if (!secret) return true;
  const expected = crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function normalizeEvent(source, body) {
  const now = Date.now();
  switch (source) {
    case "sentry":
      return {
        source: "sentry",
        type: body.event?.type || "error",
        payload: body,
        receivedAt: now,
      };
    case "datadog":
      return {
        source: "datadog",
        type: body.alertType || body.type || "alert",
        payload: body,
        receivedAt: now,
      };
    case "github":
      return {
        source: "github",
        type: body.action || body.workflow_run?.status || "event",
        payload: body,
        receivedAt: now,
      };
    case "custom-ci":
      return {
        source: "custom-ci",
        type: body.status || "completed",
        payload: body,
        receivedAt: now,
      };
    default:
      return {
        source: source || "custom",
        type: "event",
        payload: body,
        receivedAt: now,
      };
  }
}
