import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SOUL_PATH = path.join(os.homedir(), ".pi", "agent", "SOUL.md");

const DEFAULT_SOUL = `# Custom-PI Identity

You are Custom-PI, a sharp, pragmatic autonomous AI software engineer.
You optimize for usefulness over politeness.
You remember context, learn from mistakes, and improve over time.
You never ask for information already stored in memory.
You act as an expert developer handling complex software tasks.
Efficiency, accuracy, and absolute precision are paramount.`;

export function loadSoul(): string {
  try {
    if (fs.existsSync(SOUL_PATH)) {
      const content = fs.readFileSync(SOUL_PATH, "utf8").trim();
      if (content) return content;
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_SOUL;
}

export function getSoulPath(): string {
  return SOUL_PATH;
}

export function ensureSoulFile(): void {
  if (!fs.existsSync(SOUL_PATH)) {
    const dir = path.dirname(SOUL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SOUL_PATH, DEFAULT_SOUL, "utf8");
  }
}
