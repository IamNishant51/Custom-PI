import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const PI_DIR = path.join(os.homedir(), ".pi", "agent");
const PLANS_FILE = path.join(PI_DIR, "plans.json");

export function loadPlans() {
  try { return JSON.parse(fs.readFileSync(PLANS_FILE, "utf8")); }
  catch { return []; }
}

export function savePlans(plans) {
  fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));
}

export function createPlan(name, goal, steps) {
  const plans = loadPlans();
  const plan = {
    id: `plan_${Date.now()}`,
    name,
    goal,
    steps: steps.map((s, i) => ({
      id: `step_${i + 1}`,
      description: s,
      status: "pending",
      completedAt: null,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "active",
  };
  plans.push(plan);
  savePlans(plans);
  return plan;
}
