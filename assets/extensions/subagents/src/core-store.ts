import type { MemoryEntry, MemoryStats, MemoryType, SkillMeta } from "./memory-types";
import { embed, cosineSimilarity } from "./memory-embedding";
import { logger } from "./logger";
import { encryptMemory, decryptMemory } from "./memory-encryption";
import { assignAndUpdate } from "./ann-cluster";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const MEMORY_DIR = path.join(os.homedir(), ".pi/agent/memory");
const SEMANTIC_FILE = path.join(MEMORY_DIR, "semantic.json");

let cache: MemoryEntry[] | null = null;
let cacheTs = 0;
const CACHE_TTL = 30_000;

let writeQueue = Promise.resolve();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let debounceResolve: (() => void) | null = null;
let pendingEntries: MemoryEntry[] | null = null;
const DEBOUNCE_MS = 500;

function ensureDirs(): void {
  if (ensureDirs._done) return;
  ensureDirs._done = true;
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}
ensureDirs._done = false;

function migrateEntry(e: any): MemoryEntry {
  return {
    id: e.id,
    content: e.content,
    type: e.type,
    importance: e.importance ?? 5,
    project: e.project ?? "global",
    embedding: e.embedding ?? [],
    tags: e.tags ?? [],
    created: e.created ?? new Date().toISOString(),
    lastAccessed: e.lastAccessed ?? e.created ?? new Date().toISOString(),
    accessCount: e.accessCount ?? 0,
    retrievalCount: e.retrievalCount ?? 0,
    retrievalSuccessCount: e.retrievalSuccessCount ?? 0,
    ttl: e.ttl ?? new Date(Date.now() + 90 * 86_400_000).toISOString(),
    deprecated: e.deprecated ?? false,
    correctedById: e.correctedById ?? undefined,
    skillMeta: e.skillMeta ?? undefined,
  };
}

function safeWriteFileSync(filePath: string, data: string): void {
  const tmpPath = filePath + ".tmp." + Date.now();
  fs.writeFileSync(tmpPath, data, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export async function loadEntries(): Promise<MemoryEntry[]> {
  ensureDirs();
  const now = Date.now();
  if (cache && now - cacheTs < CACHE_TTL) {
    return cache;
  }
  try {
    const raw = fs.readFileSync(SEMANTIC_FILE, "utf8");
    const decrypted = decryptMemory(raw) || raw;
    const rawEntries: any[] = JSON.parse(decrypted);
    const entries = rawEntries.map(migrateEntry);
    const valid = entries.filter(e => !e.ttl || new Date(e.ttl).getTime() > now);
    if (valid.length !== entries.length) {
      await saveAllEntries(valid);
    }
    cache = valid;
    cacheTs = now;
    return valid;
  } catch {
    cache = [];
    cacheTs = now;
    return cache;
  }
}

export async function saveAllEntries(entries: MemoryEntry[]): Promise<void> {
  ensureDirs();
  cache = entries;
  cacheTs = Date.now();
  const plaintext = JSON.stringify(entries, null, 2);
  const encrypted = await encryptMemory(plaintext);
  safeWriteFileSync(SEMANTIC_FILE, encrypted);
}

export function loadSync(): MemoryEntry[] {
  ensureDirs();
  const now = Date.now();
  if (cache && now - cacheTs < CACHE_TTL) return cache;
  try {
    const raw = fs.readFileSync(SEMANTIC_FILE, "utf8");
    const decrypted = decryptMemory(raw);
    cache = JSON.parse(decrypted).map(migrateEntry);
    cacheTs = now;
    return cache!;
  } catch {
    cache = [];
    cacheTs = now;
    return cache!;
  }
}

export function genId(content: string): string {
  return crypto.createHash("sha256").update(content + Date.now()).digest("hex").slice(0, 16);
}

export function computeAdaptiveTTL(importance: number, accessCount: number): number {
  const baseDays = 90;
  const accessFactor = 1 + Math.log2(Math.max(1, accessCount));
  const importanceFactor = importance / 5;
  return Math.round(baseDays * accessFactor * importanceFactor);
}

export function recalibrateNow(entry: MemoryEntry): void {
  const ageMs = Date.now() - new Date(entry.created).getTime();
  const daysSinceCreation = Math.max(0.01, ageMs / 86_400_000);
  const accessRate = entry.accessCount / daysSinceCreation;

  if (entry.deprecated) {
    const currentTtl = new Date(entry.ttl).getTime();
    const fasterExpiry = Date.now() + 7 * 86_400_000;
    if (fasterExpiry < currentTtl) {
      entry.ttl = new Date(fasterExpiry).toISOString();
    }
    return;
  }

  const retrievalSuccessRate =
    entry.retrievalCount > 0
      ? entry.retrievalSuccessCount / entry.retrievalCount
      : 0.5;

  let newImportance = entry.importance;

  if (entry.type === "skill") {
    if (accessRate > 0.3) {
      newImportance = Math.min(10, entry.importance + 0.3);
    }
    if (entry.skillMeta && entry.skillMeta.successCount > 3) {
      newImportance = Math.min(10, newImportance + 0.2);
    }
    newImportance = Math.max(6, newImportance);
  } else {
    if (accessRate > 0.5 && retrievalSuccessRate > 0.6) {
      newImportance = Math.min(10, entry.importance + 0.2);
    } else if (accessRate < 0.05 && retrievalSuccessRate < 0.2) {
      newImportance = Math.max(1, entry.importance - 0.3);
    } else if (retrievalSuccessRate > 0.8) {
      newImportance = Math.min(10, entry.importance + 0.1);
    } else if (retrievalSuccessRate < 0.1 && entry.retrievalCount > 3) {
      newImportance = Math.max(1, entry.importance - 0.5);
    }
  }

  if (newImportance !== entry.importance) {
    entry.importance = Math.round(newImportance * 10) / 10;
    const newTtlDays = computeAdaptiveTTL(entry.importance, entry.accessCount);
    entry.ttl = new Date(Date.now() + newTtlDays * 86_400_000).toISOString();
  }
}

export async function withWriteLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const prev = writeQueue;
  let nextResolve: (value: unknown) => void;
  writeQueue = new Promise(resolve => { nextResolve = resolve as (value: unknown) => void; }) as Promise<void>;
  await prev;
  try {
    return await fn();
  } finally {
    nextResolve!(undefined);
  }
}

export async function flushWrite(): Promise<void> {
  if (debounceTimer && pendingEntries) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    const plaintext = JSON.stringify(pendingEntries, null, 2);
    const encrypted = await encryptMemory(plaintext);
    safeWriteFileSync(SEMANTIC_FILE, encrypted);
    pendingEntries = null;
  }
  if (debounceResolve) {
    debounceResolve();
    debounceResolve = null;
  }
  await writeQueue;
}

