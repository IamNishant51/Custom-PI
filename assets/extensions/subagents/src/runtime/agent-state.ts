import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { logger } from "../logger";
import { ensureSession, getLatestCheckpoint } from "../state-db";
import { stopGlobalAnimation, STATUS_VERBS } from "../animations";
import { ensureSoulFile } from "../soul-loader";
import { ensureMemoryFiles } from "../memory-file-store";
import { initNudgeState, incrementTurn } from "../memory-nudge";
import { vaultImportFromEnv } from "../secret-vault";
import { harvestContext, suggestWorkflows, formatSuggestionsForPrompt } from "../workflow-suggestions";
import { flush as flushMemory } from "../memory-store";
import { bus, Topics } from "../event-bus/event-bus";
import { invalidateAgentCache } from "./agent-config";
import { getConversationText, countToolCalls } from "../utils/serialize-message";

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
  } catch (e: any) { logger.warn("MCP config init write failed", e?.message || String(e)); }
  return ctx?.sessionId || null;
}

export async function checkAndStartCron(ctx: any, pi: ExtensionAPI) {
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
    const messages = ctx.sessionManager.getBranch()
      ?.filter((e: any) => e.type === "message")
      .map((e: any) => e.message) ?? [];
    if (messages.length === 0) return;

    const totalToolCalls = messages.reduce((sum: number, m: any) => {
      return sum + (m.role === "assistant" ? countToolCalls(m) : 0);
    }, 0);

    const sessionFile = ctx.sessionManager.getSessionFile();
    const stateFile = sessionFile ? sessionFile.replace(".jsonl", "-task-state.json") : null;
    if (stateFile && fs.existsSync(stateFile)) {
      const currentStateStr = fs.readFileSync(stateFile, "utf8");
      try {
        const parsed = JSON.parse(currentStateStr);
        if (parsed && typeof parsed === "object") {
          const conversation = getConversationText(messages.slice(-6), 600);
          parsed.current_subtask = parsed.current_subtask || "In progress";
          parsed.state_notes = `Last exchange: ${conversation.slice(0, 200)}...`;
          fs.writeFileSync(stateFile, JSON.stringify(parsed, null, 2), "utf8");
        }
      } catch {}
    }

    const project = path.basename(ctx.cwd || process.cwd()) || "global";
    const conversation = getConversationText(messages.slice(-6), 600);
    const now = Date.now();
    const daySec = 86400;

    if (totalToolCalls > MAX_BACKGROUND_TOOL_CALLS && now % (daySec * 1000) < 30000) {
      await flushMemory();
    }
  } catch (e: any) {
    logger.warn(`Background processing error: ${e.message}`);
  } finally {
    setIsProcessingBackground(false);
  }
}


