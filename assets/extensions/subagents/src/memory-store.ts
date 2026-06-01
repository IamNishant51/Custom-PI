import type { MemoryEntry, SearchResult, MemoryStats, MemoryType } from "./memory-types";
import { embed, cosineSimilarity } from "./memory-embedding";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const MEMORY_DIR = path.join(os.homedir(), ".pi/agent/memory");
const SEMANTIC_FILE = path.join(MEMORY_DIR, "semantic.json");
const ANN_CLUSTERS_FILE = path.join(MEMORY_DIR, "ann-clusters.json");
const EPISODES_DIR = path.join(MEMORY_DIR, "episodes");

const ANN_CLUSTERS = 16;
const ANN_CLUSTER_SEARCH_COUNT = 3;

let cache: MemoryEntry[] | null = null;
let cacheTs = 0;
const CACHE_TTL = 30_000;

let writeQueue = Promise.resolve();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let debounceResolve: (() => void) | null = null;
let pendingEntries: MemoryEntry[] | null = null;
const DEBOUNCE_MS = 500;

interface ClusterIndex {
  centroids: number[][];
  assignments: Record<string, number>;
}

function loadClusters(): ClusterIndex {
  if (fs.existsSync(ANN_CLUSTERS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ANN_CLUSTERS_FILE, "utf8"));
    } catch {}
  }
  return { centroids: [], assignments: {} };
}

function saveClusters(idx: ClusterIndex): void {
  ensureDirs();
  safeWriteFile(ANN_CLUSTERS_FILE, JSON.stringify(idx));
}

async function saveClustersAsync(idx: ClusterIndex): Promise<void> {
  ensureDirs();
  await safeWriteFileAsync(ANN_CLUSTERS_FILE, JSON.stringify(idx));
}

function nearestCentroid(embedding: number[], centroids: number[][]): number {
  if (centroids.length === 0) return -1;
  let bestIdx = 0;
  let bestSim = -1;
  for (let i = 0; i < centroids.length; i++) {
    const sim = cosineSimilarity(embedding, centroids[i]);
    if (sim > bestSim) { bestSim = sim; bestIdx = i; }
  }
  return bestIdx;
}

function assignToCluster(embedding: number[], idx: ClusterIndex): number {
  if (idx.centroids.length < ANN_CLUSTERS) {
    const cid = idx.centroids.length;
    idx.centroids.push([...embedding]);
    return cid;
  }
  return nearestCentroid(embedding, idx.centroids);
}

function updateCentroid(embedding: number[], centroid: number[], rate: number): void {
  for (let i = 0; i < embedding.length; i++) {
    centroid[i] = centroid[i] * (1 - rate) + embedding[i] * rate;
  }
}

