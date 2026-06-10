import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const tmpDir = vi.hoisted(() => {
  const f = require("node:fs");
  const p = require("node:path");
  const o = require("node:os");
  return f.mkdtempSync(p.join(o.tmpdir(), "pi-tel-"));
});

vi.mock("node:os", () => {
  const actual = require("node:os");
  const ns = { ...actual, homedir: () => tmpDir };
  return { default: ns, ...ns };
});

import { TelemetryPipeline, resetTelemetryPipeline, getTelemetryPipeline, startSpan, endSpan, emitMetric, emitLog } from "../telemetry-pipeline";
import { resetSystemStore } from "../system-store";

describe("telemetry-pipeline", () => {
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    resetSystemStore();
    resetTelemetryPipeline();
  });

  it("emits an event and buffers it", () => {
    const pipe = getTelemetryPipeline();
    pipe.emit({ type: "log", level: "info", domain: "runtime", name: "test", payload: {} });
    expect(pipe.getBufferSize()).toBe(1);
  });

  it("startSpan and endSpan creates and completes a span", () => {
    const spanId = startSpan("test-span", "runtime");
    expect(spanId).toBeTruthy();
    endSpan(spanId);
    const pipe = getTelemetryPipeline();
    expect(pipe.getBufferSize()).toBe(2);
  });

  it("emitMetric records a metric event", () => {
    emitMetric("test.metric", 42, "runtime");
    const pipe = getTelemetryPipeline();
    expect(pipe.getBufferSize()).toBe(1);
  });

  it("emitLog records a log event", () => {
    emitLog("info", "runtime", "test log", { key: "value" });
    const pipe = getTelemetryPipeline();
    expect(pipe.getBufferSize()).toBe(1);
  });

  it("flush writes events to SQLite", () => {
    const pipe = getTelemetryPipeline();
    pipe.emit({ type: "log", level: "info", domain: "runtime", name: "flush-test", payload: {} });
    pipe.emit({ type: "metric", level: "info", domain: "runtime", name: "flush-metric", payload: { value: 1 } });
    pipe.stop();
    expect(pipe.getBufferSize()).toBe(0);
  });

  it("auto-flushes when buffer exceeds max size", () => {
    const pipe = getTelemetryPipeline();
    for (let i = 0; i < 510; i++) {
      pipe.emit({ type: "log", level: "info", domain: "runtime", name: `bulk-${i}`, payload: {} });
    }
    expect(pipe.getBufferSize()).toBeLessThan(510);
  });
});
