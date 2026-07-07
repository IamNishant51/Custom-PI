import { logger } from "../logger";
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
  estimatedTimeMs: number;
  dependencies: string[];
  parallelGroup?: string;
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
  totalEstimatedTimeMs: number;
  priority: TaskPriority;
  milestones: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

interface DecompositionResult {
  planId: string;
  subTasks: SubTask[];
  warnings: string[];
}

interface ParallelGroup {
  groupId: string;
  taskIds: string[];
  description: string;
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
    let totalTimeMs = 0;

    for (const st of decomposition.subTasks) {
      subTaskMap.set(st.id, st);
      depGraph.set(st.id, st.dependencies);
      totalTokens += st.estimatedTokens;
      totalCalls += st.estimatedToolCalls;
      totalTimeMs += st.estimatedTimeMs || 0;
    }

    const resolvedOrder = this.topologicalSort(depGraph);
    const parallelGroups = this.identifyParallelGroups(subTaskMap, depGraph);
    for (const group of parallelGroups) {
      for (const taskId of group.taskIds) {
        const task = subTaskMap.get(taskId);
        if (task) task.parallelGroup = group.groupId;
      }
    }

    const milestones = this.extractMilestones(subTaskMap, resolvedOrder);

    const plan: AutonomousPlan = {
      id: planId,
      goal,
      context: context || "",
      subTasks: subTaskMap,
      dependencyGraph: depGraph,
      status: "planning",
      totalEstimatedTokens: totalTokens,
      totalEstimatedCalls: totalCalls,
      totalEstimatedTimeMs: totalTimeMs,
      priority: this.inferPriority(goal),
      milestones,
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
      parallelGroups: parallelGroups.length,
      milestoneCount: milestones.length,
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

  getParallelGroups(planId: string): ParallelGroup[] {
    const plan = this.activePlans.get(planId);
    if (!plan) return [];
    const groups = new Map<string, ParallelGroup>();
    for (const [, task] of plan.subTasks) {
      if (task.parallelGroup) {
        if (!groups.has(task.parallelGroup)) {
          groups.set(task.parallelGroup, {
            groupId: task.parallelGroup,
            taskIds: [],
            description: `Parallel group: ${task.parallelGroup}`,
          });
        }
        groups.get(task.parallelGroup)!.taskIds.push(task.id);
      }
    }
    return Array.from(groups.values());
  }

  getCriticalPath(planId: string): SubTask[] {
    const plan = this.activePlans.get(planId);
    if (!plan) return [];
    const sorted = this.topologicalSort(plan.dependencyGraph);
    const estTime = new Map<string, number>();
    let maxTime = 0;
    let criticalEnd = "";

    for (const taskId of sorted) {
      const task = plan.subTasks.get(taskId);
      if (!task) continue;
      const depTimes = task.dependencies.map(d => estTime.get(d) || 0);
      const earliestStart = depTimes.length > 0 ? Math.max(...depTimes) : 0;
      const finishTime = earliestStart + (task.estimatedTimeMs || 1000);
      estTime.set(taskId, finishTime);
      if (finishTime > maxTime) {
        maxTime = finishTime;
        criticalEnd = taskId;
      }
    }

    const critical: SubTask[] = [];
    let current = criticalEnd;
    while (current) {
      const task = plan.subTasks.get(current);
      if (!task) break;
      critical.unshift(task);
      const predecessors = task.dependencies.filter(d => {
        const depTime = estTime.get(d) || 0;
        const curTime = estTime.get(current) || 0;
        const depTask = plan.subTasks.get(d);
        return depTask && (curTime - (depTime + (depTask.estimatedTimeMs || 1000))) < 100;
      });
      current = predecessors.length > 0 ? predecessors[0] : "";
    }

    return critical;
  }

  updateTaskStatus(planId: string, taskId: string, status: TaskStatus, result?: string, error?: string): void {
    const plan = this.activePlans.get(planId);
    if (!plan) return;
    const task = plan.subTasks.get(taskId);
    if (!task) return;

    const oldStatus = task.status;
    task.status = status;
    task.updatedAt = Date.now();
    if (result) task.result = result;
    if (error) task.error = error;
    plan.updatedAt = Date.now();

    if (status === "failed" && plan.status === "executing") {
      this.handleTaskFailure(plan, task);
    }

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

  rePlan(planId: string, failedTaskId: string, alternativeApproach: string): SubTask | null {
    const plan = this.activePlans.get(planId);
    if (!plan) return null;

    const failed = plan.subTasks.get(failedTaskId);
    if (!failed) return null;

    plan.status = "replanning";
    plan.updatedAt = Date.now();

    const replacementId = `${failedTaskId}_replan_${Date.now()}`;
    const replacement: SubTask = {
      id: replacementId,
      name: `${failed.name} (replanned)`,
      description: alternativeApproach,
      status: "pending",
      priority: failed.priority,
      estimatedTokens: Math.ceil(failed.estimatedTokens * 1.2),
      estimatedToolCalls: Math.ceil(failed.estimatedToolCalls * 1.2),
      estimatedTimeMs: Math.ceil((failed.estimatedTimeMs || 10000) * 1.2),
      dependencies: failed.dependencies,
      thinkingStrategy: "cot",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    plan.subTasks.delete(failedTaskId);
    plan.subTasks.set(replacementId, replacement);
    plan.dependencyGraph.delete(failedTaskId);
    plan.dependencyGraph.set(replacementId, replacement.dependencies);

    for (const [, task] of plan.subTasks) {
      const depIdx = task.dependencies.indexOf(failedTaskId);
      if (depIdx !== -1) {
        task.dependencies[depIdx] = replacementId;
        plan.dependencyGraph.set(task.id, task.dependencies);
      }
    }

    plan.status = "executing";
    plan.updatedAt = Date.now();

    bus.emit(Topics.PLAN_UPDATED, {
      planId,
      action: "replanned",
      failedTask: failedTaskId,
      replacement: replacementId,
    }, { source: "goal-decomposer" });

    return replacement;
  }

  getEstimatedTimeRemaining(planId: string): number {
    const plan = this.activePlans.get(planId);
    if (!plan) return 0;

    const completed = Array.from(plan.subTasks.values())
      .filter(t => t.status === "completed" || t.status === "skipped");
    const completedTime = completed.reduce((s, t) => s + (t.estimatedTimeMs || 0), 0);
    const totalTime = plan.totalEstimatedTimeMs || 1;

    const progress = totalTime > 0 ? completedTime / totalTime : 0;
    const elapsed = Date.now() - plan.createdAt;
    if (progress > 0) return Math.round(elapsed / progress - elapsed);
    return totalTime;
  }

  getProgressSummary(planId: string): { total: number; completed: number; failed: number; inProgress: number; blocked: number; percentComplete: number } {
    const plan = this.activePlans.get(planId);
    if (!plan) return { total: 0, completed: 0, failed: 0, inProgress: 0, blocked: 0, percentComplete: 0 };

    const tasks = Array.from(plan.subTasks.values());
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === "completed" || t.status === "skipped").length;
    const failed = tasks.filter(t => t.status === "failed").length;
    const inProgress = tasks.filter(t => t.status === "in_progress").length;
    const blocked = tasks.filter(t => t.status === "blocked").length;

    return {
      total, completed, failed, inProgress, blocked,
      percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  private topologicalSort(depGraph: Map<string, string[]>): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      if (visiting.has(nodeId)) return;
      visiting.add(nodeId);
      const deps = depGraph.get(nodeId) || [];
      for (const dep of deps) {
        if (depGraph.has(dep)) visit(dep);
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      sorted.push(nodeId);
    };

    for (const nodeId of depGraph.keys()) {
      if (!visited.has(nodeId)) visit(nodeId);
    }

    return sorted;
  }

  private identifyParallelGroups(tasks: Map<string, SubTask>, depGraph: Map<string, string[]>): ParallelGroup[] {
    const groups: ParallelGroup[] = [];
    const assigned = new Set<string>();

    const sorted = this.topologicalSort(depGraph);
    const depthMap = new Map<string, number>();

    for (const taskId of sorted) {
      const task = tasks.get(taskId);
      if (!task) continue;
      const depDepths = task.dependencies.map(d => depthMap.get(d) || 0);
      const depth = depDepths.length > 0 ? Math.max(...depDepths) + 1 : 0;
      depthMap.set(taskId, depth);
    }

    const maxDepth = Math.max(...Array.from(depthMap.values()), 0);
    for (let d = 0; d <= maxDepth; d++) {
      const atDepth = Array.from(depthMap.entries())
        .filter(([id, depth]) => depth === d && !assigned.has(id))
        .map(([id]) => id);

      if (atDepth.length > 1) {
        const groupId = `parallel_depth_${d}`;
        groups.push({
          groupId,
          taskIds: atDepth,
          description: `Parallel tasks at dependency depth ${d}`,
        });
        atDepth.forEach(id => assigned.add(id));
      }
    }

    return groups;
  }

  private extractMilestones(tasks: Map<string, SubTask>, sortedOrder: string[]): string[] {
    const milestones: string[] = [];
    const taskCount = tasks.size;

    if (taskCount <= 3) {
      const last = sortedOrder[sortedOrder.length - 1];
      const lastTask = last ? tasks.get(last) : undefined;
      if (lastTask) milestones.push(`Complete: ${lastTask.name}`);
      return milestones;
    }

    const quarterPoints = [0.25, 0.5, 0.75];
    for (const q of quarterPoints) {
      const idx = Math.floor(taskCount * q);
      const taskId = sortedOrder[Math.min(idx, sortedOrder.length - 1)];
      const task = taskId ? tasks.get(taskId) : undefined;
      if (task) {
        milestones.push(`${Math.round(q * 100)}%: ${task.name}`);
      }
    }

    const last = sortedOrder[sortedOrder.length - 1];
    const lastTask = last ? tasks.get(last) : undefined;
    if (lastTask) milestones.push(`Complete: ${lastTask.name}`);

    return milestones;
  }

  private handleTaskFailure(plan: AutonomousPlan, failedTask: SubTask): void {
    const dependents = Array.from(plan.subTasks.values())
      .filter(t => t.dependencies.includes(failedTask.id));
    for (const dep of dependents) {
      dep.status = "blocked";
      dep.updatedAt = Date.now();
    }

    bus.emit(Topics.SYSTEM_WARNING, {
      source: "goal-decomposer",
      planId: plan.id,
      failedTask: failedTask.id,
      message: `Task "${failedTask.name}" failed. ${dependents.length} dependent tasks blocked.`,
    }, { source: "goal-decomposer" });
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
        estimatedTimeMs: isComplex ? 60000 : 15000,
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
        estimatedTimeMs: 30000,
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
        milestones: plan.milestones,
        estimatedTimeMs: plan.totalEstimatedTimeMs,
      });
      for (const [taskId, task] of plan.subTasks) {
        const taskNodeId = graph.addNode("task", task.name, {
          taskId: task.id,
          status: task.status,
          priority: task.priority,
          strategy: task.thinkingStrategy,
          parallelGroup: task.parallelGroup,
          estimatedTimeMs: task.estimatedTimeMs,
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
    } catch { logger.warn("empty catch block") }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

export const goalDecomposer = new GoalDecomposer();
