type EventHandler<T = any> = (event: T, meta: EventMeta) => void | Promise<void>;
type EventFilter<T = any> = (event: T, meta: EventMeta) => boolean;

interface EventMeta {
  id: string;
  timestamp: number;
  source: string;
  correlationId?: string;
  causationId?: string;
  priority: number;
  topic: string;
}

interface Subscription<T = any> {
  id: string;
  handler: EventHandler<T>;
  filter?: EventFilter<T>;
  once: boolean;
  priority: number;
}

interface StoredEvent {
  id: string;
  topic: string;
  data: any;
  meta: EventMeta;
}

interface EventBusConfig {
  maxHistoryPerTopic: number;
  maxHistoryAge: number;
  replaySpeed: "sync" | "async";
  persistPath?: string;
  lazyEmit: boolean;
}

export class EventBus {
  private subscribers = new Map<string, Subscription[]>();
  private history = new Map<string, StoredEvent[]>();
  private middleware: Array<(event: StoredEvent, next: () => void) => void> = [];
  private eventCount = 0;
  private config: EventBusConfig;
  private processing = new Set<string>();

  constructor(config?: Partial<EventBusConfig>) {
    this.config = {
      maxHistoryPerTopic: 100,
      maxHistoryAge: 300_000,
      replaySpeed: "async",
      persistPath: config?.persistPath,
      lazyEmit: true,
      ...config,
    };
  }

  hasSubscribers(topic: string): boolean {
    const direct = (this.subscribers.get(topic) || []).length > 0;
    const wildcard = (this.subscribers.get("*") || []).length > 0;
    return direct || wildcard;
  }

  emit<T>(topic: string, data: T, options?: {
    source?: string;
    correlationId?: string;
    causationId?: string;
    priority?: number;
  }): string {
    const id = `evt_${Date.now()}_${++this.eventCount}_${Math.random().toString(36).slice(2, 8)}`;
    const meta: EventMeta = {
      id,
      timestamp: Date.now(),
      source: options?.source || "system",
      correlationId: options?.correlationId,
      causationId: options?.causationId,
      priority: options?.priority ?? 0,
      topic,
    };
    const stored: StoredEvent = { id, topic, data, meta };

    this.storeEvent(stored);
    this.pruneHistory();

    // Run middleware chain synchronously before delivering to subscribers
    const runMiddlewareSync = (event: StoredEvent): void => {
      let idx = 0;
      const next = () => {
        if (idx < this.middleware.length) {
          this.middleware[idx++](event, next);
        }
      };
      next();
    };
    runMiddlewareSync(stored);

    const subs = this.subscribers.get(topic) || [];
    const wildcardSubs = this.subscribers.get("*") || [];

    if (this.config.lazyEmit && subs.length === 0 && wildcardSubs.length === 0) {
      return id;
    }

    const allSubs = [...subs, ...wildcardSubs].sort((a, b) => b.priority - a.priority);
    for (const sub of allSubs) {
      const wrapped = { data, meta };
      if (sub.filter && !sub.filter(wrapped, meta)) continue;
      try {
        const result = sub.handler(wrapped, meta);
        if (result instanceof Promise) {
          result.catch(err => console.error(`[EventBus] Handler error for ${topic}:`, err));
        }
      } catch (err) {
        console.error(`[EventBus] Handler error for ${topic}:`, err);
      }
      if (sub.once) {
        this.unsubscribe(sub.id);
      }
    }

    return id;
  }

  emitAsync<T>(topic: string, data: T, options?: {
    source?: string;
    correlationId?: string;
    causationId?: string;
    priority?: number;
  }): Promise<string> {
    const id = this.emit(topic, data, options);
    return Promise.resolve(id);
  }

  on(topic: string, handler: EventHandler, options?: {
    filter?: EventFilter;
    priority?: number;
  }): string {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sub: Subscription = {
      id,
      handler,
      filter: options?.filter,
      once: false,
      priority: options?.priority ?? 0,
    };
    const existing = this.subscribers.get(topic) || [];
    existing.push(sub);
    this.subscribers.set(topic, existing);
    return id;
  }