export async function store(
  content: string,
  type: MemoryType,
  importance: number,
  project: string,
  tags: string[],
  ttlDays?: number,
  skillMeta?: SkillMeta,
): Promise<string> {
  const embedding = await embed(content);
  const ttlDaysFinal = ttlDays ?? computeAdaptiveTTL(importance, 1);
  const entryId = genId(content + type);

  return withWriteLock(async () => {
    const entries = await loadEntries();

    const exact = entries.find(e => e.content === content && e.type === type);
    if (exact) {
      exact.lastAccessed = new Date().toISOString();
      exact.accessCount++;
      exact.importance = Math.max(exact.importance, importance);
      if (tags.length) exact.tags = [...new Set([...exact.tags, ...tags])];
      if (exact.deprecated) exact.deprecated = false;
      recalibrateNow(exact);
      await saveAllEntries(entries);
      return exact.id;
    }

    for (const existing of entries) {
      if (existing.project === project && cosineSimilarity(embedding, existing.embedding) > 0.90) {
        existing.lastAccessed = new Date().toISOString();
        existing.accessCount++;
        existing.importance = Math.max(existing.importance, importance);
        if (tags.length) existing.tags = [...new Set([...existing.tags, ...tags])];
        if (existing.deprecated) existing.deprecated = false;
        recalibrateNow(existing);
        await saveAllEntries(entries);
        return existing.id;
      }
    }

    const ttl = new Date(Date.now() + ttlDaysFinal * 86_400_000).toISOString();
    const entry: MemoryEntry = {
      id: entryId,
      content,
      type,
      importance,
      project,
      embedding,
      tags,
      created: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      accessCount: 1,
      retrievalCount: 0,
      retrievalSuccessCount: 0,
      ttl,
      deprecated: false,
      skillMeta,
    };

    recalibrateNow(entry);
    entries.push(entry);
    await saveAllEntries(entries);
    assignAndUpdate(embedding, entryId);
    return entry.id;
  });
}

