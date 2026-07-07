import { bus, Topics } from "./event-bus/event-bus";
import { getGraph } from "./state-graph/property-graph";
import { HybridSearch } from "./state-graph/hybrid-search";
import { getDaemon, Daemon, stopDaemon } from "./daemon/daemon";
import { closeGraph } from "./state-graph/property-graph";
import os from "node:os";

// Lazy-loading subsystem accessors
const _cache = new Map<string, any>();

function lazyload<T>(path: string, exportName: string): () => Promise<T> {
  return async () => {
    const key = `${path}#${exportName}`;
    if (!_cache.has(key)) {
      _cache.set(key, (await import(path))[exportName]);
    }
    return _cache.get(key) as T;
  };
}

// Type helpers — cast at call sites since dynamic import() returns unknown
type AnySub = any;
const _episodicMemory = lazyload<AnySub>("./cognition/episodic-memory", "episodicMemory");
const _theoryOfMind = lazyload<AnySub>("./cognition/theory-of-mind", "theoryOfMind");
const _goalDecomposer = lazyload<AnySub>("./cognition/goal-decomposer", "goalDecomposer");
const _environmentSensor = lazyload<AnySub>("./perception/environment-sensor", "environmentSensor");
const _initiativeEngine = lazyload<AnySub>("./autonomy/initiative-engine", "initiativeEngine");
const _securityAutopilot = lazyload<AnySub>("./autonomy/security-autopilot", "securityAutopilot");
const _selfHealer = lazyload<AnySub>("./autonomy/self-healer", "selfHealer");
const _continuousLearning = lazyload<AnySub>("./evolution/continuous-learning", "continuousLearning");
const _longTermPlanner = lazyload<AnySub>("./omega/long-term-planner", "longTermPlanner");
const _mcpEcosystem = lazyload<AnySub>("./swarm/mcp-ecosystem", "mcpEcosystem");
const _webSentience = lazyload<AnySub>("./perception/web-sentience", "webSentience");

export interface AscensionConfig {
  daemonEnabled?: boolean;
  autoDiscoverMcp?: boolean;
  watchDirectories?: string[];
  healthCheckInterval?: number;
  daemonTickInterval?: number;
}

export async function initializeAscension(config: AscensionConfig = {}): Promise<void> {
  const graph = getGraph();
  const daemon = getDaemon({ tickInterval: config.daemonTickInterval || 5000 });

  // Initialize autonomy subsystems (selfHealer, initiativeEngine, securityAutopilot)
  const selfHealer = await _selfHealer();
  const initiativeEngine = await _initiativeEngine();
  const securityAutopilot = await _securityAutopilot();
  selfHealer.init();
  initiativeEngine.init();
  securityAutopilot.init();

  bus.emit(Topics.SYSTEM_STARTUP, {
    version: "1.10.0",
    subsystems: [
      "event-bus", "state-graph", "daemon",
      "goal-decomposer", "episodic-memory", "theory-of-mind",
      "environment-sensor", "web-sentience",
      "initiative-engine", "self-healer", "security-autopilot",
      "mcp-ecosystem", "continuous-learning", "long-term-planner",
    ],
  }, { source: "ascension-bootstrap" });

  if (config.daemonEnabled !== false) {
    daemon.start();
  }

  // Lazy daemon tasks — subsystems loaded only when their task fires
  daemon.registerTask(Daemon.createIntervalTask(
    "ascension:health-monitor",
    async () => {
      const h = _cache.get("./autonomy/self-healer#selfHealer") || await _selfHealer();
      bus.emit(Topics.HEALTH_CHECK, h.getHealthStatus(), { source: "ascension-bootstrap" });
    },
    config.healthCheckInterval || 300000
  ));

  daemon.registerTask(Daemon.createIntervalTask(
    "ascension:env-refresh",
    async () => {
      const envSensor = await _environmentSensor();
      const eng = await _initiativeEngine();
      const changes = envSensor.detectEnvironmentChanges();
      if (Object.keys(changes).length > 0) {
        eng.evaluate("maintenance",
          `Environment changed: ${Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(", ")}`,
          0.3, 0.2);
      }
    },
    60000
  ));

  daemon.registerTask(Daemon.createIdleTask(
    "ascension:memory-consolidation",
    async () => {
      const epMem = await _episodicMemory();
      const compressed = await epMem.compressEpisodes();
      await epMem.dreamConsolidation();
      if (compressed > 0) {
        bus.emit(Topics.MEMORY_CONSOLIDATED, { compressed }, { source: "ascension-bootstrap" });
      }
    }
  ));

  daemon.registerTask(Daemon.createIdleTask(
    "ascension:security-scan",
    async () => {
      const secAuto = await _securityAutopilot();
      const score = secAuto.getSecurityScore();
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
      const contLearn = await _continuousLearning();
      const stats = contLearn.getStats();
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
      const ltp = await _longTermPlanner();
      const advice = ltp.getStrategicAdvice();
      if (advice.length > 0) {
        bus.emit(Topics.PROACTIVE_ACTION, {
          type: "strategic_advice",
          advice,
        }, { source: "ascension-bootstrap" });
      }
    },
    3600000
  ));

  // MCP auto-discovery
  if (config.autoDiscoverMcp !== false) {
    const mcp = await _mcpEcosystem();
    mcp.autoDiscoverServers().catch(() => {});
  }

  // Environment watchers
  const envSensor = await _environmentSensor();
  if (config.watchDirectories) {
    for (const dir of config.watchDirectories) {
      envSensor.watchDirectory(dir, true);
    }
  }
  envSensor.watchDirectory(process.cwd(), false);
  envSensor.watchDirectory(os.homedir() + "/.pi/agent", false);

  // Event listeners (subsystems loaded lazily on first event)
  bus.on(Topics.MESSAGE_RECEIVED, async (event) => {
    daemon.reportUserActivity();
    if (event.data?.role === "user") {
      const toM = await _theoryOfMind();
      toM.analyzeUserMessage("default", event.data.content || "");
    }
  });

  bus.on(Topics.USER_FEEDBACK, async (event) => {
    const contLearn = await _continuousLearning();
    contLearn.learnFromCorrection({
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
    const [contLearn, secAuto] = await Promise.all([
      _continuousLearning(),
      _securityAutopilot(),
    ]);
    contLearn.learnFromToolCall({
      input: event.data.toolName || "unknown",
      output: "",
      context: event.data.task || "",
      success: false,
      tags: ["error", "tool"],
    });
    secAuto.scanFile(event.data.filePath || "");
  });

  bus.on(Topics.SYSTEM_ERROR, async (event) => {
    const h = await _selfHealer();
    h.handleError(event.data.source, event.data.error || event.data.message);
  });

  bus.on(Topics.GOAL_DECOMPOSED, async (event) => {
    const gd = await _goalDecomposer();
    const plan = gd.getPlan(event.data.planId);
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

  const destroyIfLoaded = (key: string) => {
    const sub = _cache.get(key);
    if (sub && typeof sub.destroy === "function") {
      try { sub.destroy(); } catch { /* skip */ }
    }
  };

  destroyIfLoaded("./autonomy/self-healer#selfHealer");
  destroyIfLoaded("./autonomy/initiative-engine#initiativeEngine");
  destroyIfLoaded("./autonomy/security-autopilot#securityAutopilot");
  destroyIfLoaded("./cognition/episodic-memory#episodicMemory");
  destroyIfLoaded("./perception/environment-sensor#environmentSensor");
  destroyIfLoaded("./perception/web-sentience#webSentience");

  console.log("[Ascension] All subsystems shut down.");
}
