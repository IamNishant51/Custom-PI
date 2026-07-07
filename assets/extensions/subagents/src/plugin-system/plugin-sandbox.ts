import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const _dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export interface SandboxContext {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  message?: string;
}

export interface SandboxResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

const WORKER_SCRIPT = path.join(_dirname, "plugin-sandbox-worker.mjs");

export function executeInSandbox(
  code: string,
  hook: string,
  context: SandboxContext,
  timeoutMs = 5000,
): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;

    const worker = new Worker(WORKER_SCRIPT, {
      workerData: { code, hook, context },
      eval: false,
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate();
        resolve({ ok: false, error: "Sandbox timeout", durationMs: Date.now() - start });
      }
    }, timeoutMs);

    worker.on("message", (msg: any) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (msg && msg._error) {
          resolve({ ok: false, error: msg._error, durationMs: Date.now() - start });
        } else {
          resolve({ ok: true, data: msg, durationMs: Date.now() - start });
        }
      }
    });

    worker.on("error", (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message, durationMs: Date.now() - start });
      }
    });

    worker.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: `Worker exited with code ${code}`, durationMs: Date.now() - start });
      }
    });
  });
}
