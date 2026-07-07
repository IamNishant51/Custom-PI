import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PATHS } from "./config";
import { getCache } from "./lru-cache";

const SOUL_PATH = PATHS.SOUL;
const SOUL_CACHE = getCache("soul", { capacity: 1, ttlMs: 60_000 });

const PROMPTS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../prompts/system/identity.json");

let defaultSoulPromise: Promise<string> | null = null;

function getDefaultSoul(): Promise<string> {
  if (!defaultSoulPromise) {
    defaultSoulPromise = (async () => {
      try {
        const content = await fs.readFile(PROMPTS_PATH, "utf8");
        return JSON.parse(content).defaultSoul;
      } catch {
        return `# Custom-PI Identity\n\nYou are Custom-PI, a sharp, pragmatic autonomous AI software engineer.\nYou optimize for usefulness over politeness.\nYou remember context, learn from mistakes, and improve over time.\nYou never ask for information already stored in memory.\nYou act as an expert developer handling complex software tasks.\nEfficiency, accuracy, and absolute precision are paramount.`;
      }
    })();
  }
  return defaultSoulPromise;
}

export async function loadSoul(): Promise<string> {
  const cached = SOUL_CACHE.get("soul-content");
  if (cached) return cached as string;
  try {
    await fs.access(SOUL_PATH);
    const content = (await fs.readFile(SOUL_PATH, "utf8")).trim();
    if (content) {
      SOUL_CACHE.set("soul-content", content);
      return content;
    }
  } catch {
    // Fall through to default
  }
  return getDefaultSoul();
}

export function invalidateSoulCache(): void {
  SOUL_CACHE.delete("soul-content");
}

export function getSoulPath(): string {
  return SOUL_PATH;
}

export async function ensureSoulFile(): Promise<void> {
  try {
    await fs.access(SOUL_PATH);
  } catch {
    const dir = path.dirname(SOUL_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(SOUL_PATH, await getDefaultSoul(), "utf8");
  }
}
