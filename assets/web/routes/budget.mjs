import path from "node:path";
import fs from "node:fs";
import { getBudgetConfig, setBudgetConfig, getCostSummary, getCostDetails, getForecast } from "../services/cost-tracker.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;

export default function registerBudget(app, { sendError }) {
  app.get("/api/budget/config", async () => getBudgetConfig());
  app.post("/api/budget/config", async (req) => {
    if (!req.body || typeof req.body !== "object") return { ok: false, error: "Request body is required" };
    setBudgetConfig(req.body);
    return { ok: true };
  });
  app.get("/api/budget/stats", {
    schema: { response: { 200: { type: "object", properties: { totalSessions: { type: "number" }, totalTokens: { type: "number" }, totalCostUsd: { type: "number" }, dailyTokens: { type: "number" }, dailyCostUsd: { type: "number" }, today: { type: "string" } } } } },
  }, async () => getCostSummary());
  app.get("/api/budget/details", async () => getCostDetails());
  app.get("/api/budget/forecast", async () => getForecast());

  app.get("/api/telemetry", async () => {
    const p = path.join(PI_DIR, "telemetry.json");
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      }
    } catch {}
    return { status: "no_data", timestamp: Date.now() };
  });
}
