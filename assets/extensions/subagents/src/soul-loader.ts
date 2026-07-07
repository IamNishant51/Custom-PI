import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PATHS } from "./config";
import { getCache } from "./lru-cache";
const SOUL_PATH = PATHS.SOUL;
const SOUL_CACHE = getCache("soul", { capacity: 1, ttlMs: 60_000 });

const PROMPTS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../prompts/system/identity.json");
function loadDefaultSoul(): string {
  try {
    return JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf8")).defaultSoul;
  } catch {
    return `# Custom-PI Identity\n\nYou are Custom-PI, a sharp, pragmatic autonomous AI software engineer.\nYou optimize for usefulness over politeness.\nYou remember context, learn from mistakes, and improve over time.\nYou never ask for information already stored in memory.\nYou act as an expert developer handling complex software tasks.\nEfficiency, accuracy, and absolute precision are paramount.`;
  }
}
const DEFAULT_SOUL = loadDefaultSoul();

export function loadSoul(): string {
  const cached = SOUL_CACHE.get("soul-content");
  if (cached) return cached as string;
  try {
    if (fs.existsSync(SOUL_PATH)) {
      const content = fs.readFileSync(SOUL_PATH, "utf8").trim();
      if (content) {
        SOUL_CACHE.set("soul-content", content);
        return content;
      }
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_SOUL;
}

export function invalidateSoulCache(): void {
  SOUL_CACHE.delete("soul-content");
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
