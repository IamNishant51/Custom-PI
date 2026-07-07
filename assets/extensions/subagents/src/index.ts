// Decomposed — tools/ | events/ | runtime/ — strict mode clean
import { UserMessageComponent, AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Container, TUI, visibleWidth, CURSOR_MARKER } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import yaml from "yaml";
import { completeSimple } from "@earendil-works/pi-ai";
import chalk from "chalk";
import os from "node:os";
import { createRequire } from "node:module";

import { store as storeMemory, search as searchMemory, remove as deleteMemory, stats as memoryStats, getRecent, consolidate as consolidateMemory, searchExisting, markContradicted, getSkills, flush as flushMemory } from "./memory-store";
import { buildMemoryContextBlock } from "./memory-retrieval";
import { detectStack, formatStackSummary } from "./stack-detector";
import { gateguard, policyValidator } from "./gateguard";
import { registerPlugin, listPlugins, listCardRenderers, listCommands } from "./tui";
import { contextMonitor } from "./context-monitor";
import { coalesceMessages, strictifySchema } from "./swarm-router";
import { C } from "./tui-colors";
import { SPINNER_FRAMES, DOT_PULSE, PROGRESS_SPINNER, BOUNCING_BAR, STATUS_VERBS, activeTrackers, activeInvalidators, startGlobalAnimation, stopGlobalAnimation, getSpinner, getDotPulse, getProgressSpinner, getBouncingBar, getStatusVerb, getGlobalFrame, getGlobalVerbIndex, getPulseColor, getPulseBrightColor, globalPulse } from "./animations";
import { TuiManager, SPACING as TUI_SPACING } from "./tui";
import { logger } from "./logger";
import { loadSoul, ensureSoulFile, getSoulPath } from "./soul-loader";
import { ensureMemoryFiles, loadMemorySnapshot, memoryWrite, memoryConsolidate as fileConsolidate, getMemoryStats } from "./memory-file-store";
import { initNudgeState, incrementTurn, shouldNudgeMemory, shouldNudgeSkill, resetMemoryNudge, resetSkillNudge, getNudgeState } from "./memory-nudge";
import { runMemoryReview, runSkillReview, runPreCompressionFlush } from "./background-review";
import { startCronJobs, stopCronJobs, isCronRunning } from "./cron-scheduler";
import { ensureSession, insertMessage, getMessages, getMessageCount, closeDb, saveCheckpoint, getLatestCheckpoint, queryTriplets, aggregateByEntity, findConnectedEntities, searchSession } from "./state-db";
import {
  vaultSet, vaultGet, vaultDelete, vaultList, vaultHealth, vaultHas, vaultExists, vaultImportFromEnv,
} from "./secret-vault";
import { trackCost, getSessionCosts, getCostSummary, getBudgetConfig, setBudgetConfig } from "./cost-tracker";
import { getCurrentRouting, getAvailableModels, setModelRoute, resetRouting } from "./model-router";
import { recordWorkProduct, getWorkProducts, getWorkProductSummary, clearWorkProducts } from "./work-products";
import { LocalStorageDriver, type StorageDriver } from "./storage-driver";
import { runVerification } from "./verification-engine";
import { harvestContext, suggestWorkflows, formatSuggestionsForPrompt } from "./workflow-suggestions";
import { discoverAgents, spawnAgentSession, closeSession, listSessions, getAgentLabel, saveCustomAgent, removeCustomAgent } from "./agent-manager";
import { loadMcpServers, saveMcpServers, toggleMcpServer, addMcpServer, removeMcpServer, getEnabledMcpServers, buildMcpContextForPrompt } from "./mcp-catalog";
import { createTeam, getTeams, getTeam, updateTeam, deleteTeam, addAgentToTeam, removeAgentFromTeam, updateAgentStatus, getTeamContext, type Team, type TeamAgent } from "./team-manager";
import { initializeAscension, shutdownAscension } from "./ascension-bootstrap";
import { bus, Topics } from "./event-bus/event-bus";

