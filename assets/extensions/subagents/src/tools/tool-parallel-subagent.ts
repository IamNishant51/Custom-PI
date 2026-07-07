import { Type } from "typebox";
import chalk from "chalk";
import { ParallelAgentsCallCard, ParallelAgentsResultCard } from "../tui/components";
import { loadAgents } from "../runtime/agent-config";
import { SubAgentRuntime } from "../runtime/subagent";
import { PROGRESS_SPINNER, stopGlobalAnimation, activeTrackers } from "../animations";
import { C } from "../tui-colors";
import { saveCheckpoint } from "../state-db";
import { logger } from "../logger";
import { setupWidget } from "../tui/setup-widget";

export const toolParallelSubagent = {
  name: "delegate_parallel_tasks",
  label: "Delegate Parallel Tasks",
  description: "Delegate multiple sub-tasks to multiple specialized sub-agents (e.g. reviewer, builder) to run in parallel.",
  parameters: Type.Object({
    tasks: Type.Array(
      Type.Object({
        agentId: Type.String({ description: "The name or ID of the sub-agent to use for this task" }),
        task: Type.String({ description: "The detailed task for the sub-agent to perform" })
      }),
      { description: "List of tasks to run concurrently" }
    )
  }),
  renderShell: "self",
  renderCall(args: any, _theme: any, ctx: any) {
    return new ParallelAgentsCallCard(args, ctx);
  },
  renderResult(result: any, options: any, _theme: any, ctx: any) {
    return new ParallelAgentsResultCard(result, options, ctx);
  },
  async execute(id: string, params: { tasks: Array<{ agentId: string; task: string }> }, signal: AbortSignal, update: any, context: any) {
    const agents = loadAgents();
    const tasks = params.tasks;

    if (!tasks || tasks.length === 0) {
      return {
        content: [{ type: "text", text: "Error: No tasks provided for parallel execution." }],
        isError: true
      };
    }

    context.ui.setWorkingIndicator({
      frames: PROGRESS_SPINNER.map((f: string) => chalk.hex(C.lavender)(f)),
      intervalMs: 120,
    });
    context.ui.setWorkingMessage(`Running ${tasks.length} sub-agents in parallel...`);

    try {
      await saveCheckpoint({
        taskId: id,
        sessionId: context.sessionId || "unknown",
        timestamp: Date.now(),
        goal: `Parallel delegation (${tasks.length} tasks)`,
        currentSubtask: `Spawning ${tasks.length} sub-agents`,
        completedSubtasks: [],
        pendingSubtasks: tasks.map(t => `${t.agentId}: ${t.task}`),
        stateNotes: `Parallel tasks: ${tasks.map(t => t.agentId).join(", ")}`,
        activeAgentName: null,
        lastToolResult: null,
      });
    } catch (err: any) { logger.warn(`Parallel checkpoint save failed: ${err.message}`); }

    if (signal) {
      signal.addEventListener("abort", () => {
        stopGlobalAnimation();
        context.ui.setWorkingIndicator();
        context.ui.setWorkingMessage();
        context.ui.setStatus("subagents", undefined);
      }, { once: true });
    }

    setupWidget(context);

    context.ui.notify(
      `${chalk.hex(C.lavender)("\u26a1")} Spawning ${chalk.hex(C.cream).bold(String(tasks.length))} sub-agents in parallel`,
      "info"
    );

    const promises = tasks.map(async (t, index) => {
      const config = agents.get(t.agentId);
      if (!config) {
        const trackerId = `${id}:${index}`;
        activeTrackers.set(trackerId, {
          id: trackerId,
          name: t.agentId,
          task: t.task,
          status: "error",
          turn: 0,
          maxTurns: 10,
          toolCallCount: 0,
          startTime: Date.now(),
          endTime: Date.now(),
          error: `Sub-agent '${t.agentId}' not found.`,
        });
        return { agent: t.agentId, task: t.task, error: `Sub-agent '${t.agentId}' not found.` };
      }

      try {
        const trackerId = `${id}:${index}`;
        const runtime = new SubAgentRuntime(context, config, trackerId, signal);
        const result = await runtime.execute(t.task);
        const tracker = activeTrackers.get(trackerId);
        if (tracker) tracker.result = result;
        return { agent: config.name, task: t.task, result };
      } catch (error: any) {
        const tracker = activeTrackers.get(`${id}:${index}`);
        if (tracker) tracker.result = `Error: ${error.message}`;
        return { agent: config.name, task: t.task, error: error.message };
      }
    });

    try {
      const results = await Promise.all(promises);

      context.ui.setWorkingIndicator();
      context.ui.setWorkingMessage();
      context.ui.setStatus("subagents", undefined);

      const summary = results.map(r => {
        if (r.error) {
          return `## ${r.agent} — Failed\n\nError: ${r.error}`;
        }
        return `## ${r.agent}\n\n${r.result}`;
      }).join("\n\n---\n\n");
      return {
        content: [{ type: "text", text: summary }],
        details: { agents: results },
      };
    } catch (error: any) {
      context.ui.setWorkingIndicator();
      context.ui.setWorkingMessage();
      context.ui.setStatus("subagents", undefined);

      return {
        content: [{ type: "text", text: `Parallel execution failed: ${error.message}` }],
        isError: true
      };
    }
  },
};
