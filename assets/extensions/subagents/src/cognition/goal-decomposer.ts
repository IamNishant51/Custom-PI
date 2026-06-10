import { bus, Topics } from "../event-bus/event-bus";
import { getGraph } from "../state-graph/property-graph";
import { getDaemon } from "../daemon/daemon";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked" | "skipped";
export type TaskPriority = "critical" | "high" | "normal" | "low";
export type ThinkingStrategy = "cot" | "tot" | "react" | "reflexion" | "plan-execute" | "auto";

export interface SubTask {
  id: string;
  name: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimatedTokens: number;
  estimatedToolCalls: number;
  dependencies: string[];
  thinkingStrategy: ThinkingStrategy;
  assignedAgent?: string;
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AutonomousPlan {
  id: string;
  goal: string;
  context: string;
  subTasks: Map<string, SubTask>;
  dependencyGraph: Map<string, string[]>;
  status: "planning" | "executing" | "replanning" | "completed" | "failed";
  totalEstimatedTokens: number;
  totalEstimatedCalls: number;
  priority: TaskPriority;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

interface DecompositionResult {
  planId: string;
  subTasks: SubTask[];
  warnings: string[];
}

export class GoalDecomposer {
  private activePlans = new Map<string, AutonomousPlan>();
  private executionQueue: string[] = [];
  private isExecuting = false;

  decompose(goal: string, context?: string): Promise<DecompositionResult> {
    return this.llmDecompose(goal, context || "");
  }

  async createPlan(goal: string, context?: string): Promise<AutonomousPlan> {
    const decomposition = await this.decompose(goal, context);
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const subTaskMap = new Map<string, SubTask>();
    const depGraph = new Map<string, string[]>();
    let totalTokens = 0;
    let totalCalls = 0;

    for (const st of decomposition.subTasks) {
      subTaskMap.set(st.id, st);
      depGraph.set(st.id, st.dependencies);
      totalTokens += st.estimatedTokens;
      totalCalls += st.estimatedToolCalls;
    }

    const plan: AutonomousPlan = {
      id: planId,
      goal,
      context: context || "",
      subTasks: subTaskMap,
      dependencyGraph: depGraph,
      status: "planning",
      totalEstimatedTokens: totalTokens,
      totalEstimatedCalls: totalCalls,
      priority: this.inferPriority(goal),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.activePlans.set(planId, plan);
    this.persistPlan(plan);

    bus.emit(Topics.PLAN_CREATED, {
      planId,
      goal,
      subTaskCount: decomposition.subTasks.length,
      estimatedTokens: totalTokens,
    }, { source: "goal-decomposer" });

    return plan;
  }

  async executePlan(planId: string): Promise<void> {
    const plan = this.activePlans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    plan.status = "executing";
    plan.updatedAt = Date.now();
    bus.emit(Topics.PLAN_UPDATED, { planId, status: "executing" }, { source: "goal-decomposer" });

    this.executionQueue.push(planId);
    if (!this.isExecuting) {
      this.isExecuting = true;
      await this.processQueue();
    }
  }

  getPlan(planId: string): AutonomousPlan | undefined {
    return this.activePlans.get(planId);
  }

  getAllPlans(): AutonomousPlan[] {
    return Array.from(this.activePlans.values());
  }

  getReadyTasks(planId: string): SubTask[] {
    const plan = this.activePlans.get(planId);
    if (!plan) return [];
    return Array.from(plan.subTasks.values()).filter(st =>
      st.status === "pending" &&
      st.dependencies.every(depId => {
        const dep = plan.subTasks.get(depId);
        return dep && dep.status === "completed";
      })
    );
  }

  updateTaskStatus(planId: string, taskId: string, status: TaskStatus, result?: string, error?: string): void {
    const plan = this.activePlans.get(planId);
    if (!plan) return;
    const task = plan.subTasks.get(taskId);
    if (!task) return;
    task.status = status;
    task.updatedAt = Date.now();
    if (result) task.result = result;
    if (error) task.error = error;
    plan.updatedAt = Date.now();

    bus.emit(Topics.PLAN_UPDATED, { planId, taskId, status }, { source: "goal-decomposer" });

    if (this.allTasksCompleted(plan)) {
      plan.status = "completed";
      plan.completedAt = Date.now();
      plan.updatedAt = Date.now();
      bus.emit(Topics.PLAN_COMPLETED, {
        planId,
        goal: plan.goal,
        totalTasks: plan.subTasks.size,
        duration: plan.completedAt - plan.createdAt,
      }, { source: "goal-decomposer" });
    }
  }

  private async processQueue(): Promise<void> {
    while (this.executionQueue.length > 0) {
      const planId = this.executionQueue[0];
      const plan = this.activePlans.get(planId);
      if (!plan) {
        this.executionQueue.shift();
        continue;
      }

      const readyTasks = this.getReadyTasks(planId);
      if (readyTasks.length === 0) {
        if (plan.status === "completed" || plan.status === "failed") {
          this.executionQueue.shift();
          continue;
        }
        const anyInProgress = Array.from(plan.subTasks.values()).some(t => t.status === "in_progress");
        if (!anyInProgress) {
          const failed = Array.from(plan.subTasks.values()).some(t => t.status === "failed");
          if (failed) {
            plan.status = "failed";
            bus.emit(Topics.PLAN_UPDATED, { planId, status: "failed" }, { source: "goal-decomposer" });
          }
        }
        await this.sleep(1000);
        continue;
      }

      for (const task of readyTasks) {
        task.status = "in_progress";
        task.updatedAt = Date.now();
        bus.emit(Topics.PLAN_UPDATED, { planId, taskId: task.id, status: "in_progress" }, { source: "goal-decomposer" });
      }
    }
    this.isExecuting = false;
  }

  private async llmDecompose(goal: string, context: string): Promise<DecompositionResult> {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tokens = Math.ceil(goal.length / 4);
    const subTasks: SubTask[] = [];
    const warnings: string[] = [];

    const steps = this.extractSteps(goal);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const taskId = `${planId}_task_${i}`;
      const dependencies = i > 0 ? [`${planId}_task_${i - 1}`] : [];
      const isComplex = step.length > 100;
      subTasks.push({
        id: taskId,
        name: `Step ${i + 1}: ${step.slice(0, 60)}`,
        description: step,
        status: "pending",
        priority: i === 0 ? "high" : "normal",
        estimatedTokens: isComplex ? tokens * 2 : tokens,
        estimatedToolCalls: isComplex ? 5 : 2,
        dependencies,
        thinkingStrategy: isComplex ? "cot" : "auto",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    if (subTasks.length === 0) {
      subTasks.push({
        id: `${planId}_task_0`,
        name: "Process goal",
        description: goal,
        status: "pending",
        priority: "high",
        estimatedTokens: tokens,
        estimatedToolCalls: 3,
        dependencies: [],
        thinkingStrategy: "cot",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      warnings.push("Goal was not decomposable — using single task fallback");
    }

    return { planId, subTasks, warnings };
  }

  private extractSteps(goal: string): string[] {
    const lines = goal.split(/[.!?\n]+/).filter(l => l.trim().length > 10);
    if (lines.length >= 2) return lines.map(l => l.trim());

    const keywords = ["first", "then", "next", "finally", "step", "phase", "stage", "1.", "2.", "3.", "- "];
    for (const kw of keywords) {
      const parts = goal.split(new RegExp(`\\b${kw}\\b`, "i")).filter(p => p.trim().length > 5);
      if (parts.length >= 2) return parts.map(p => p.trim());
    }

    return [goal];
  }

  private inferPriority(goal: string): TaskPriority {
    const critical = /critical|urgent|security|crash|data.?loss|immediately/i;
    const high = /deploy|release|production|deadline|blocker|important/i;
    if (critical.test(goal)) return "critical";
    if (high.test(goal)) return "high";
    return "normal";
  }

  private allTasksCompleted(plan: AutonomousPlan): boolean {
    return Array.from(plan.subTasks.values()).every(t => t.status === "completed" || t.status === "skipped");
  }

  private persistPlan(plan: AutonomousPlan): void {
    try {
      const graph = getGraph();
      const planNodeId = graph.addNode("plan", plan.goal.slice(0, 200), {
        planId: plan.id,
        status: plan.status,
        taskCount: plan.subTasks.size,
        estimatedTokens: plan.totalEstimatedTokens,
        priority: plan.priority,
      });
      for (const [taskId, task] of plan.subTasks) {
        const taskNodeId = graph.addNode("task", task.name, {
          taskId: task.id,
          status: task.status,
          priority: task.priority,
          strategy: task.thinkingStrategy,
        });
        graph.addEdge(planNodeId, taskNodeId, "contains");
        for (const depId of task.dependencies) {
          const depTask = plan.subTasks.get(depId);
          if (depTask) {
            const depNodeId = graph.addNode("task", depTask.name, { taskId: depId });
            graph.addEdge(depNodeId, taskNodeId, "precedes");
          }
        }
      }
    } catch {}
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

export const goalDecomposer = new GoalDecomposer();
