import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { logger } from "../logger";
import { resolveFastModel } from "./tool-registry";
import { contextMonitor } from "../context-monitor";
import { startCronJobs } from "../cron-scheduler";
import { ensureSession, getLatestCheckpoint } from "../state-db";
import { stopGlobalAnimation, STATUS_VERBS } from "../animations";
import { ensureSoulFile } from "../soul-loader";
import { ensureMemoryFiles } from "../memory-file-store";
import { initNudgeState, incrementTurn, shouldNudgeMemory, shouldNudgeSkill, resetMemoryNudge, resetSkillNudge, getNudgeState } from "../memory-nudge";
import { vaultImportFromEnv } from "../secret-vault";
import { harvestContext, suggestWorkflows, formatSuggestionsForPrompt } from "../workflow-suggestions";
import { consolidate as consolidateMemory, store as storeMemory, markContradicted } from "../memory-store";
import { setupWidget } from "../tui/setup-widget";
import { bus, Topics } from "../event-bus/event-bus";
import { invalidateAgentCache } from "./agent-config";
import { completeSimple } from "@earendil-works/pi-ai";
import { getConversationText, countToolCalls } from "../utils/serialize-message";
import { runPreCompressionFlush, runMemoryReview, runSkillReview } from "../background-review";

export const MAX_BACKGROUND_TOOL_CALLS = 3;
export const MIN_SKILL_TOOL_CALLS = 5;
export const COMPACT_RESERVE_RATIO = 0.12;
export const COMPACT_KEEP_RATIO = 0.40;
export const MEMORY_TTL_DAYS = 180;
export const SKILL_TTL_DAYS = 365;
export const CHECKPOINT_STALE_MS = 3600_000;

export let globalVerbCycler: ReturnType<typeof setInterval> | null = null;
export let appMode: "agent" | "plan" = "agent";
export let unsubTabHandler: (() => void) | null = null;
export let isProcessingBackground = false;
export let backgroundDebounceTimer: ReturnType<typeof setTimeout> | null = null;
export let turnCounter = 0;
export const clonedRepos = new Set<string>();
export const BACKGROUND_DEBOUNCE_MS = 2000;

export function setGlobalVerbCycler(v: ReturnType<typeof setInterval> | null) {
  globalVerbCycler = v;
}

export function setAppMode(m: "agent" | "plan") {
  appMode = m;
}

export function setUnsubTabHandler(h: (() => void) | null) {
  unsubTabHandler = h;
}

export function setIsProcessingBackground(v: boolean) {
  isProcessingBackground = v;
}

export function setBackgroundDebounceTimer(t: ReturnType<typeof setTimeout> | null) {
  backgroundDebounceTimer = t;
}

export function incrementTurnCounter() {
  turnCounter++;
}

export function resetTurnCounter() {
  turnCounter = 0;
}

export function deriveSessionId(ctx: any): string | null {
  try {
    const sessionFile = ctx.sessionManager?.getSessionFile();
    if (sessionFile) return path.basename(sessionFile, ".jsonl");
  } catch { logger.warn("MCP config init write failed"); }
  return ctx?.sessionId || null;
}

export async function checkAndStartCron(ctx: any, pi: ExtensionAPI) {
  try {
    const cronModel = resolveFastModel(ctx);
    const cronAuth = await ctx.modelRegistry.getApiKeyAndHeaders(cronModel);
    if (cronAuth.ok) {
      contextMonitor.configureAutoLearn(cronModel, { apiKey: cronAuth.apiKey, headers: cronAuth.headers });
      startCronJobs(cronModel, { apiKey: cronAuth.apiKey, headers: cronAuth.headers }, {}, (_report: any) => {});
    }
  } catch (err: any) { logger.warn(`Cron startup failed: ${err.message}`); }
}

export async function checkAndSuggestWorkflows(ctx: any, pi: ExtensionAPI) {
  try {
    const context = harvestContext();
    if (Object.keys(context.scripts).length > 0) {
      const suggestions = suggestWorkflows(context);
      if (suggestions.length > 0) {
        const formatted = formatSuggestionsForPrompt(suggestions);
        pi.sendMessage({
          role: "system" as any,
          content: [{ type: "text", text: formatted }]
        });
      }
    }
  } catch (err: any) { logger.warn(`Workflow suggestions failed: ${err.message}`); }
}

