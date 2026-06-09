import { describe, it, expect } from "vitest";
import { parseCron, nextCronTick, validateCron, registerJob, listJobs } from "../../assets/extensions/subagents/src/cron-scheduler";

describe("Cron Scheduler Integration Flow", () => {
  it("parses, validates, and computes next tick", () => {
    const expr = "0 9 * * 1-5";
    expect(validateCron(expr)).toBeNull();
    const parsed = parseCron(expr);
    expect(parsed).not.toBeNull();
    const next = nextCronTick(parsed!, new Date("2026-01-16T10:00:00Z"));
    expect(next).not.toBeNull();
    expect(next!.getUTCDay()).toBe(1);
    expect(next!.getUTCHours()).toBe(9);
    expect(next!.getUTCMinutes()).toBe(0);
  });

  it("registers and lists jobs end-to-end", () => {
    const before = listJobs().length;
    registerJob("e2e-test", "*/5 * * * *", async () => {});
    const after = listJobs().length;
    expect(after).toBe(before + 1);
    expect(listJobs().some(j => j.name === "e2e-test")).toBe(true);
  });
});
