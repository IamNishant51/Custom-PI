import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { PATHS } from "./config";

const LOG_DIR = PATHS.LOGS;
const LOG_FILE = path.join(LOG_DIR, `ext-${new Date().toISOString().slice(0, 10)}.log`);

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;
const currentLevel: LogLevel = (process.env.PI_LOG_LEVEL as LogLevel) || "info";

// Async write queue — non-blocking, flushed in order, capped at 1000 entries
const writeQueue: string[] = [];
let flushing = false;
const MAX_QUEUE_SIZE = 1000;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  while (writeQueue.length > 0) {
    const batch = writeQueue.splice(0, 50);
    try {
      ensureLogDir();
      await fs.promises.appendFile(LOG_FILE, batch.join(""), "utf8");
    } catch {
      // fallback to console if file write fails
      for (const line of batch) console.error(line.trim());
    }
  }
  flushing = false;
}

function enqueue(line: string): void {
  if (writeQueue.length >= MAX_QUEUE_SIZE) {
    writeQueue.shift();
  }
  writeQueue.push(line + "\n");
  if (writeQueue.length === 1) {
    setImmediate(() => { flushQueue().catch(() => {}); });
  }
}

function fmt(level: LogLevel, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

function write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const line = fmt(level, msg, meta);
  enqueue(line);
  if (level === "error" || level === "warn") {
    console.error(line);
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
  getLogFile: () => LOG_FILE,
  /** Flush any pending writes — useful before shutdown */
  flush: () => flushQueue(),
};
