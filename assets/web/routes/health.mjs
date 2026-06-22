import path from "node:path";
import fs from "node:fs";
import { getOrCreateDb } from "../services/db.mjs";
import { rateLimiters } from "../lib/rate-limiter.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;
const STATE_DB_PATH = path.join(PI_DIR, "session-state.db");

export default function registerHealth(app, { sendError }) {
  app.get("/api/health/services", { schema: { response: { 200: { type: "object", properties: { services: { type: "array", items: { type: "object" } } } } } }, async () => {
    try {
      const db = getOrCreateDb(STATE_DB_PATH);
      if (!db) return { services: [] };
      const rows = db.prepare("SELECT service_name, endpoint, status, latency_ms, jitter_ms, consecutive_failures, updated_at FROM service_health ORDER BY status").all();
      return { services: rows };
    } catch { return { services: [] }; }
  });

  app.get("/api/health/endpoints", { schema: { response: { 200: { type: "object", properties: { endpoints: { type: "array", items: { type: "object" } } } } } }, async () => {
    const endpoints = [
      { name: "llm-anthropic", url: "https://api.anthropic.com/v1/health", method: "GET" },
      { name: "llm-openai", url: "https://api.openai.com/v1/health", method: "GET" },
      { name: "github-api", url: "https://api.github.com", method: "GET" },
    ];
    return { endpoints };
  });

  const PIPELINE_FILE = path.join(PI_DIR, "pipeline-state.json");
  function readPipeline() {
    try { return JSON.parse(fs.readFileSync(PIPELINE_FILE, "utf8")); }
    catch { return { deployments: [], current: null }; }
  }
  function writePipeline(data) {
    fs.mkdirSync(path.dirname(PIPELINE_FILE), { recursive: true });
    fs.writeFileSync(PIPELINE_FILE, JSON.stringify(data, null, 2));
  }

  app.post("/api/pipeline/deploy", { schema: { body: { type: "object", additionalProperties: true, properties: { branch: { type: "string" }, target: { type: "string" }, stableSha: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, deploy: { type: "object" }, error: { type: "string" } } } } } }, async (req) => {
    try {
      const { branch, target, stableSha } = req.body || {};
      const data = readPipeline();
      const id = `deploy_${Date.now()}`;
      const deploy = {
        id, branch: branch || "main", target: target || "staging",
        sha: stableSha || "", status: "pending", createdAt: new Date().toISOString(),
        triggeredBy: "web-ui",
      };
      data.deployments.push(deploy);
      writePipeline(data);
      return { ok: true, deploy };
    } catch (e) { return { error: e.message }; }
  });

  app.get("/api/pipeline/status", { schema: { response: { 200: { type: "object", properties: { current: { type: "object", nullable: true }, history: { type: "array", items: { type: "object" } } } } } }, async () => {
    const data = readPipeline();
    return { current: data.current, history: data.deployments.slice(-20) };
  });

  app.get("/api/system/resources", { schema: { response: { 200: { type: "object", additionalProperties: true, properties: { cpuCount: { type: "number" }, cpuModel: { type: "string" }, memoryTotal: { type: "number" }, memoryFree: { type: "number" }, uptime: { type: "number" }, hostname: { type: "string" }, platform: { type: "string" }, arch: { type: "string" }, nodeVersion: { type: "string" }, error: { type: "string" } } } } } }, async () => {
    try {
      const os = await import("node:os");
      const cpus = os.cpus();
      return {
        cpuCount: cpus.length,
        cpuModel: cpus[0]?.model || "unknown",
        cpuUsage: process.cpuUsage(),
        memoryTotal: os.totalmem(),
        memoryFree: os.freemem(),
        memoryUsage: process.memoryUsage(),
        uptime: os.uptime(),
        loadAvg: os.loadavg(),
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
      };
    } catch (e) { return { error: e.message }; }
  });

  app.get("/api/system/rate-limits", { schema: { response: { 200: { type: "object", properties: { limits: { type: "array", items: { type: "object" } } } } } }, async () => {
    const limits = [];
    for (const [name, bucket] of Object.entries(rateLimiters)) {
      limits.push({
        name,
        capacity: bucket.capacity,
        tokens: bucket.tokens,
        lastRefill: bucket.lastRefill,
        breached: bucket.tokens <= 0,
      });
    }
    return { limits };
  });
}
