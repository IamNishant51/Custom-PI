import { getSystemStore } from "./system-store";
import { logger } from "./logger";

export interface TelemetryEvent {
  id: string;
  timestamp: number;
  type: "metric" | "log" | "span" | "event";
  level: "debug" | "info" | "warn" | "error";
  domain: "runtime" | "agent" | "tool" | "network" | "persistence";
  name: string;
  payload: Record<string, unknown>;
  duration?: number;
  error?: { message: string; stack?: string; code?: string };
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}

const BUFFER_FLUSH_MS = 100;
const MAX_BUFFER_SIZE = 500;

let _pipeline: TelemetryPipeline | null = null;

export function getTelemetryPipeline(): TelemetryPipeline {
  if (!_pipeline) {
    _pipeline = new TelemetryPipeline();
  }
  return _pipeline;
}

export function resetTelemetryPipeline(): void {
  if (_pipeline) {
    _pipeline.stop();
    _pipeline = null;
  }
}

export class TelemetryPipeline {
  private buffer: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private eventCount = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.flushTimer = setInterval(() => this.flush(), BUFFER_FLUSH_MS);
    if (typeof this.flushTimer === "object" && typeof this.flushTimer === "object" && "unref" in (this.flushTimer as any)) {
      (this.flushTimer as any).unref();
    }
  }

  stop(): void {
    this.running = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  emit(event: Omit<TelemetryEvent, "id" | "timestamp">): void {
    this.eventCount++;
    const ev: TelemetryEvent = {
      id: `evt_${Date.now()}_${this.eventCount}`,
      timestamp: Date.now(),
      ...event,
    };
    this.buffer.push(ev);
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flush();
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      const store = getSystemStore();
      for (const ev of batch) {
        try {
          store.kvSet("telemetry", ev.id, JSON.stringify(ev));
        } catch {}
      }
    } catch {}
  }

  getBufferSize(): number {
    return this.buffer.length;
  }
}

const _activeSpans = new Map<string, { startTime: number; event: Omit<TelemetryEvent, "id" | "timestamp"> }>();

export function startSpan(
  name: string,
  domain: TelemetryEvent["domain"],
  traceId?: string,
  parentSpanId?: string,
): string {
  const spanId = `span_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pipeline = getTelemetryPipeline();
  pipeline.emit({
    type: "span",
    level: "info",
    domain,
    name,
    payload: {},
    traceId,
    spanId,
    parentSpanId,
  });
  _activeSpans.set(spanId, { startTime: Date.now(), event: { type: "span", level: "info", domain, name, payload: {} } });
  return spanId;
}

export function endSpan(spanId: string, payload?: Record<string, unknown>): void {
  const span = _activeSpans.get(spanId);
  if (!span) return;
  _activeSpans.delete(spanId);
  const duration = Date.now() - span.startTime;
  const pipeline = getTelemetryPipeline();
  pipeline.emit({
    type: "span",
    level: "info",
    domain: span.event.domain,
    name: span.event.name,
    payload: { ...span.event.payload, ...payload, duration },
    duration,
    spanId,
  });
}

export function emitMetric(
  name: string,
  value: number,
  domain: TelemetryEvent["domain"] = "runtime",
  tags?: Record<string, unknown>,
): void {
  getTelemetryPipeline().emit({
    type: "metric",
    level: "info",
    domain,
    name,
    payload: { value, ...tags },
  });
}

export function emitLog(
  level: TelemetryEvent["level"],
  domain: TelemetryEvent["domain"],
  message: string,
  payload?: Record<string, unknown>,
): void {
  getTelemetryPipeline().emit({
    type: "log",
    level,
    domain,
    name: message,
    payload: payload || {},
  });
}