// Phase 1 decomposition imports
import { SubAgentCallCard, SubAgentResultCard, ParallelAgentsCallCard, ParallelAgentsResultCard, SubAgentCreatedCard, SubAgentListCard } from "./tui/components";
import { setupWidget, teardownWidget } from "./tui/setup-widget";
import { AGENTS_DIR_GLOBAL, AGENTS_DIR_LOCAL, loadAgents, invalidateAgentCache } from "./runtime/agent-config";
import { resolveModel, resolveFastModel } from "./runtime/tool-registry";
import { SubAgentRuntime } from "./runtime/subagent";
import { serializeMessageContent, extractToolName, extractToolArgs, hasToolCalls, countToolCalls, getConversationText } from "./utils/serialize-message";

// Tool definitions — extracted into modular files
import { toolListSubagents } from "./tools/tool-list-subagents";
import { toolCreateSubagent } from "./tools/tool-create-subagent";
import { toolDelegateSubagent } from "./tools/tool-delegate-subagent";
import { toolParallelSubagent } from "./tools/tool-parallel-subagent";
import { tools as allOtherTools } from "./tools/all-other-tools";

// Event handlers — extracted into modular file
import { registerEventHandlers } from "./events/handlers";

// MCP client — extracted into modular file
import type { McpServerConfig } from "./tools/mcp-client";
import { McpCliConnection } from "./tools/mcp-client";

// Shared mutable state — extracted into modular file
import {
  CHECKPOINT_STALE_MS, COMPACT_RESERVE_RATIO, BACKGROUND_DEBOUNCE_MS,
  globalVerbCycler, appMode, unsubTabHandler,
} from "./runtime/agent-state";

function applyRuntimePatches() {
  const req = createRequire(import.meta.url);

  let AgentSession: any;
  let AgentClass: any;

  try {
    AgentSession = req("@earendil-works/pi-coding-agent").AgentSession;
  } catch { /* AgentSession is optional — warning suppressed */ }

  try {
    AgentClass = req("@earendil-works/pi-agent-core").Agent;
  } catch (e) {
    try {
      const piCodingAgentPath = path.dirname(req.resolve("@earendil-works/pi-coding-agent"));
      const nestedPath = path.join(piCodingAgentPath, "node_modules", "@earendil-works", "pi-agent-core");
      AgentClass = req(nestedPath).Agent;
    } catch (err2: any) {
      try {
        const globalPrefix = process.env.PI_GLOBAL_PREFIX || path.join(os.homedir(), ".npm-global");
        const globalPath = path.join(globalPrefix, "lib", "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-agent-core");
        AgentClass = req(globalPath).Agent;
      } catch {
        logger.warn("[Patch] Could not resolve pi-agent-core from any location");
      }
    }
  }

  // Patch 1: AgentSession.prototype._runAutoCompaction
  if (AgentSession && AgentSession.prototype) {
    const originalRunAutoCompaction = AgentSession.prototype._runAutoCompaction;
    if (originalRunAutoCompaction && !originalRunAutoCompaction.__patched) {
      AgentSession.prototype._runAutoCompaction = async function (reason: string, willRetry: boolean) {
        const result = await originalRunAutoCompaction.call(this, reason, willRetry);

        if (willRetry && this.agent && this.agent.state) {
          const messages = this.agent.state.messages;
          const lastMsg = messages[messages.length - 1];
          if (lastMsg?.role === "assistant") {
            this.agent.state.messages = messages.slice(0, -1);
          }
        }

        return result;
      };
      AgentSession.prototype._runAutoCompaction.__patched = true;
      logger.info("[Patch] Patched AgentSession._runAutoCompaction for silent overflow retries");
    }
  }

  // Patch 2: Agent.prototype.continue
  if (AgentClass && AgentClass.prototype) {
    const originalContinue = AgentClass.prototype.continue;
    if (originalContinue && !originalContinue.__patched) {
      AgentClass.prototype.continue = async function () {
        const lastMessage = this._state.messages[this._state.messages.length - 1];
        if (lastMessage && lastMessage.role === "assistant" && !this.hasQueuedMessages()) {
          return;
        }
        return originalContinue.call(this);
      };
      AgentClass.prototype.continue.__patched = true;
      logger.info("[Patch] Patched Agent.continue to avoid role validation crashes");
    }
  }
}

