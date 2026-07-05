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

  it("extracts milestones from multi-step plans", async () => {
    const plan = await decomposer.createPlan("Research. Design architecture. Implement core. Write tests. Deploy. Monitor.");
    expect(plan.milestones.length).toBeGreaterThanOrEqual(1);
    expect(plan.milestones.some(m => m.includes("Complete"))).toBe(true);
  });

  it("estimates time and resources for tasks", async () => {
    const plan = await decomposer.createPlan("Complex multi-step deployment pipeline with validation and rollback capabilities.");
    expect(plan.totalEstimatedTimeMs).toBeGreaterThan(0);
    for (const [, task] of plan.subTasks) {
      expect(task.estimatedTimeMs).toBeGreaterThan(0);
      expect(task.estimatedTokens).toBeGreaterThan(0);
      expect(task.estimatedToolCalls).toBeGreaterThan(0);
    }
  });

  it("identifies parallel execution groups", async () => {
    const plan = await decomposer.createPlan("Step one. Step two. Step three. Step four. Step five.");
    const groups = decomposer.getParallelGroups(plan.id);
    expect(Array.isArray(groups)).toBe(true);
  });

  it("computes critical path through dependency graph", async () => {
    const plan = await decomposer.createPlan("Init. Build backend. Build frontend. Integrate. Test. Deploy.");
    const criticalPath = decomposer.getCriticalPath(plan.id);
    expect(criticalPath.length).toBeGreaterThanOrEqual(1);
    const lastTask = criticalPath[criticalPath.length - 1];
    expect(lastTask).toBeDefined();
  });

  it("re-plans when a task fails with alternative approach", async () => {
    const plan = await decomposer.createPlan("Setup database. Configure API. Test endpoints.");
    const firstTask = Array.from(plan.subTasks.values())[0];
    decomposer.updateTaskStatus(plan.id, firstTask.id, "failed", undefined, "Connection timeout");
    const replacement = decomposer.rePlan(plan.id, firstTask.id, "Use a different database driver");
    expect(replacement).not.toBeNull();
    expect(replacement!.id).toContain("replan");
    const updatedPlan = decomposer.getPlan(plan.id);
    expect(updatedPlan!.subTasks.has(replacement!.id)).toBe(true);
  });

  it("marks tasks as failed and blocks dependents", async () => {
    const plan = await decomposer.createPlan("Phase Alpha initialization. Phase Beta configuration. Phase Gamma deployment.");
    const taskIds = Array.from(plan.subTasks.keys());
    plan.status = "executing";
    decomposer.updateTaskStatus(plan.id, taskIds[0], "failed", undefined, "Error in phase alpha");
    const failed = plan.subTasks.get(taskIds[0]);
    expect(failed).not.toBeNull();
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toBe("Error in phase alpha");
    const hasBlocked = Array.from(plan.subTasks.values()).some(t => t.status === "blocked");
    expect(hasBlocked).toBe(true);
  });

  it("reports progress summary", async () => {
    const plan = await decomposer.createPlan("Task A. Task B. Task C. Task D.");
    const initial = decomposer.getProgressSummary(plan.id);
    expect(initial.total).toBeGreaterThanOrEqual(1);
    expect(initial.percentComplete).toBe(0);

    const firstTask = Array.from(plan.subTasks.values())[0];
    decomposer.updateTaskStatus(plan.id, firstTask.id, "completed");
    const afterFirst = decomposer.getProgressSummary(plan.id);
    expect(afterFirst.completed).toBeGreaterThanOrEqual(1);
  });

  it("estimates time remaining during execution", async () => {
    const plan = await decomposer.createPlan("Short task list with a few items to estimate.");
    const timeRemaining = decomposer.getEstimatedTimeRemaining(plan.id);
    expect(timeRemaining).toBeGreaterThanOrEqual(0);
  });
});
