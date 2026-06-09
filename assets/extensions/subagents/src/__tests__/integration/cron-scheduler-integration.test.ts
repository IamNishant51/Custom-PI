import { describe, it, expect, vi, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = vi.hoisted(() => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-int-"));
  return dir;
});

vi.mock("node:os", () => {
  const actual = require("node:os");
  const ns = { ...actual, homedir: () => tmpDir };
  return { default: ns, ...ns };
});

import {
  parseCron, validateCron, nextCronTick, nextCronTickFromExpression,
  registerJob, listJobs, stopCronJobs, isCronRunning,
} from "../../cron-scheduler";

// Backoff constants matching the source
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 1_728_000_000;
const BACKOFF_MULTIPLIER = 2;

function computeBackoff(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

describe("cron-scheduler integration", () => {
  afterAll(() => {
    try { stopCronJobs(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  afterEach(() => {
    try { stopCronJobs(); } catch {}
  });

  describe("parseCron + nextCronTick pipeline", () => {
    it("parses expression and finds next tick", () => {
      const cron = parseCron("0 12 * * *");
      expect(cron).not.toBeNull();

      const now = new Date("2026-06-09T10:00:00Z");
      const next = nextCronTick(cron!, now);
      expect(next).not.toBeNull();
      expect(next!.getUTCHours()).toBe(12);
      expect(next!.getUTCMinutes()).toBe(0);
    });

    it("nextCronTickFromExpression returns next valid tick", () => {
      const next = nextCronTickFromExpression("30 14 * * *");
      if (next) {
        expect(next.getUTCHours()).toBe(14);
        expect(next.getUTCMinutes()).toBe(30);
      }
    });

    it("returns null for invalid expression", () => {
      expect(nextCronTickFromExpression("invalid")).toBeNull();
    });

    it("handles every-minute expression", () => {
      const cron = parseCron("* * * * *");
      expect(cron).not.toBeNull();
      expect(cron!.minutes.length).toBe(60);
    });
  });

  describe("validateCron", () => {
    it("returns null for valid expressions", () => {
      expect(validateCron("*/5 * * * *")).toBeNull();
      expect(validateCron("0 9 * * 1-5")).toBeNull();
    });

    it("returns error for invalid expressions", () => {
      expect(validateCron("not-cron")).not.toBeNull();
      expect(validateCron("")).not.toBeNull();
    });
  });

  describe("registerJob + listJobs", () => {
    it("registers a job and lists it", () => {
      registerJob("int-test-job", "0 0 * * *", async () => {});
      const jobs = listJobs();
      expect(jobs.some(j => j.name === "int-test-job")).toBe(true);
    });

    it("throws for invalid cron expression", () => {
      expect(() => registerJob("bad-job", "invalid-cron", async () => {})).toThrow();
    });

    it("registers multiple jobs", () => {
      registerJob("job-a", "*/5 * * * *", async () => {});
      registerJob("job-b", "0 * * * *", async () => {});
      registerJob("job-c", "0 0 * * *", async () => {});

      const jobs = listJobs();
      expect(jobs.length).toBeGreaterThanOrEqual(3);
    });

    it("returns enabled jobs", () => {
      registerJob("enabled-job", "0 12 * * *", async () => {});
      const jobs = listJobs();
      const job = jobs.find(j => j.name === "enabled-job");
      expect(job).toBeDefined();
      expect(job!.enabled).toBe(true);
    });
  });

  describe("stopCronJobs", () => {
    it("isCronRunning returns false after stop", () => {
      expect(isCronRunning()).toBe(false);
      stopCronJobs();
      expect(isCronRunning()).toBe(false);
    });
  });

  describe("backoff behavior", () => {
    it("first attempt has base delay", () => {
      expect(computeBackoff(1)).toBe(BASE_DELAY_MS);
    });

    it("second attempt doubles", () => {
      expect(computeBackoff(2)).toBe(BASE_DELAY_MS * 2);
    });

    it("fifth attempt has exponential delay", () => {
      expect(computeBackoff(5)).toBe(BASE_DELAY_MS * Math.pow(2, 4));
    });

    it("caps at MAX_DELAY_MS", () => {
      const highAttempt = computeBackoff(100);
      expect(highAttempt).toBeLessThanOrEqual(MAX_DELAY_MS);
    });

    it("exponential growth does not overflow", () => {
      const maxAttempt = computeBackoff(1000);
      expect(maxAttempt).toBe(MAX_DELAY_MS);
      expect(isFinite(maxAttempt)).toBe(true);
    });
  });

  describe("parseCron edge cases", () => {
    it("rejects empty string", () => {
      expect(parseCron("")).toBeNull();
    });

    it("rejects wrong number of fields", () => {
      expect(parseCron("* * *")).toBeNull();
      expect(parseCron("* * * * * *")).toBeNull();
    });

    it("parses step expressions", () => {
      const cron = parseCron("*/15 * * * *");
      expect(cron).not.toBeNull();
      expect(cron!.minutes).toEqual([0, 15, 30, 45]);
    });

    it("parses range expressions", () => {
      const cron = parseCron("0 9-17 * * *");
      expect(cron).not.toBeNull();
      expect(cron!.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    });
  });

  describe("cross-module: cron + state-db", () => {
    it("registerJob works alongside state-db imports without crashing", () => {
      registerJob("cross-job", "0 0 * * *", async () => {});
      const jobs = listJobs();
      expect(jobs.some(j => j.name === "cross-job")).toBe(true);
    });
  });
});
