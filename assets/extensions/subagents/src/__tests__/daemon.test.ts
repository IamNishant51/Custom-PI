import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Daemon, getDaemon } from "../daemon/daemon";

describe("Daemon", () => {
  let daemon: Daemon;

  beforeEach(() => {
    daemon = new Daemon({ tickInterval: 100, idleThreshold: 5000, stateFile: "/tmp/test-daemon.json" });
  });

  afterEach(() => {
    daemon.stop();
  });

  it("starts and stops", () => {
    daemon.start();
    expect(daemon.getState()).toBe("idle");
    daemon.stop();
    expect(daemon.getState()).toBe("shutdown");
  });

  it("registers and unregisters tasks", () => {
    const task = Daemon.createIntervalTask("test-task", vi.fn(), 1000);
    daemon.registerTask(task);
    expect(daemon.getTasks()).toHaveLength(1);
    expect(daemon.getTasks()[0].id).toContain("test-task");

    daemon.unregisterTask(task.id);
    expect(daemon.getTasks()).toHaveLength(0);
  });

  it("reports user activity resets idle state", () => {
    daemon.start();
    expect(daemon.isIdle()).toBe(false);
    daemon.reportUserActivity();
    expect(daemon.isIdle()).toBe(false);
    daemon.stop();
  });

  it("creates idle tasks with correct structure", () => {
    const fn = vi.fn();
    const task = Daemon.createIdleTask("idle-check", fn, "low");
    expect(task.id).toContain("idle_");
    expect(task.runsOnIdle).toBe(true);
    expect(task.priority).toBe("low");
  });

  it("creates interval tasks with correct structure", () => {
    const fn = vi.fn();
    const task = Daemon.createIntervalTask("heartbeat", fn, 5000, "high");
    expect(task.id).toContain("int_");
    expect(task.interval).toBe(5000);
    expect(task.priority).toBe("high");
  });

  it("creates scheduled tasks with correct structure", () => {
    const fn = vi.fn();
    const future = Date.now() + 60000;
    const task = Daemon.createScheduledTask("future-action", fn, future, "critical");
    expect(task.id).toContain("sched_");
    expect(task.scheduledAt).toBe(future);
    expect(task.priority).toBe("critical");
  });

  it("getUptime returns positive value after start", async () => {
    daemon.start();
    await new Promise(r => setTimeout(r, 50));
    expect(daemon.getUptime()).toBeGreaterThan(10);
    daemon.stop();
  });

  it("getStats returns metrics", () => {
    const stats = daemon.getStats();
    expect(stats).toHaveProperty("uptime");
    expect(stats).toHaveProperty("totalTicks");
    expect(stats).toHaveProperty("tasksExecuted");
    expect(stats).toHaveProperty("tasksFailed");
    expect(stats).toHaveProperty("currentState");
  });

  it("singleton getDaemon returns same instance", () => {
    const d1 = getDaemon({ stateFile: "/tmp/test-daemon-singleton.json" });
    const d2 = getDaemon({ stateFile: "/tmp/test-daemon-singleton.json" });
    expect(d1).toBe(d2);
  });
});