function ensureDirs(): void {
  if (ensureDirs._done) return;
  ensureDirs._done = true;
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  if (!fs.existsSync(EPISODES_DIR)) fs.mkdirSync(EPISODES_DIR, { recursive: true });
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

function load(): MemoryEntry[] {
  ensureDirs();
  const now = Date.now();
  if (cache && now - cacheTs < CACHE_TTL) return cache;

  if (!fs.existsSync(SEMANTIC_FILE)) {
    cache = [];
    cacheTs = now;
    return cache;
  }

  try {
    const raw = fs.readFileSync(SEMANTIC_FILE, "utf8");
    const rawEntries: any[] = JSON.parse(raw);
    const entries = rawEntries.map(migrateEntry);
    const valid = entries.filter(e => !e.ttl || new Date(e.ttl).getTime() > now);
    if (valid.length !== entries.length) {
      const json = JSON.stringify(valid, null, 2);
      fs.writeFileSync(SEMANTIC_FILE, json, "utf8");
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

function safeWriteFile(filePath: string, data: string): void {
  const tmpPath = filePath + ".tmp." + Date.now();
  fs.writeFileSync(tmpPath, data, "utf8");
  fs.renameSync(tmpPath, filePath);
}

async function safeWriteFileAsync(filePath: string, data: string): Promise<void> {
  const tmpPath = filePath + ".tmp." + Date.now();
  await fsp.writeFile(tmpPath, data, "utf8");
  await fsp.rename(tmpPath, filePath);
}

async function loadAsync(): Promise<MemoryEntry[]> {
  ensureDirs();
  const now = Date.now();
  if (cache && now - cacheTs < CACHE_TTL) return cache;
  try {
    const raw = await fsp.readFile(SEMANTIC_FILE, "utf8");
    const rawEntries: any[] = JSON.parse(raw);
    const entries = rawEntries.map(migrateEntry);
    const valid = entries.filter(e => !e.ttl || new Date(e.ttl).getTime() > now);
    if (valid.length !== entries.length) {
      await safeWriteFileAsync(SEMANTIC_FILE, JSON.stringify(valid, null, 2));
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

async function saveAsync(entries: MemoryEntry[]): Promise<void> {
  ensureDirs();
  cache = entries;
  cacheTs = Date.now();
  await safeWriteFileAsync(SEMANTIC_FILE, JSON.stringify(entries, null, 2));
}

function save(entries: MemoryEntry[]): void {
  ensureDirs();
  cache = entries;
  cacheTs = Date.now();
  pendingEntries = entries;
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (pendingEntries) {
      safeWriteFile(SEMANTIC_FILE, JSON.stringify(pendingEntries, null, 2));
      pendingEntries = null;
    }
    if (debounceResolve) {
      debounceResolve();
      debounceResolve = null;
    }
  }, DEBOUNCE_MS);
}

async function withWriteLock<T>(fn: () => T | Promise<T>): Promise<T> {
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

function mutate(fn: (entries: MemoryEntry[]) => void): void {
  const entries = load();
  fn(entries);
  save(entries);
}

function genId(content: string): string {
  return crypto.createHash("sha256").update(content + Date.now()).digest("hex").slice(0, 16);
}

function computeAdaptiveTTL(importance: number, accessCount: number): number {
  const baseDays = 90;
  const accessFactor = 1 + Math.log2(Math.max(1, accessCount));
  const importanceFactor = importance / 5;
  return Math.round(baseDays * accessFactor * importanceFactor);
}

async function reclusterCentroids(entries: MemoryEntry[]): Promise<void> {
  const active = entries.filter(e => !e.deprecated && e.embedding?.length > 0);
  if (active.length === 0) return;
  const K = Math.min(ANN_CLUSTERS, active.length);
  const dim = active[0].embedding.length;

  // 1. Sample K initial centroids via k-means++ initialization
  const centroids: number[][] = [];
  const firstIdx = Math.floor(Math.random() * active.length);
  centroids.push([...active[firstIdx].embedding]);

  for (let c = 1; c < K; c++) {
    let totalDist = 0;
    const dists = active.map(e => {
      const minDist = Math.min(...centroids.map(cent => {
        const sim = cosineSimilarity(e.embedding, cent);
        return 1 - sim;
      }));
      totalDist += minDist * minDist;
      return minDist * minDist;
    });
    const threshold = Math.random() * totalDist;
    let cum = 0;
    for (let i = 0; i < active.length; i++) {
      cum += dists[i];
      if (cum >= threshold) {
        centroids.push([...active[i].embedding]);
        break;
      }
    }
  }

  // 2. Iterate assignment + recompute (max 10 passes)
  const assignments: Record<string, number> = {};
  for (let iter = 0; iter < 10; iter++) {
    let changed = false;

    for (const entry of active) {
      const newCid = nearestCentroid(entry.embedding, centroids);
      const oldCid = assignments[entry.id];
      if (newCid !== oldCid) {
        changed = true;
        assignments[entry.id] = newCid;
      }
    }

    if (!changed && iter > 0) break;

    // Recompute centroids as mean of assigned vectors
    for (let k = 0; k < K; k++) {
      const members = active.filter(e => assignments[e.id] === k);
      if (members.length === 0) continue;
      const sum = new Array(dim).fill(0);
      for (const m of members) {
        for (let d = 0; d < dim; d++) sum[d] += m.embedding[d];
      }
      for (let d = 0; d < dim; d++) sum[d] /= members.length;
      centroids[k] = sum;
    }
  }

  await saveClustersAsync({ centroids, assignments });
}

let lastConsolidationTime = 0;
const CONSOLIDATION_COOLDOWN_MS = 120_000;

function computeRecencyMultiplier(lastAccessed: string): number {
  const elapsed = Date.now() - new Date(lastAccessed).getTime();
  const oneDay = 86_400_000;
  const oneWeek = 7 * oneDay;
  if (elapsed < oneDay) return 0.10;
  if (elapsed < oneWeek) return 0.05;
  return 0;
}

function computeKeywordMultiplier(query: string, entry: MemoryEntry): number {
  const qLower = query.toLowerCase();
  for (const tag of entry.tags) {
    if (qLower.includes(tag.toLowerCase())) return 0.12;
  }
  const tokens = qLower.split(/\s+/);
  for (const token of tokens) {
    if (token.length > 3 && entry.content.toLowerCase().includes(token)) return 0.08;
  }
  return 0;
}

function multiSignalScore(
  semanticScore: number,
  query: string,
  entry: MemoryEntry,
): number {
  const keyword = computeKeywordMultiplier(query, entry);
  const recency = computeRecencyMultiplier(entry.lastAccessed);
  const importanceBonus = Math.max(-0.06, Math.min(0.08, (entry.importance - 5) * 0.02));
  const skillBonus = entry.type === "skill" ? 0.15 : 0;

  const multiplier = 1 + keyword + recency + importanceBonus + skillBonus;
  const adjusted = semanticScore * multiplier;
  return Math.min(1, Math.max(0, adjusted));
}

function recalibrateNow(entry: MemoryEntry): void {
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
    const entries = await loadAsync();

    const exact = entries.find(e => e.content === content && e.type === type);
    if (exact) {
      exact.lastAccessed = new Date().toISOString();
      exact.accessCount++;
      exact.importance = Math.max(exact.importance, importance);
      if (tags.length) exact.tags = [...new Set([...exact.tags, ...tags])];
      if (exact.deprecated) exact.deprecated = false;
      recalibrateNow(exact);
      await saveAsync(entries);
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
        await saveAsync(entries);
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
    await saveAsync(entries);
    const cidx = loadClusters();
    const cid = assignToCluster(embedding, cidx);
    cidx.assignments[entryId] = cid;
    updateCentroid(embedding, cidx.centroids[cid], 0.05);
    saveClusters(cidx);
    return entry.id;
  });
}

export async function search(
  query: string,
  k = 5,
  project?: string,
  recordSuccess = false,
  typeFilter?: MemoryType,
): Promise<SearchResult[]> {
  const qv = await embed(query);
  const entries = load();
  if (!entries.length) return [];

  const cidx = loadClusters();
  const candidateIds = new Set<string>();
  if (cidx.centroids.length > 0) {
    const dists = cidx.centroids.map((c, i) => ({ idx: i, sim: cosineSimilarity(qv, c) }));
    dists.sort((a, b) => b.sim - a.sim);
    const topC = dists.slice(0, ANN_CLUSTER_SEARCH_COUNT);
    for (const tc of topC) {
      for (const [eid, cid] of Object.entries(cidx.assignments)) {
        if (cid === tc.idx) candidateIds.add(eid);
      }
    }
  }

  const scored: SearchResult[] = [];

  for (const entry of entries) {
    if (entry.deprecated) continue;
    if (project && entry.project !== project && entry.project !== "global") continue;
    if (typeFilter && entry.type !== typeFilter) continue;
    if (cidx.centroids.length > 0 && !candidateIds.has(entry.id)) continue;
    const semanticScore = cosineSimilarity(qv, entry.embedding);
    const finalScore = multiSignalScore(semanticScore, query, entry);
    scored.push({ entry, score: finalScore });
  }

  scored.sort((a, b) => b.score - a.score);

  const MIN_SCORE = 0.55;
  const aboveThreshold = scored.filter(s => s.score >= MIN_SCORE);
  const top = aboveThreshold.slice(0, k);
  const secondTier = scored.filter(s => s.score >= MIN_SCORE * 0.7).slice(k, k + 5);

  withWriteLock(async () => {
    const fresh = await loadAsync();
    const now = new Date().toISOString();
    for (const { entry } of top) {
      const freshEntry = fresh.find(e => e.id === entry.id);
      if (freshEntry) {
        freshEntry.lastAccessed = now;
        freshEntry.accessCount++;
        freshEntry.retrievalCount++;
        if (recordSuccess) freshEntry.retrievalSuccessCount++;
        recalibrateNow(freshEntry);
      }
    }
    for (const { entry } of secondTier) {
      const freshEntry = fresh.find(e => e.id === entry.id);
      if (freshEntry) freshEntry.retrievalCount++;
    }
    await saveAsync(fresh);
  });

  return top;
}

export async function consolidate(): Promise<{ merged: number; pruned: number; refreshed: number }> {
  const now = Date.now();
  if (now - lastConsolidationTime < CONSOLIDATION_COOLDOWN_MS) {
    return { merged: 0, pruned: 0, refreshed: 0 };
  }
  lastConsolidationTime = now;
  return withWriteLock(async () => {
    const entries = await loadAsync();
    let merged = 0;
    let pruned = 0;
    let refreshed = 0;

    const active = entries.filter(e => !e.deprecated && e.embedding?.length > 0);

    // Use cluster-based comparison to avoid O(n²): compare entries within same cluster first
    const clusters = loadClusters();
    const compared = new Set<string>();
    for (let i = 0; i < active.length; i++) {
      if (compared.size >= 2000) break; // cap total comparisons
      const ei = active[i];
      const ci = clusters.centroids.length > 0 ? nearestCentroid(ei.embedding, clusters.centroids) : 0;
      for (let j = i + 1; j < active.length; j++) {
        if (compared.size >= 2000) break;
        const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
        if (compared.has(key)) continue;
        compared.add(key);
        const ej = active[j];
        const cj = clusters.centroids.length > 0 ? nearestCentroid(ej.embedding, clusters.centroids) : 0;
        // Prefer comparing entries in the same cluster (faster convergence)
        if (ci !== cj && compared.size > 500) continue;
        const sim = cosineSimilarity(active[i].embedding, active[j].embedding);
        if (sim > 0.88) {
          const keeper = active[i].importance >= active[j].importance ? active[i] : active[j];
          const dropper = keeper === active[i] ? active[j] : active[i];
          keeper.tags = [...new Set([...keeper.tags, ...dropper.tags])];
          keeper.accessCount += dropper.accessCount;
          keeper.retrievalCount += dropper.retrievalCount;
          keeper.retrievalSuccessCount += dropper.retrievalSuccessCount;
          keeper.importance = Math.max(keeper.importance, dropper.importance);
          keeper.lastAccessed = new Date(Math.max(
            new Date(keeper.lastAccessed).getTime(),
            new Date(dropper.lastAccessed).getTime(),
          )).toISOString();
          if (keeper.type === "skill" && dropper.skillMeta && keeper.skillMeta) {
            keeper.skillMeta.successCount = Math.max(keeper.skillMeta.successCount, dropper.skillMeta.successCount) + 1;
            keeper.skillMeta.keySteps = [...new Set([...keeper.skillMeta.keySteps, ...dropper.skillMeta.keySteps])];
            keeper.skillMeta.complexityScore = Math.max(keeper.skillMeta.complexityScore, dropper.skillMeta.complexityScore);
            if (!keeper.skillMeta.approach) keeper.skillMeta.approach = dropper.skillMeta.approach;
          }
          dropper.deprecated = true;
          dropper.correctedById = keeper.id;
          dropper.ttl = new Date(now + 7 * 86_400_000).toISOString();
          merged++;
        }
      }
    }

    for (const entry of entries) {
      if (entry.deprecated) continue;
      const ttlTime = new Date(entry.ttl).getTime();
      if (ttlTime < now) {
        if (entry.importance < 3 || entry.accessCount < 2) {
          entry.deprecated = true;
          entry.ttl = new Date(now + 7 * 86_400_000).toISOString();
          pruned++;
        } else {
          const newDays = computeAdaptiveTTL(entry.importance, entry.accessCount);
          entry.ttl = new Date(now + newDays * 86_400_000).toISOString();
          refreshed++;
        }
      }
    }

    await reclusterCentroids(entries);
    if (merged > 0 || pruned > 0 || refreshed > 0) await saveAsync(entries);
    return { merged, pruned, refreshed };
  });
}

export function stats(): MemoryStats {
  const entries = load();
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

  let epCount = 0;
  if (fs.existsSync(EPISODES_DIR)) {
    try { epCount = fs.readdirSync(EPISODES_DIR).filter(f => f.endsWith(".md")).length; } catch {}
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

export async function remove(id: string): Promise<boolean> {
  return withWriteLock(async () => {
    const entries = await loadAsync();
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    entries.splice(idx, 1);
    await saveAsync(entries);
    return true;
  });
}

export function getRecent(k = 5): MemoryEntry[] {
  return load()
    .filter(e => !e.deprecated)
    .sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime())
    .slice(0, k);
}

export function getTopByPriority(k = 5, project?: string): MemoryEntry[] {
  const entries = load().filter(e => !e.deprecated);
  const now = Date.now();

  const scored = entries.map(e => {
    const recency = computeRecencyMultiplier(e.lastAccessed);
    const importance = e.importance / 10;
    const accessFreq = e.accessCount / Math.max(1, (now - new Date(e.created).getTime()) / 86_400_000);
    const freqScore = Math.min(1, accessFreq / 2);
    const priority = importance * 0.4 + recency * 0.3 + freqScore * 0.3;
    return { entry: e, score: priority };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(s => s.entry);
}

export async function markContradicted(oldContent: string, newEntryId: string): Promise<void> {
  return withWriteLock(async () => {
    const entries = await loadAsync();
    const match = entries.find(e => e.content === oldContent);
    if (match) {
      match.deprecated = true;
      match.correctedById = newEntryId;
      match.ttl = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await saveAsync(entries);
    }
  });
}

export function getSkills(k?: number): MemoryEntry[] {
  return load()
    .filter(e => e.type === "skill" && !e.deprecated)
    .sort((a, b) => {
      const aScore = (a.importance || 0) + (a.skillMeta?.successCount || 0) * 2;
      const bScore = (b.importance || 0) + (b.skillMeta?.successCount || 0) * 2;
      return bScore - aScore;
    })
    .slice(0, k ?? 5);
}

export async function searchExisting(query: string): Promise<MemoryEntry | null> {
  const entries = load().filter(e => !e.deprecated);
  if (!entries.length) return null;
  const qv = await embed(query);
  let best = null;
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

export async function flush(): Promise<void> {
  if (debounceTimer && pendingEntries) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    safeWriteFile(SEMANTIC_FILE, JSON.stringify(pendingEntries, null, 2));
    pendingEntries = null;
  }
  if (debounceResolve) {
    debounceResolve();
    debounceResolve = null;
  }
  await writeQueue;
}
