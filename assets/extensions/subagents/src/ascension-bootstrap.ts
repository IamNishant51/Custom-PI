import { bus, Topics } from "./event-bus/event-bus";
import { getGraph } from "./state-graph/property-graph";
import { HybridSearch } from "./state-graph/hybrid-search";
import { getDaemon, Daemon, stopDaemon } from "./daemon/daemon";
import { closeGraph } from "./state-graph/property-graph";
import os from "node:os";

import { selfHealer } from "./autonomy/self-healer";
import { initiativeEngine } from "./autonomy/initiative-engine";
import { securityAutopilot } from "./autonomy/security-autopilot";
import { episodicMemory } from "./cognition/episodic-memory";
import { theoryOfMind } from "./cognition/theory-of-mind";
import { goalDecomposer } from "./cognition/goal-decomposer";
import { environmentSensor as envSensor } from "./perception/environment-sensor";
import { webSentience } from "./perception/web-sentience";
import { continuousLearning } from "./evolution/continuous-learning";
import { longTermPlanner } from "./omega/long-term-planner";
import { mcpEcosystem } from "./swarm/mcp-ecosystem";

export interface AscensionConfig {
  daemonEnabled?: boolean;
  autoDiscoverMcp?: boolean;
  watchDirectories?: string[];
  healthCheckInterval?: number;
  daemonTickInterval?: number;
}

const subsystemList = [
  "event-bus", "state-graph", "daemon",
  "goal-decomposer", "episodic-memory", "theory-of-mind",
  "environment-sensor", "web-sentience",
  "initiative-engine", "self-healer", "security-autopilot",
  "mcp-ecosystem", "continuous-learning", "long-term-planner",
];

export async function initializeAscension(config: AscensionConfig = {}): Promise<void> {
  const graph = getGraph();
  const daemon = getDaemon({ tickInterval: config.daemonTickInterval || 5000 });

  selfHealer.init();
  initiativeEngine.init();
  securityAutopilot.init();

  bus.emit(Topics.SYSTEM_STARTUP, {
    version: "1.10.0",
    subsystems: subsystemList,
  }, { source: "ascension-bootstrap" });

  if (config.daemonEnabled !== false) {
    daemon.start();
  }

  daemon.registerTask(Daemon.createIntervalTask(
    "ascension:health-monitor",
    async () => {
      bus.emit(Topics.HEALTH_CHECK, selfHealer.getHealthStatus(), { source: "ascension-bootstrap" });
    },
    config.healthCheckInterval || 300000
  ));

  daemon.registerTask(Daemon.createIntervalTask(
    "ascension:env-refresh",
    async () => {
      const changes = envSensor.detectEnvironmentChanges();
      if (Object.keys(changes).length > 0) {
        initiativeEngine.evaluate("maintenance",
          `Environment changed: ${Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(", ")}`,
          0.3, 0.2);
      }
    },
    60000
  ));

  daemon.registerTask(Daemon.createIdleTask(
    "ascension:memory-consolidation",
    async () => {
      const compressed = await episodicMemory.compressEpisodes();
      await episodicMemory.dreamConsolidation();
      if (compressed > 0) {
        bus.emit(Topics.MEMORY_CONSOLIDATED, { compressed }, { source: "ascension-bootstrap" });
      }
    }
  ));

  daemon.registerTask(Daemon.createIdleTask(
    "ascension:security-scan",
    async () => {
      const score = securityAutopilot.getSecurityScore();
      if (score.critical > 0 || score.high > 2) {
        bus.emit(Topics.SYSTEM_WARNING, {
          source: "security-autopilot",
          message: `Security scan: ${score.critical} critical, ${score.high} high findings`,
        }, { source: "ascension-bootstrap" });
      }
    }
  ));

  daemon.registerTask(Daemon.createIdleTask(
    "ascension:learn-patterns",
    async () => {
      const stats = continuousLearning.getStats();
      if (stats.highConfidencePatterns > 0) {
        graph.addNode("custom", "Learning Patterns", {
          patterns: stats.totalPatterns,
          highConfidence: stats.highConfidencePatterns,
          correctionRate: stats.correctionRate,
        });
      }
    }
  ));

  daemon.registerTask(Daemon.createIntervalTask(
    "ascension:goal-review",
    async () => {
      const advice = longTermPlanner.getStrategicAdvice();
      if (advice.length > 0) {
        bus.emit(Topics.PROACTIVE_ACTION, {
          type: "strategic_advice",
          advice,
        }, { source: "ascension-bootstrap" });
      }
    },
    3600000
  ));

  if (config.autoDiscoverMcp !== false) {
    mcpEcosystem.autoDiscoverServers().catch(() => {});
  }

  if (config.watchDirectories) {
    for (const dir of config.watchDirectories) {
      envSensor.watchDirectory(dir, true);
    }
  }
  envSensor.watchDirectory(process.cwd(), false);
  envSensor.watchDirectory(os.homedir() + "/.pi/agent", false);

  bus.on(Topics.MESSAGE_RECEIVED, async (event) => {
    daemon.reportUserActivity();
    if (event.data?.role === "user") {
      theoryOfMind.analyzeUserMessage("default", event.data.content || "");
    }
  });

  bus.on(Topics.USER_FEEDBACK, async (event) => {
    continuousLearning.learnFromCorrection({
      input: event.data.input || "",
      output: event.data.originalOutput || "",
      context: event.data.context || "general",
      success: false,
      userFeedback: event.data.correction,
      correctedOutput: event.data.correctedOutput,
      tags: ["correction"],
    });
  });

  bus.on(Topics.TOOL_ERROR, async (event) => {
    continuousLearning.learnFromToolCall({
      input: event.data.toolName || "unknown",
      output: "",
      context: event.data.task || "",
      success: false,
      tags: ["error", "tool"],
    });
    securityAutopilot.scanFile(event.data.filePath || "");
  });

  bus.on(Topics.SYSTEM_ERROR, async (event) => {
    selfHealer.handleError(event.data.source, event.data.error || event.data.message);
  });

  bus.on(Topics.GOAL_DECOMPOSED, async (event) => {
    const plan = goalDecomposer.getPlan(event.data.planId);
    if (plan) {
      graph.addNode("goal", plan.goal.slice(0, 200), {
        planId: plan.id,
        status: plan.status,
        taskCount: plan.subTasks.size,
        priority: plan.priority,
      });
    }
  });

  bus.on(Topics.COST_TRACKED, async (event) => {
    graph.addNode("cost_entry", `Cost: ${event.data.model}`, {
      model: event.data.model,
      tokensIn: event.data.tokensIn,
      tokensOut: event.data.tokensOut,
      cost: event.data.cost,
      totalSpent: event.data.totalSpent,
    });
  });
}

export async function shutdownAscension(): Promise<void> {
  bus.emit(Topics.SYSTEM_SHUTDOWN, { reason: "user_initiated" }, { source: "ascension-bootstrap" });
  stopDaemon();
  closeGraph();

  const subs = [selfHealer, initiativeEngine, securityAutopilot, episodicMemory, envSensor, webSentience];
  for (const sub of subs) {
    if (sub && typeof sub.destroy === "function") {
      try { sub.destroy(); } catch { /* skip */ }
    }
  }

  console.log("[Ascension] All subsystems shut down.");
}