export async function runBackgroundProcessing(ctx: any): Promise<void> {
  if (isProcessingBackground) return;
  setIsProcessingBackground(true);

  try {
    incrementTurn();
    const nudgeModel = resolveFastModel(ctx);
    const nudgeAuth = await ctx.modelRegistry.getApiKeyAndHeaders(nudgeModel);
    const turn = getNudgeState().totalTurns;

    const branch = ctx.sessionManager.getBranch();
    if (!branch) return;
    const messages = branch
      .filter((e: any) => e.type === "message")
      .map((e: any) => e.message);
    if (messages.length === 0) return;

    const model = resolveFastModel(ctx);
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) return;

    const sessionFile = ctx.sessionManager.getSessionFile();
    const stateFile = sessionFile ? sessionFile.replace(".jsonl", "-task-state.json") : null;
    const project = path.basename(ctx.cwd || process.cwd()) || "global";

    const recentMessages = getConversationText(messages.slice(-10), 1000);

    const totalToolCalls = messages.reduce((sum: number, m: any) => {
      return sum + (m.role === "assistant" ? countToolCalls(m) : 0);
    }, 0);

    if (turn % 3 === 0) {
      let currentStateStr = "{}";
      if (stateFile && fs.existsSync(stateFile)) {
        try {
          currentStateStr = fs.readFileSync(stateFile, "utf8");
        } catch { logger.warn("MCP config init write failed"); }
      }

      const prompt = `Analyze the recent conversation and return a JSON object.

Current Task State:
${currentStateStr}

Recent Conversation:
${recentMessages}

Return ONLY a JSON object (no other text) with these optional fields:

1. "taskState": if the user has an active multi-step task, update state:
{
  "goal": "Overall objective",
  "completed_subtasks": [...],
  "current_subtask": "Current subtask",
  "pending_subtasks": [...],
  "state_notes": "Key decisions/context"
}
Omit if no active task.

2. "memory": if the conversation revealed important info worth persisting (preferences, decisions, bugs, patterns). Omit if nothing notable.
{
  "content": "What to remember",
  "type": "fact|decision|preference|pattern",
  "importance": <1-10>,
  "tags": [...],
  "contradicts": "If correcting prior knowledge, quote what is now contradicted"
}

3. "skill": ONLY if total tool calls (${totalToolCalls}) >= 5 and the task was complex. Omit otherwise.
{
  "content": "What was learned",
  "problemType": "Category",
  "approach": "General approach",
  "keySteps": ["Step 1", "Step 2"],
  "complexityScore": <1-10>,
  "tags": [...]
}

If nothing to report, return: {}`;

      const response = await completeSimple(model, {
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }]
      }, {
        apiKey: auth.apiKey,
        headers: auth.headers,
        reasoning: undefined
      });

      const responseText = response.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");

      const cleanJson = responseText.replace(/```json|```/g, "").trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        logger.warn("Failed to parse background JSON from LLM output");
        return;
      }
      if (!parsed || typeof parsed !== "object") return;

      if (parsed.taskState && stateFile) {
        try {
          fs.writeFileSync(stateFile, JSON.stringify(parsed.taskState, null, 2), "utf8");
        } catch (err: any) { logger.warn(`Task state write failed: ${err.message}`); }
      }

      if (totalToolCalls > MAX_BACKGROUND_TOOL_CALLS) {
        try {
          const flushMessages = getConversationText(messages.slice(-5), 500);
          await runPreCompressionFlush(model, { apiKey: auth.apiKey, headers: auth.headers }, flushMessages);
        } catch (err: any) { logger.warn(`Pre-compression flush failed: ${err.message}`); }
      }

      if (parsed.memory && parsed.memory.content) {
        const importance = Math.min(10, Math.max(1, Math.floor(parsed.memory.importance ?? 5)));
        const type = parsed.memory.type || "fact";
        const tags = parsed.memory.tags || [];
        const validTypes = ["fact", "decision", "preference", "pattern", "skill"];
        if (validTypes.includes(type)) {
          const newId = await storeMemory(parsed.memory.content, type, importance, project, tags, MEMORY_TTL_DAYS);
          if (parsed.memory.contradicts) {
            await markContradicted(parsed.memory.contradicts, newId);
          }
        }
      }

      if (parsed.skill && parsed.skill.content && totalToolCalls >= MIN_SKILL_TOOL_CALLS) {
        const tags = [...(parsed.skill.tags || []), "skill", parsed.skill.problemType || "general"].filter(Boolean);
        const importance = Math.min(10, Math.max(1, parsed.skill.complexityScore ?? 5));
        const skillMeta = {
          problemType: parsed.skill.problemType || "general",
          approach: parsed.skill.approach || "",
          keySteps: parsed.skill.keySteps || [],
          complexityScore: parsed.skill.complexityScore || 5,
          successCount: 1,
        };
        await storeMemory(parsed.skill.content, "skill", importance + 2, project, tags, SKILL_TTL_DAYS, skillMeta);
      }
    } else if (nudgeAuth.ok) {
      const conversation = getConversationText(messages.slice(-10));
      if (shouldNudgeMemory()) {
        const result = await runMemoryReview(nudgeModel, { apiKey: nudgeAuth.apiKey, headers: nudgeAuth.headers }, conversation);
        if (result.memoryAdded.length > 0 || result.userAdded.length > 0) {
          logger.info("memory_nudge", { summary: result.summary });
        }
        resetMemoryNudge();
      }
      if (shouldNudgeSkill()) {
        const result = await runSkillReview(nudgeModel, { apiKey: nudgeAuth.apiKey, headers: nudgeAuth.headers }, conversation);
        if (result.summary) logger.info("skill_nudge", { summary: result.summary });
        resetSkillNudge();
      }
    }
  } catch (e: any) {
    try {
      const debugLogPath = path.join(os.homedir(), ".pi", "agent", "memory-debug.log");
      fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] Background error: ${e.message}\n`, "utf8");
    } catch { logger.warn("MCP config init write failed"); }
  } finally {
    setIsProcessingBackground(false);
  }
}


