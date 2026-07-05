import { describe, it, expect } from "vitest";
import { secureExecFileSync, secureSpawn, CommandNotAllowedError, CommandTimeoutError } from "../secure-exec";

describe("secureExecFileSync", () => {
  it("executes allowed commands", async () => {
    const result = await secureExecFileSync("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("rejects disallowed commands", () => {
    expect(() => secureExecFileSync("malicious_tool", [])).toThrow(CommandNotAllowedError);
  });

  it("captures stderr on failure", async () => {
    const result = await secureExecFileSync("bash", ["-c", "echo err >&2; exit 1"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.trim()).toBe("err");
  });
});

describe("secureSpawn", () => {
  it("executes and returns stdout", async () => {
    const result = await secureSpawn("echo", ["spawn test"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("spawn test");
  });

  it("rejects disallowed commands", async () => {
    await expect(secureSpawn("nonexistent_binary_xyz", [])).rejects.toThrow(CommandNotAllowedError);
  });

  it("enforces timeout", async () => {
    const result = await secureSpawn("bash", ["-c", "sleep 10"], { timeout: 50 });
    expect(result.signal).toBe("SIGTERM");
  }, 5000);
});
