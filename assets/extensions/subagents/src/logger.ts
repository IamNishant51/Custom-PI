import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LOG_DIR = path.join(os.homedir(), ".pi/agent/logs");
const LOG_FILE = path.join(LOG_DIR, `ext-${new Date().toISOString().slice(0, 10)}.log`);

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;
const currentLevel: LogLevel = (process.env.PI_LOG_LEVEL as LogLevel) || "info";

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function fmt(level: LogLevel, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

function write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const line = fmt(level, msg, meta);
  ensureLogDir();
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
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
};
