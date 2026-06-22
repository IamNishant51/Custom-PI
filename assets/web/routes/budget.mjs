import path from "node:path";
import fs from "node:fs";
import { getBudgetConfig, setBudgetConfig, getCostSummary, getCostDetails, getForecast } from "../services/cost-tracker.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;

export default function registerBudget(app, { sendError }) {
  app.get("/api/budget/config", { schema: { response: { 200: { type: "object", additionalProperties: true } } } }, async () => getBudgetConfig());
  app.post("/api/budget/config", { schema: { body: { type: "object", additionalProperties: true }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } } }, async (req) => {
    if (!req.body || typeof req.body !== "object") return { ok: false, error: "Request body is required" };
    setBudgetConfig(req.body);
    return { ok: true };
  });
  app.get("/api/budget/stats", {
    schema: { response: { 200: { type: "object", properties: { totalSessions: { type: "number" }, totalTokens: { type: "number" }, totalCostUsd: { type: "number" }, dailyTokens: { type: "number" }, dailyCostUsd: { type: "number" }, today: { type: "string" } } } } },
  }, async () => getCostSummary());
  app.get("/api/budget/details", { schema: { response: { 200: { type: "object", additionalProperties: true } } } }, async () => getCostDetails());
  app.get("/api/budget/forecast", { schema: { response: { 200: { type: "object", properties: { dailyAvgCost: { type: "number" }, dailyAvgTokens: { type: "number" }, projectedMonthlyCost: { type: "number" }, projectedMonthlyTokens: { type: "number" }, daysOfData: { type: "number" }, trend: { type: "string" }, recentDailyAvg: { type: "number" }, olderDailyAvg: { type: "number" }, alert: { type: "object", nullable: true } } } } } }, async () => getForecast());

  app.get("/api/telemetry", { schema: { response: { 200: { type: "object", properties: { status: { type: "string" }, timestamp: { type: "number" } } } } } }, async () => {
    const p = path.join(PI_DIR, "telemetry.json");
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      }
    } catch {} // Ignored
    return { status: "no_data", timestamp: Date.now() };
  });
}