export default function (pi: ExtensionAPI) {
  try {
    applyRuntimePatches();
  } catch (err: any) {
    logger.error(`Failed to apply runtime patches: ${err.message}`);
  }

  // ── MCP Server Client Integration ─────────────────────────────────────────
  const PI_DIR_GLOBAL = path.join(os.homedir(), ".pi", "agent");
  const MCP_CONFIG_FILE_GLOBAL = path.join(PI_DIR_GLOBAL, "mcp-servers.json");

  function loadMcpConfigGlobal(): McpServerConfig[] {
    let config: McpServerConfig[] = [];
    try {
      if (fs.existsSync(MCP_CONFIG_FILE_GLOBAL)) {
        config = JSON.parse(fs.readFileSync(MCP_CONFIG_FILE_GLOBAL, "utf8"));
      }
    } catch (err: any) { logger.warn(`MCP config init failed: ${err.message}`); }

    const seqThinkingName = "sequential-thinking";
    let seqThinking = config.find(s => s.name === seqThinkingName);

    const nvmBinDir = path.dirname(process.execPath);
    const globalMcpPath = path.join(nvmBinDir, "mcp-server-sequential-thinking");
    const mcpCommand = fs.existsSync(globalMcpPath) ? globalMcpPath : "npx";
    const mcpArgs = mcpCommand === "npx" ? ["-y", "@modelcontextprotocol/server-sequential-thinking"] : [];

    if (!seqThinking) {
      seqThinking = {
        name: seqThinkingName,
        command: mcpCommand,
        args: mcpArgs,
        enabled: true,
        description: "Sequential Thinking MCP Server for step-by-step reasoning"
      };
      config.push(seqThinking);
      try {
        fs.mkdirSync(path.dirname(MCP_CONFIG_FILE_GLOBAL), { recursive: true });
        fs.writeFileSync(MCP_CONFIG_FILE_GLOBAL, JSON.stringify(config, null, 2));
      } catch { logger.warn("MCP config init write failed"); }
    } else {
      let changed = false;
      if (!seqThinking.enabled) {
        seqThinking.enabled = true;
        changed = true;
      }
      if (seqThinking.command === "npx" && mcpCommand !== "npx") {
        seqThinking.command = mcpCommand;
        seqThinking.args = mcpArgs;
        changed = true;
      }
      if (changed) {
        try {
          fs.writeFileSync(MCP_CONFIG_FILE_GLOBAL, JSON.stringify(config, null, 2));
        } catch (err: any) { logger.warn(`MCP config update failed: ${err.message}`); }
      }
    }
    return config;
  }

  const activeCliMcpServers = new Map<string, any>();

  const servers = loadMcpConfigGlobal();
  for (const s of servers) {
    if (s.enabled) {
      const conn = new McpCliConnection(s);
      activeCliMcpServers.set(s.name, conn);
      conn.start().then(() => {
        for (const t of conn.tools) {
          pi.registerTool({
            name: t.name,
            label: t.name.split(/[-_]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
            description: t.description || `MCP Tool ${t.name}`,
            parameters: t.inputSchema || Type.Object({}),
            async execute(id, params, signal, update, context) {
              const res = await conn.callTool(t.name, params);
              if (!res || !res.content) {
                return { content: [{ type: "text", text: "Empty output" }] };
              }
              const content = res.content.map((c: any) => {
                if (c.type === "text") return { type: "text", text: c.text };
                return { type: "text", text: JSON.stringify(c) };
              });
              return { content };
            }
          });
        }
      }).catch(err => {
        logger.error(`[MCP-CLI] Failed to load server ${s.name}: ${err.message}`);
      });
    }
  }

  process.on("exit", () => {
    for (const conn of activeCliMcpServers.values()) {
      conn.cleanup();
    }
  });

  // ── Initialize Ascension Subsystems (Phase 0–8) ──────────────────────────
  try {
    initializeAscension({
      daemonEnabled: true,
      autoDiscoverMcp: false,
      healthCheckInterval: 300000,
    }).catch((e: any) => logger.error(`[Ascension] Initialization failed: ${e.message}`));
  } catch (e: any) {
    logger.error(`[Ascension] Initialization failed: ${e.message}`);
  }

  // ── Register extracted tool definitions ───────────────────────────────────
  pi.registerTool(toolListSubagents);
  pi.registerTool(toolCreateSubagent);
  pi.registerTool(toolDelegateSubagent);
  pi.registerTool(toolParallelSubagent);
  for (const t of allOtherTools) {
    pi.registerTool(t);
  }

  // ── Register commands ─────────────────────────────────────────────────────
  pi.registerCommand("help", {
    description: "Show available commands and keyboard shortcuts.",
    handler(args: string, ctx: ExtensionContext) {
      ctx.ui.notify(
        "Commands: /memory, /memory-stats, /memory-reset, /consolidate, /detect, /gateguard, /context, /context-budget, /model-routing, /checkpoint, /triplets, /workflows, /telemetry, /plugins, /help. " +
        "Keyboard: e = expand/collapse result card, r = retry sub-agent, q = quit session.",
        "info"
      );
    },
    execute(args: string, ctx: ExtensionContext) {
      return (this as any).handler(args, ctx);
    }
  });

  pi.registerCommand("checkpoint", {
    description: "Resume from the latest checkpoint. Restores goal, subtasks, and context.",
    async handler(args: string, ctx: ExtensionContext) {
      const cp = await getLatestCheckpoint();
      if (!cp) {
        ctx.ui.notify("No checkpoint found to resume from.", "error");
        return;
      }
      if (Date.now() - cp.timestamp > CHECKPOINT_STALE_MS) {
        ctx.ui.notify("Latest checkpoint is over 1 hour old. Too stale to resume.", "error");
        return;
      }
      const stamp = new Date(cp.timestamp).toLocaleTimeString();
      const age = Math.round((Date.now() - cp.timestamp) / 1000);
      ctx.ui.notify(`Resuming checkpoint from ${stamp} (${age}s ago)`, "info");
      const formatted = `**Checkpoint Recovery — ${stamp}**\n\n` +
        `- **Goal**: ${cp.goal}\n` +
        `- **Active Agent**: ${cp.activeAgentName || "N/A"}\n` +
        `- **Current Subtask**: ${cp.currentSubtask}\n` +
        `- **Completed**:\n${cp.completedSubtasks.map((t: string) => `  * [x] ${t}`).join("\n") || "  (None)"}\n` +
        `- **Pending**:\n${cp.pendingSubtasks.map((t: string) => `  * [ ] ${t}`).join("\n") || "  (None)"}\n` +
        `- **Notes**: ${cp.stateNotes || "None"}`;
      pi.sendMessage({
        role: "system" as any,
        content: [{ type: "text", text: formatted }]
      });
    },
    execute(args: string, ctx: ExtensionContext) {
      return (this as any).handler(args, ctx);
    }
  });

  pi.registerCommand("help-ext", {
    description: "Show custom-pi extension commands and tools",
    handler(_args: string, ctx: ExtensionContext) {
      const helpText = [
        "Custom-PI Extension Commands:",
        "  /checkpoint   — Resume from last checkpoint",
        "  /help-ext     — Show this help",
        "",
        "Available tools are listed in the tool dropdown.",
      ].join("\n");
      ctx.ui.notify(helpText, "info");
    },
    execute(_args: string, ctx: ExtensionContext) {
      ctx.ui.notify("Custom-PI Extension Commands: /checkpoint, /help-ext", "info");
    },
  });

  // ── Register extracted event handlers ─────────────────────────────────────
  registerEventHandlers(pi);

  // ── Register core TUI plugin ──────────────────────────────────────────────
  registerPlugin({
    name: "pi-subagent-core",
    version: "1.5.0",
  });
}
