import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Daemon } from "../daemon/daemon";
import { resetSystemStore } from "../system-store";

describe("Daemon Resilience", () => {
  let daemon: Daemon;

  beforeEach(() => {
    resetSystemStore();
    daemon = new Daemon({ tickInterval: 100000 });
  });

  afterEach(() => {
    daemon.stop();
  });

  it("starts in idle state", () => {
    expect(daemon.getState()).toBe("idle");
  });

  it("registers and lists tasks", () => {
    const task = Daemon.createIntervalTask("test-task", async () => {}, 5000);
    daemon.registerTask(task);
    const tasks = daemon.getTasks();
    expect(tasks.length).toBe(1);
    expect(tasks[0].name).toBe("test-task");
  });

  it("unregisters tasks", () => {
    const task = Daemon.createIntervalTask("removable", async () => {}, 5000);
    daemon.registerTask(task);
    expect(daemon.unregisterTask(task.id)).toBe(true);
    expect(daemon.getTasks().length).toBe(0);
  });

  it("detects idle state", () => {
    expect(daemon.isIdle()).toBe(false);
    daemon.reportUserActivity();
    expect(daemon.getIdleDuration()).toBeLessThan(1000);
  });

  it("getHealth returns healthy status", () => {
    const health = daemon.getHealth();
    expect(health.status).toBe("healthy");
    expect(health.state).toBe("idle");
    expect(typeof health.uptime).toBe("number");
  });

  it("creates idle task with correct properties", () => {
    const task = Daemon.createIdleTask("background", async () => {}, "low");
    expect(task.runsOnIdle).toBe(true);
    expect(task.priority).toBe("low");
    expect(task.name).toBe("background");
  });

  it("creates scheduled task", () => {
    const future = Date.now() + 60000;
    const task = Daemon.createScheduledTask("future", async () => {}, future, "high");
    expect(task.scheduledAt).toBe(future);
    expect(task.priority).toBe("high");
  });

  it("creates interval task", () => {
    const task = Daemon.createIntervalTask("repeating", async () => {}, 10000, "normal");
    expect(task.interval).toBe(10000);
  });

  it("stop transitions to shutdown state", () => {
    daemon.stop();
    expect(daemon.getState()).toBe("shutdown");
  });

  it("getStats returns stats object", () => {
    const stats = daemon.getStats();
    expect(stats).toHaveProperty("totalTicks");
    expect(stats).toHaveProperty("tasksExecuted");
    expect(stats).toHaveProperty("currentState");
  });
});
