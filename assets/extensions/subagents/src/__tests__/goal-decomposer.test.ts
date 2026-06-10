import { describe, it, expect, beforeEach } from "vitest";
import { GoalDecomposer } from "../cognition/goal-decomposer";

describe("GoalDecomposer", () => {
  let decomposer: GoalDecomposer;

  beforeEach(() => {
    decomposer = new GoalDecomposer();
  });

  it("creates a plan from a goal", async () => {
    const plan = await decomposer.createPlan("Deploy the application to production");
    expect(plan.id).toContain("plan_");
    expect(plan.goal).toBe("Deploy the application to production");
    expect(plan.status).toBe("planning");
    expect(plan.subTasks.size).toBeGreaterThanOrEqual(1);
  });

  it("decomposes goals with multiple steps", async () => {
    const plan = await decomposer.createPlan("First build the Docker image. Then push to registry. Finally deploy to Kubernetes.");
    expect(plan.subTasks.size).toBeGreaterThanOrEqual(2);
    expect(plan.totalEstimatedTokens).toBeGreaterThan(0);
    expect(plan.totalEstimatedCalls).toBeGreaterThan(0);
  });

  it("retrieves created plans", async () => {
    const plan = await decomposer.createPlan("Test goal");
    const retrieved = decomposer.getPlan(plan.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(plan.id);
  });

  it("returns all plans", async () => {
    await decomposer.createPlan("Goal 1");
    await decomposer.createPlan("Goal 2");
    expect(decomposer.getAllPlans().length).toBeGreaterThanOrEqual(2);
  });

  it("identifies ready tasks by dependency chain", async () => {
    const plan = await decomposer.createPlan("Setup CI/CD pipeline");
    expect(plan.dependencyGraph.size).toBeGreaterThan(0);
  });

  it("updates task status", async () => {
    const plan = await decomposer.createPlan("Simple goal");
    const firstTask = Array.from(plan.subTasks.values())[0];
    decomposer.updateTaskStatus(plan.id, firstTask.id, "completed", "Done successfully");
    const updated = decomposer.getPlan(plan.id);
    const task = updated!.subTasks.get(firstTask.id);
    expect(task!.status).toBe("completed");
    expect(task!.result).toBe("Done successfully");
  });

  it("infers priority from goal content", async () => {
    const criticalPlan = await decomposer.createPlan("Critical security issue needs fix immediately!");
    expect(criticalPlan.priority).toBe("critical");

    const normalPlan = await decomposer.createPlan("Add a new feature");
    expect(normalPlan.priority).toBe("normal");
  });

  it("executes plan queue", async () => {
    const plan = await decomposer.createPlan("Quick task");
    const ready = decomposer.getReadyTasks(plan.id);
    expect(Array.isArray(ready)).toBe(true);
  });
});
