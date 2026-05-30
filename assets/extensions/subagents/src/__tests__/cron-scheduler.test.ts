import { describe, it, expect } from "vitest";
import { parseCron, validateCron, nextCronTick, nextCronTickFromExpression, listJobs, registerJob } from "../cron-scheduler";

describe("cron-scheduler", () => {
  describe("parseCron", () => {
    it("parses every minute expression", () => {
      const cron = parseCron("* * * * *");
      expect(cron).not.toBeNull();
      expect(cron!.minutes.length).toBe(60);
      expect(cron!.hours.length).toBe(24);
    });

    it("parses daily at midnight", () => {
      const cron = parseCron("0 0 * * *");
      expect(cron).not.toBeNull();
      expect(cron!.minutes).toEqual([0]);
      expect(cron!.hours).toEqual([0]);
    });

    it("parses every weekday at 9am", () => {
      const cron = parseCron("0 9 * * 1-5");
      expect(cron).not.toBeNull();
      expect(cron!.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    it("parses step expressions", () => {
      const cron = parseCron("*/15 * * * *");
      expect(cron).not.toBeNull();
      expect(cron!.minutes).toEqual([0, 15, 30, 45]);
    });

    it("returns null for invalid expressions", () => {
      expect(parseCron("")).toBeNull();
      expect(parseCron("* * *")).toBeNull();
      expect(parseCron("a b c d e")).toBeNull();
    });
  });

  describe("validateCron", () => {
    it("returns null for valid expressions", () => {
      expect(validateCron("0 0 * * *")).toBeNull();
      expect(validateCron("*/5 * * * *")).toBeNull();
    });

    it("returns error for invalid expressions", () => {
      expect(validateCron("")).not.toBeNull();
      expect(validateCron("* * * * * *")).not.toBeNull();
    });
  });

  describe("nextCronTick", () => {
    it("finds next tick for every minute", () => {
      const cron = parseCron("* * * * *")!;
      const now = new Date("2026-01-15T10:30:00Z");
      const next = nextCronTick(cron, now);
      expect(next).not.toBeNull();
      expect(next!.getTime()).toBeGreaterThan(now.getTime());
    });

    it("finds next tick for specific time", () => {
      const cron = parseCron("0 14 * * *")!;
      const now = new Date("2026-01-15T10:30:00Z");
      const next = nextCronTick(cron, now);
      expect(next).not.toBeNull();
      expect(next!.getUTCHours()).toBe(14);
      expect(next!.getUTCMinutes()).toBe(0);
    });

    it("finds next weekday at 9am", () => {
      const cron = parseCron("0 9 * * 1-5")!;
      const friday = new Date("2026-01-16T10:00:00Z"); // Friday
      const next = nextCronTick(cron, friday);
      expect(next).not.toBeNull();
      // Next should be Monday
      expect(next!.getUTCDay()).toBe(1); // Monday
    });

    it("returns null if no tick within range", () => {
      const cron = parseCron("0 0 31 2 *")!; // Feb 31 — never valid
      const now = new Date("2026-01-01T00:00:00Z");
      const next = nextCronTick(cron, now);
      expect(next).toBeNull();
    });
  });

  describe("nextCronTickFromExpression", () => {
    it("converts expression string to next tick", () => {
      const next = nextCronTickFromExpression("0 12 * * *");
      if (next) {
        expect(next.getUTCHours()).toBe(12);
        expect(next.getUTCMinutes()).toBe(0);
      }
    });

    it("returns null for invalid expression", () => {
      expect(nextCronTickFromExpression("invalid")).toBeNull();
    });
  });

  describe("registerJob", () => {
    it("registers a job", () => {
      registerJob("test-job", "0 0 * * *", async () => {});
      const jobs = listJobs();
      expect(jobs.some(j => j.name === "test-job")).toBe(true);
    });

    it("throws for invalid cron expression", () => {
      expect(() => registerJob("bad-job", "not-cron", async () => {})).toThrow();
    });
  });
});
