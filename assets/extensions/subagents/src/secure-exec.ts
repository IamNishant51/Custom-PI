import { execFileSync, spawn, type SpawnOptions } from "node:child_process";
import { getCircuitBreaker, CircuitBreakerOpenError } from "./circuit-breaker";

const ALLOWLIST = new Set([
  "bash", "sh", "node", "npm", "npx", "tsx", "ts-node",
  "git", "curl", "wget",
  "ls", "cat", "head", "tail", "grep", "rg", "find", "sort", "wc",
  "mkdir", "cp", "mv", "rm", "chmod", "chown",
  "echo", "printf", "tee",
  "python3", "python", "pip3",
  "docker", "docker-compose",
  "make", "gcc", "clang",
  "cargo", "rustc",
  "deno", "bun",
  "jq", "yq",
  "tar", "gzip", "gunzip", "unzip",
  "pwd", "which", "env",
]);

export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_TIMEOUT = 30_000;
export const MAX_TIMEOUT = 300_000;

export class CommandNotAllowedError extends Error {
  constructor(command: string) {
    super(`Command not in allowlist: ${command}`);
    this.name = "CommandNotAllowedError";
  }
}

export class CommandTimeoutError extends Error {
  constructor(command: string, timeout: number) {
    super(`Command '${command}' timed out after ${timeout}ms`);
    this.name = "CommandTimeoutError";
  }
}

export interface SecureExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  duration: number;
  truncated: boolean;
}

function checkAllowlist(binary: string): void {
  const base = binary.split("/").pop() || binary;
  if (!ALLOWLIST.has(base) && !process.env.PI_ALLOW_ALL_COMMANDS) {
    throw new CommandNotAllowedError(binary);
  }
}

export function secureExecFileSync(
  binary: string,
  args: string[],
  options?: { timeout?: number; maxOutput?: number },
): SecureExecResult {
  checkAllowlist(binary);
  const timeout = Math.min(options?.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const maxOutput = options?.maxOutput ?? MAX_OUTPUT_BYTES;
  const start = Date.now();

  try {
    const stdout = execFileSync(binary, args, {
      timeout,
      maxBuffer: maxOutput,
      encoding: "utf8",
      shell: false,
    });
    return {
      stdout: stdout.slice(0, maxOutput),
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: Date.now() - start,
      truncated: stdout.length > maxOutput,
    };
  } catch (err: any) {
    const duration = Date.now() - start;
    if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return {
        stdout: (err.stdout || "").slice(0, maxOutput),
        stderr: (err.stderr || "").slice(0, maxOutput),
        exitCode: null,
        signal: null,
        duration,
        truncated: true,
      };
    }
    return {
      stdout: (err.stdout || "").slice(0, maxOutput),
      stderr: (err.stderr || "").slice(0, maxOutput),
      exitCode: err.status ?? 1,
      signal: err.signal ?? null,
      duration,
      truncated: false,
    };
  }
}

export function secureSpawn(
  binary: string,
  args: string[],
  options?: SpawnOptions & { timeout?: number; maxOutput?: number },
): Promise<SecureExecResult> {
  const timeout = Math.min(options?.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const maxOutput = options?.maxOutput ?? MAX_OUTPUT_BYTES;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    try { checkAllowlist(binary); } catch (e) { reject(e); return; }
    const child = spawn(binary, args, {
      ...options,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        resolve({
          stdout: stdout.slice(0, maxOutput),
          stderr: stderr.slice(0, maxOutput),
          exitCode: null,
          signal: "SIGTERM",
          duration: Date.now() - start,
          truncated: stdout.length > maxOutput,
        });
      }
    }, timeout);

    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < maxOutput) stdout += chunk;
      else truncated = true;
    });

    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < maxOutput) stderr += chunk;
    });

    child.on("close", (exitCode, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: stdout.slice(0, maxOutput),
          stderr: stderr.slice(0, maxOutput),
          exitCode,
          signal,
          duration: Date.now() - start,
          truncated,
        });
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: stdout.slice(0, maxOutput),
          stderr: stderr.slice(0, maxOutput) + `\n[Error] ${err.message}`,
          exitCode: 1,
          signal: null,
          duration: Date.now() - start,
          truncated,
        });
      }
    });
  });
}

export async function secureExecWithBreaker(
  binary: string,
  args: string[],
  options?: { timeout?: number; maxOutput?: number; breaker?: string },
): Promise<SecureExecResult> {
  const breakerName = options?.breaker ?? `exec:${binary}`;
  const cb = getCircuitBreaker(breakerName, { threshold: 3, resetTimeout: 30_000 });
  return cb.call(
    () => secureSpawn(binary, args, options),
    async () => ({
      stdout: "",
      stderr: `[CircuitBreaker] ${breakerName} is open, using fallback`,
      exitCode: 1,
      signal: null,
      duration: 0,
      truncated: false,
    }),
  );
}
