import { logger } from "./logger";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const MEMORIES_DIR = path.join(os.homedir(), ".pi", "agent", "memories");
const MEMORY_PATH = path.join(MEMORIES_DIR, "MEMORY.md");
const USER_PATH = path.join(MEMORIES_DIR, "USER.md");

const MEMORY_MAX_CHARS = 2200;
const USER_MAX_CHARS = 1375;
const ENTRY_DELIMITER = "\n§ ";

function ensureDirs(): void {
  if (!fs.existsSync(MEMORIES_DIR)) fs.mkdirSync(MEMORIES_DIR, { recursive: true });
}

function readFileSafe(filePath: string): string {
  ensureDirs();
  if (!fs.existsSync(filePath)) return "";
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function writeFileAtomic(filePath: string, content: string): void {
  ensureDirs();
  const tmp = filePath + ".tmp." + Date.now();
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function parseEntries(content: string): string[] {
  if (!content.trim()) return [];
  return content.split(ENTRY_DELIMITER).map(e => e.trim()).filter(Boolean);
}

function serializeEntries(entries: string[]): string {
  if (!entries.length) return "";
  return ENTRY_DELIMITER + entries.join(ENTRY_DELIMITER) + "\n";
}

export interface MemorySnapshot {
  memory: string;
  user: string;
  memoryCapacityPct: number;
  userCapacityPct: number;
}

export interface MemoryWriteResult {
  success: boolean;
  message: string;
  newCharCount?: number;
}

export interface ConsolidationResult {
  beforeChars: number;
  afterChars: number;
}

export function ensureMemoryFiles(): void {
  ensureDirs();
  if (!fs.existsSync(MEMORY_PATH)) fs.writeFileSync(MEMORY_PATH, "", "utf8");
  if (!fs.existsSync(USER_PATH)) fs.writeFileSync(USER_PATH, "", "utf8");
}

export function loadMemorySnapshot(): MemorySnapshot {
  const memory = readFileSafe(MEMORY_PATH);
  const user = readFileSafe(USER_PATH);
  return {
    memory,
    user,
    memoryCapacityPct: Math.round((memory.length / MEMORY_MAX_CHARS) * 100),
    userCapacityPct: Math.round((user.length / USER_MAX_CHARS) * 100),
  };
}

export function readMemoryRaw(target: "memory" | "user"): string {
  return readFileSafe(target === "memory" ? MEMORY_PATH : USER_PATH);
}

function getMaxChars(target: "memory" | "user"): number {
  return target === "memory" ? MEMORY_MAX_CHARS : USER_MAX_CHARS;
}

function getFilePath(target: "memory" | "user"): string {
  return target === "memory" ? MEMORY_PATH : USER_PATH;
}

function detectExternalDrift(target: "memory" | "user"): boolean {
  const filePath = getFilePath(target);
  const content = readFileSafe(filePath);
  const entries = parseEntries(content);
  const reSerialized = serializeEntries(entries);
  const normalizedExisting = content.replace(/\r\n/g, "\n").trim();
  const normalizedReSerialized = reSerialized.trim();
  if (normalizedExisting !== normalizedReSerialized && normalizedExisting !== "") {
    const bakPath = filePath + ".bak." + Date.now();
    try {
      fs.copyFileSync(filePath, bakPath);
    } catch { logger.warn("empty catch") }
    return true;
  }
  for (const entry of entries) {
    if (entry.length > getMaxChars(target)) return true;
  }
  return false;
}

export function memoryWrite(
  action: "add" | "replace" | "remove",
  target: "memory" | "user",
  content: string,
  oldText?: string,
): MemoryWriteResult {
  ensureDirs();
  const filePath = getFilePath(target);
  const maxChars = getMaxChars(target);

  detectExternalDrift(target);

  const existing = readFileSafe(filePath);
  let entries = parseEntries(existing);

  if (action === "add") {
    if (!content.trim()) {
      return { success: false, message: "Content cannot be empty." };
    }
    if (entries.some(e => e.toLowerCase() === content.trim().toLowerCase())) {
      return { success: false, message: "Entry already exists (no duplicate added)." };
    }
    entries.push(content.trim());
    const serialized = serializeEntries(entries);
    if (serialized.length > maxChars) {
      return {
        success: false,
        message: `Memory at capacity (${serialized.length}/${maxChars}). Use memory_consolidate to free space first.`,
      };
    }
    writeFileAtomic(filePath, serialized);
    return { success: true, message: `Entry added to ${target}.`, newCharCount: serialized.length };
  }

  if (action === "remove") {
    if (!oldText) return { success: false, message: "oldText required for remove." };
    const before = entries.length;
    entries = entries.filter(e => !e.toLowerCase().includes(oldText.toLowerCase()));
    if (entries.length === before) {
      return { success: false, message: "No matching entry found to remove." };
    }
    writeFileAtomic(filePath, serializeEntries(entries));
    return { success: true, message: `Entry removed from ${target}.` };
  }

  if (action === "replace") {
    if (!oldText) return { success: false, message: "oldText required for replace." };
    if (!content.trim()) return { success: false, message: "Content cannot be empty." };
    let found = false;
    entries = entries.map(e => {
      if (e.toLowerCase().includes(oldText.toLowerCase())) {
        found = true;
        return content.trim();
      }
      return e;
    });
    if (!found) return { success: false, message: "No matching entry found to replace." };
    const serialized = serializeEntries(entries);
    if (serialized.length > maxChars) {
      return { success: false, message: `Result exceeds capacity (${serialized.length}/${maxChars}).` };
    }
    writeFileAtomic(filePath, serialized);
    return { success: true, message: `Entry replaced in ${target}.`, newCharCount: serialized.length };
  }

  return { success: false, message: `Unknown action: ${action}` };
}

export async function memoryConsolidate(target: "memory" | "user"): Promise<ConsolidationResult> {
  const filePath = getFilePath(target);
  const maxChars = getMaxChars(target);
  const content = readFileSafe(filePath);
  const beforeChars = content.length;
  if (beforeChars < maxChars * 0.8) {
    return { beforeChars, afterChars: beforeChars };
  }
  const entries = parseEntries(content);
  const consolidated = entries.join("\n\n");
  if (consolidated.length >= beforeChars) {
    const truncated = consolidated.slice(0, Math.floor(maxChars * 0.9));
    const newEntries = truncated.split("\n\n").filter(Boolean);
    writeFileAtomic(filePath, serializeEntries(newEntries));
    return { beforeChars, afterChars: newEntries.reduce((s, e) => s + e.length + 3, 0) };
  }
  writeFileAtomic(filePath, serializeEntries(entries));
  const afterContent = readFileSafe(filePath);
  return { beforeChars, afterChars: afterContent.length };
}

export function getMemoryStats(): { memoryChars: number; userChars: number; memoryMax: number; userMax: number; memoryPct: number; userPct: number } {
  const memory = readFileSafe(MEMORY_PATH);
  const user = readFileSafe(USER_PATH);
  return {
    memoryChars: memory.length,
    userChars: user.length,
    memoryMax: MEMORY_MAX_CHARS,
    userMax: USER_MAX_CHARS,
    memoryPct: Math.round((memory.length / MEMORY_MAX_CHARS) * 100),
    userPct: Math.round((user.length / USER_MAX_CHARS) * 100),
  };
}