export async function remove(id: string): Promise<boolean> {
  return withWriteLock(async () => {
    const entries = await loadEntries();
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    entries.splice(idx, 1);
    await saveAllEntries(entries);
    return true;
  });
}

export async function markContradicted(oldContent: string, newEntryId: string): Promise<void> {
  return withWriteLock(async () => {
    const entries = await loadEntries();
    const match = entries.find(e => e.content === oldContent);
    if (match) {
      match.deprecated = true;
      match.correctedById = newEntryId;
      match.ttl = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await saveAllEntries(entries);
    }
  });
}

export function stats(): MemoryStats {
  const entries = loadSync();
  const byType: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  let totalImp = 0;
  let oldest = entries[0]?.created || new Date().toISOString();
  let newest = entries[0]?.created || new Date().toISOString();
  let deprecatedCount = 0;
  let totalRetrievalSuccess = 0;
  let totalRetrievalCount = 0;

  for (const e of entries) {
    if (e.deprecated) {
      deprecatedCount++;
      continue;
    }
    byType[e.type] = (byType[e.type] || 0) + 1;
    byProject[e.project] = (byProject[e.project] || 0) + 1;
    totalImp += e.importance;
    if (e.created < oldest) oldest = e.created;
    if (e.created > newest) newest = e.created;
    totalRetrievalCount += e.retrievalCount;
    totalRetrievalSuccess += e.retrievalSuccessCount;
  }

  const EPISODES_DIR = path.join(MEMORY_DIR, "episodes");
  let epCount = 0;
  if (fs.existsSync(EPISODES_DIR)) {
    try { epCount = fs.readdirSync(EPISODES_DIR).filter(f => f.endsWith(".md")).length; } catch { logger.warn("Failed to read episodes dir"); }
  }

  return {
    totalEntries: entries.length,
    byType,
    byProject,
    oldestEntry: oldest,
    newestEntry: newest,
    averageImportance: entries.length ? +(totalImp / entries.length).toFixed(1) : 0,
    totalEpisodes: epCount,
    deprecatedCount,
    avgRetrievalSuccess: totalRetrievalCount > 0 ? +(totalRetrievalSuccess / totalRetrievalCount).toFixed(2) : 0,
  };
}

export function getRecent(k = 5): MemoryEntry[] {
  return loadSync()
    .filter(e => !e.deprecated)
    .sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime())
    .slice(0, k);
}

export function getTopByPriority(k = 5, project?: string): MemoryEntry[] {
  const entries = loadSync().filter(e => !e.deprecated);
  const now = Date.now();
  const recencyMultiplier = (lastAccessed: string): number => {
    const elapsed = now - new Date(lastAccessed).getTime();
    const oneDay = 86_400_000;
    const oneWeek = 7 * oneDay;
    if (elapsed < oneDay) return 0.10;
    if (elapsed < oneWeek) return 0.05;
    return 0;
  };

  const scored = entries.map(e => {
    const recency = recencyMultiplier(e.lastAccessed);
    const importance = e.importance / 10;
    const accessFreq = e.accessCount / Math.max(1, (now - new Date(e.created).getTime()) / 86_400_000);
    const freqScore = Math.min(1, accessFreq / 2);
    const priority = importance * 0.4 + recency * 0.3 + freqScore * 0.3;
    return { entry: e, score: priority };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(s => s.entry);
}

export function getSkills(k?: number): MemoryEntry[] {
  return loadSync()
    .filter(e => e.type === "skill" && !e.deprecated)
    .sort((a, b) => {
      const aScore = (a.importance || 0) + (a.skillMeta?.successCount || 0) * 2;
      const bScore = (b.importance || 0) + (b.skillMeta?.successCount || 0) * 2;
      return bScore - aScore;
    })
    .slice(0, k ?? 5);
}

export async function searchExisting(query: string): Promise<MemoryEntry | null> {
  const entries = (await loadEntries()).filter(e => !e.deprecated);
  if (!entries.length) return null;
  const qv = await embed(query);
  let best: MemoryEntry | null = null;
  let bestScore = 0;
  for (const entry of entries) {
    const sim = cosineSimilarity(qv, entry.embedding);
    if (sim > bestScore) {
      bestScore = sim;
      best = entry;
    }
    if (bestScore > 0.98) break;
  }
  return bestScore > 0.85 ? best : null;
}
