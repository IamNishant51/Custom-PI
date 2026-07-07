import { Type } from "typebox";
import chalk from "chalk";
import { SubAgentCallCard, SubAgentResultCard } from "../tui/components";
import { loadAgents } from "../runtime/agent-config";
import { SubAgentRuntime } from "../runtime/subagent";
import { SPINNER_FRAMES, stopGlobalAnimation, activeTrackers } from "../animations";
import { C } from "../tui-colors";
import { saveCheckpoint } from "../state-db";
import { logger } from "../logger";
import { setupWidget } from "../tui/setup-widget";

const SUBAGENT_RETRY_DELAY_BASE = 2;

export const toolDelegateSubagent = {
  name: "delegate_to_subagent",
  label: "Delegate to Sub-Agent",
  description: "Delegate a specific task to a specialized sub-agent (e.g. reviewer, builder) to run independently. Call this immediately when the user requests a sub-agent task, instead of reading files or executing the task yourself.",
  parameters: Type.Object({
    agentId: Type.String({ description: "The name or ID of the sub-agent to use (e.g. 'reviewer', 'builder', 'researcher')" }),
    task: Type.String({ description: "The detailed task for the sub-agent to perform. Specify the target files and scope clearly." }),
  }),
  renderShell: "self",
  renderCall(args: any, _theme: any, ctx: any) {
    return new SubAgentCallCard(args, ctx);
  },
  renderResult(result: any, options: any, _theme: any, ctx: any) {
    return new SubAgentResultCard(result, options, ctx);
  },
  async execute(id: string, params: { agentId: string; task: string }, signal: AbortSignal, update: any, context: any) {
    const agents = loadAgents();
    const config = agents.get(params.agentId);

    if (!config) {
      return {
        content: [{ type: "text", text: `Sub-agent '${params.agentId}' not found. Available sub-agents: ${Array.from(agents.keys()).join(", ")}` }],
        isError: true,
      };
    }

    context.ui.setWorkingIndicator({
      frames: SPINNER_FRAMES.map((f: string) => chalk.hex(C.teal)(f)),
      intervalMs: 80,
    });
    context.ui.setWorkingMessage(`${config.name} is working...`);

    setupWidget(context);

    context.ui.notify(
      `${chalk.hex(C.orange)("\u25a3")} Spawning sub-agent: ${chalk.hex(C.cream).bold(config.name)}`,
      "info"
    );

    try {
      const MAX_RETRIES = 2;
      let lastError: Error | null = null;
      let result: string = "";
      let runtime: SubAgentRuntime | null = null;

      try {
        await saveCheckpoint({
          taskId: id,
          sessionId: context.sessionId || "unknown",
          timestamp: Date.now(),
          goal: params.task.slice(0, 200),
          currentSubtask: `Delegating to ${params.agentId}`,
          completedSubtasks: [],
          pendingSubtasks: [params.task],
          stateNotes: `Sub-agent: ${params.agentId}`,
          activeAgentName: params.agentId,
          lastToolResult: null,
        });
      } catch (err: any) { logger.warn(`Checkpoint save failed: ${err.message}`); }

      if (signal) {
        signal.addEventListener("abort", () => {
          stopGlobalAnimation();
          context.ui.setWorkingIndicator();
          context.ui.setWorkingMessage();
          context.ui.setStatus("subagents", undefined);
        }, { once: true });
      }

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          runtime = new SubAgentRuntime(context, config, id, signal);
          const updateFn = update as ((u: any) => void) | undefined;
          runtime.onProgress = (msg: string) => {
            context.ui.setWorkingMessage(msg);
            updateFn?.({ content: [{ type: "text" as const, text: msg }] });
          };
          result = await runtime.execute(params.task);
          break;
        } catch (err: any) {
          lastError = err;
          if (attempt < MAX_RETRIES && err.message?.includes("rate limit") || err.message?.includes("timeout") || err.message?.includes("ECONNRESET")) {
            const delay = Math.pow(SUBAGENT_RETRY_DELAY_BASE, attempt) * 1000;
            await new Promise(r => setTimeout(r, delay));
            context.ui.notify(`Retrying sub-agent (attempt ${attempt + 2}/${MAX_RETRIES + 1})...`, "info");
            continue;
          }
          throw err;
        }
      }

      if (lastError && !result) throw lastError;

      context.ui.setWorkingIndicator();
      context.ui.setWorkingMessage();

      return {
        content: [{
          type: "text",
          text: `Sub-agent ${config.name} completed the task:\n\n${
            result.length > 3000
              ? result.slice(0, 3000) + `\n\n...[Result truncated to 3000 chars — ${result.length} total. Press 'e' on the result card to expand.]`
              : result
          }`
        }],
        details: { agent: config.name, fullResult: result },
      };
    } catch (error: any) {
      const tracker = activeTrackers.get(id);
      if (tracker) {
        tracker.status = "error";
        tracker.error = error.message;
        tracker.endTime = Date.now();
      }

      context.ui.setWorkingIndicator();
      context.ui.setWorkingMessage();
      context.ui.setStatus("subagents", undefined);

      return {
        content: [{ type: "text", text: `Error running sub-agent ${config.name}: ${error.message}` }],
        isError: true,
      };
    } finally {
      stopGlobalAnimation();
    }
  },
};
