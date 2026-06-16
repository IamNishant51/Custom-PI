import { bus, Topics } from "./event-bus/event-bus";
import { getGraph } from "./state-graph/property-graph";
import { HybridSearch } from "./state-graph/hybrid-search";
import { getDaemon, Daemon, startDaemon } from "./daemon/daemon";

import { goalDecomposer } from "./cognition/goal-decomposer";
import { episodicMemory } from "./cognition/episodic-memory";
import { theoryOfMind } from "./cognition/theory-of-mind";
import { metacognition } from "./cognition/metacognition";

import { environmentSensor } from "./perception/environment-sensor";
import { webSentience } from "./perception/web-sentience";

import { initiativeEngine } from "./autonomy/initiative-engine";
import { financialAutonomy } from "./autonomy/financial-autonomy";
import { selfHealer } from "./autonomy/self-healer";
import { securityAutopilot } from "./autonomy/security-autopilot";

import { hiveMind } from "./swarm/hive-mind";
import { mcpEcosystem } from "./swarm/mcp-ecosystem";

import { fullstackGenerator } from "./execution/fullstack-generator";
import { databaseIntelligence } from "./execution/database-intelligence";

import { selfModifier } from "./evolution/self-modifier";
import { continuousLearning } from "./evolution/continuous-learning";

import { longTermPlanner } from "./omega/long-term-planner";
import { causalReasoner } from "./omega/causal-reasoner";
import { universalToolCreator } from "./omega/universal-tool-creator";
import { pluginMarketplace } from "./plugin-system/plugin-marketplace";
import { stopDaemon } from "./daemon/daemon";
import { closeGraph } from "./state-graph/property-graph";

export interface AscensionConfig {
  daemonEnabled?: boolean;
  autoDiscoverMcp?: boolean;
  watchDirectories?: string[];
  healthCheckInterval?: number;
  daemonTickInterval?: number;
}

export function initializeAscension(config: AscensionConfig = {}): void {
  const graph = getGraph();
  const hybridSearch = new HybridSearch(graph);
  const daemon = getDaemon({ tickInterval: config.daemonTickInterval || 5000 });

  // Initialize all subsystems explicitly (no constructor side effects)
  selfHealer.init();
  initiativeEngine.init();
  securityAutopilot.init();

  bus.emit(Topics.SYSTEM_STARTUP, {
    version: "1.9.0",
    subsystems: [
      "event-bus", "state-graph", "hybrid-search", "daemon",
      "goal-decomposer", "episodic-memory", "theory-of-mind", "metacognition",
      "environment-sensor", "web-sentience",
      "initiative-engine", "financial-autonomy", "self-healer", "security-autopilot",
      "hive-mind", "mcp-ecosystem",
      "fullstack-generator", "database-intelligence",
      "self-modifier", "continuous-learning",
      "long-term-planner", "causal-reasoner", "universal-tool-creator", "plugin-marketplace",
    ],
  }, { source: "ascension-bootstrap" });

  if (config.daemonEnabled !== false) {
    daemon.start();
  }

  daemon.registerTask(Daemon.createIntervalTask(
    "ascension:health-monitor",
    async () => {
      const health = selfHealer.getHealthStatus();
      bus.emit(Topics.HEALTH_CHECK, health, { source: "ascension-bootstrap" });
    },
    config.healthCheckInterval || 300000
  ));

  daemon.registerTask(Daemon.createIntervalTask(
    "ascension:env-refresh",
    async () => {
      const changes = environmentSensor.detectEnvironmentChanges();
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
      environmentSensor.watchDirectory(dir, true);
    }
  }

  environmentSensor.watchDirectory(process.cwd(), false);
  const agentDir = require("os").homedir() + "/.pi/agent";
  environmentSensor.watchDirectory(agentDir, false);

  bus.on(Topics.MESSAGE_RECEIVED, (event) => {
    daemon.reportUserActivity();
    const msg = event.data;
    if (msg.role === "user") {
      theoryOfMind.analyzeUserMessage("default", msg.content || "");
    }
  });

  bus.on(Topics.USER_FEEDBACK, (event) => {
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

  bus.on(Topics.TOOL_ERROR, (event) => {
    continuousLearning.learnFromToolCall({
      input: event.data.toolName || "unknown",
      output: "",
      context: event.data.task || "",
      success: false,
      tags: ["error", "tool"],
    });
    securityAutopilot.scanFile(event.data.filePath || "");
  });

  bus.on(Topics.SYSTEM_ERROR, (event) => {
    selfHealer.handleError(event.data.source, event.data.error || event.data.message);
  });

  bus.on(Topics.GOAL_DECOMPOSED, (event) => {
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

  bus.on(Topics.COST_TRACKED, (event) => {
    graph.addNode("cost_entry", `Cost: ${event.data.model}`, {
      model: event.data.model,
      tokensIn: event.data.tokensIn,
      tokensOut: event.data.tokensOut,
      cost: event.data.cost,
      totalSpent: event.data.totalSpent,
    });
  });

  // Ascension startup complete
}

export function shutdownAscension(): void {
  bus.emit(Topics.SYSTEM_SHUTDOWN, { reason: "user_initiated" }, { source: "ascension-bootstrap" });
  stopDaemon();
  closeGraph();
  selfHealer.destroy();
  initiativeEngine.destroy();
  securityAutopilot.destroy();
  episodicMemory.destroy();
  environmentSensor.destroy();
  webSentience.destroy();
  console.log("[Ascension] All subsystems shut down.");
}

export const subsystems = {
  bus,
  graph: getGraph(),
  daemon: getDaemon(),
  hybridSearch: new HybridSearch(getGraph()),
  goalDecomposer,
  episodicMemory,
  theoryOfMind,
  metacognition,
  environmentSensor,
  webSentience,
  initiativeEngine,
  financialAutonomy,
  selfHealer,
  securityAutopilot,
  hiveMind,
  mcpEcosystem,
  fullstackGenerator,
  databaseIntelligence,
  selfModifier,
  continuousLearning,
  longTermPlanner,
  causalReasoner,
  universalToolCreator,
  pluginMarketplace,
};