  once(topic: string, handler: EventHandler, options?: {
    filter?: EventFilter;
    priority?: number;
  }): string {
    const id = `sub_once_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sub: Subscription = {
      id,
      handler,
      filter: options?.filter,
      once: true,
      priority: options?.priority ?? 0,
    };
    const existing = this.subscribers.get(topic) || [];
    existing.push(sub);
    this.subscribers.set(topic, existing);
    return id;
  }

  unsubscribe(id: string): boolean {
    for (const [topic, subs] of this.subscribers) {
      const idx = subs.findIndex(s => s.id === id);
      if (idx !== -1) {
        subs.splice(idx, 1);
        if (subs.length === 0) this.subscribers.delete(topic);
        return true;
      }
    }
    return false;
  }

  use(middleware: (event: StoredEvent, next: () => void) => void): void {
    this.middleware.push(middleware);
  }

  getHistory(topic: string, limit = 50): StoredEvent[] {
    const events = this.history.get(topic) || [];
    return events.slice(-limit);
  }

  getAllTopics(): string[] {
    return Array.from(this.history.keys());
  }

  getEventCount(): number {
    return this.eventCount;
  }

  replay(topic: string, handler: EventHandler, options?: {
    since?: number;
    limit?: number;
    filter?: EventFilter;
  }): void {
    const events = this.getHistory(topic, options?.limit || 100);
    const filtered = options?.since
      ? events.filter(e => e.meta.timestamp >= options.since!)
      : events;
    for (const event of filtered) {
      if (options?.filter && !options.filter(event.data, event.meta)) continue;
      handler(event.data, event.meta);
    }
  }

  clearTopic(topic: string): void {
    this.history.delete(topic);
  }

  clearAll(): void {
    this.history.clear();
    this.subscribers.clear();
    this.eventCount = 0;
  }

  subscriberCount(topic: string): number {
    return (this.subscribers.get(topic) || []).length;
  }

  private storeEvent(event: StoredEvent): void {
    const existing = this.history.get(event.topic) || [];
    existing.push(event);
    if (existing.length > this.config.maxHistoryPerTopic) {
      existing.splice(0, existing.length - this.config.maxHistoryPerTopic);
    }
    this.history.set(event.topic, existing);
  }

  private pruneHistory(): void {
    const cutoff = Date.now() - this.config.maxHistoryAge;
    for (const [topic, events] of this.history) {
      const pruned = events.filter(e => e.meta.timestamp >= cutoff);
      if (pruned.length < events.length) {
        if (pruned.length === 0) this.history.delete(topic);
        else this.history.set(topic, pruned);
      }
    }
  }

  getQueueDepth(): number {
    return this.eventCount - this.processing.size;
  }
}

export const bus = new EventBus({ maxHistoryPerTopic: 1000 });

export const Topics = {
  // System lifecycle
  SYSTEM_STARTUP: "system.startup",
  SYSTEM_SHUTDOWN: "system.shutdown",
  SYSTEM_ERROR: "system.error",
  SYSTEM_WARNING: "system.warning",

  // Session lifecycle
  SESSION_START: "session.start",
  SESSION_END: "session.end",
  SESSION_CHECKPOINT: "session.checkpoint",

  // Message lifecycle
  MESSAGE_RECEIVED: "message.received",
  MESSAGE_SENT: "message.sent",
  MESSAGE_PROCESSED: "message.processed",

  // Tool execution
  TOOL_CALL: "tool.call",
  TOOL_RESULT: "tool.result",
  TOOL_ERROR: "tool.error",
  TOOL_BLOCKED: "tool.blocked",

  // Memory events
  MEMORY_STORED: "memory.stored",
  MEMORY_RETRIEVED: "memory.retrieved",
  MEMORY_CONSOLIDATED: "memory.consolidated",
  MEMORY_PRUNE: "memory.prune",

  // Knowledge graph
  TRIPLET_ADDED: "triplet.added",
  TRIPLET_REMOVED: "triplet.removed",
  TRIPLET_QUERIED: "triplet.queried",

  // Swarm / Agents
  AGENT_SPAWN: "agent.spawn",
  AGENT_COMPLETE: "agent.complete",
  AGENT_ERROR: "agent.error",
  AGENT_TOOL_REQUEST: "agent.tool_request",
  AGENT_TOOL_APPROVED: "agent.tool_approved",
  AGENT_TOOL_DENIED: "agent.tool_denied",

  // Deployment
  DEPLOYMENT_START: "deployment.start",
  DEPLOYMENT_STAGE: "deployment.stage",
  DEPLOYMENT_COMPLETE: "deployment.complete",
  DEPLOYMENT_ROLLBACK: "deployment.rollback",
  DEPLOYMENT_FAIL: "deployment.fail",

  // Health
  HEALTH_CHECK: "health.check",
  HEALTH_ALERT: "health.alert",
  HEALTH_RECOVER: "health.recover",

  // Rate limits
  RATE_LIMIT_BREACH: "ratelimit.breach",
  RATE_LIMIT_RECOVER: "ratelimit.recover",

  // Webhook ingestion
  WEBHOOK_RECEIVED: "webhook.received",
  INCIDENT_CREATED: "incident.created",
  INCIDENT_RESOLVED: "incident.resolved",

  // Autonomous actions
  PROACTIVE_ACTION: "proactive.action",
  GOAL_DECOMPOSED: "goal.decomposed",
  PLAN_CREATED: "plan.created",
  PLAN_UPDATED: "plan.updated",
  PLAN_COMPLETED: "plan.completed",

  // User model
  USER_ACTION: "user.action",
  USER_PREFERENCE: "user.preference",
  USER_FEEDBACK: "user.feedback",

  // Self-evolution
  SELF_AUDIT: "self.audit",
  SELF_IMPROVEMENT: "self.improvement",
  SELF_PATCH: "self.patch",

  // Daemon events
  DAEMON_TICK: "daemon.tick",
  DAEMON_IDLE: "daemon.idle",
  DAEMON_TASK: "daemon.task",

  // Perception
  FILE_CHANGED: "file.changed",
  GIT_EVENT: "git.event",
  ENVIRONMENT_CHANGE: "environment.change",
  EMAIL_RECEIVED: "email.received",

  // Finance
  COST_TRACKED: "cost.tracked",
  BUDGET_ALERT: "budget.alert",

  // Plugin
  PLUGIN_LOADED: "plugin.loaded",
  PLUGIN_ERROR: "plugin.error",

  // Metacognition
  THOUGHT_RECORDED: "thought.recorded",
  STRATEGY_SELECTED: "strategy.selected",
  CONFIDENCE_ASSESSED: "confidence.assessed",

  // Autonomous actions (Phase 1.1)
  AUTONOMOUS_ACTION: "autonomous.action",
  AUTONOMOUS_ACTION_RESULT: "autonomous.action.result",
  OPPORTUNITY_DETECTED: "opportunity.detected",
} as const;

export type TopicKey = keyof typeof Topics;
export type TopicValue = typeof Topics[TopicKey];
