import type { MemoryEntry } from "./memory-types";
import { cosineSimilarity } from "./memory-embedding";
import { loadEntries, saveAllEntries, withWriteLock, computeAdaptiveTTL } from "./core-store";
import { loadClusters, nearestCentroid, reclusterCentroids } from "./ann-cluster";

const SIMILARITY_MERGE_THRESHOLD = 0.88;
const MAX_COMPARISONS = 2000;
const PRUNE_TTL_DAYS = 7;
const LOW_IMPORTANCE_THRESHOLD = 3;
const LOW_ACCESS_THRESHOLD = 2;
const CROSS_CLUSTER_EARLY_BREAK = 500;
let lastConsolidationTime = 0;
const CONSOLIDATION_COOLDOWN_MS = 120_000;
const YIELD_INTERVAL = 100;

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

export async function consolidate(): Promise<{ merged: number; pruned: number; refreshed: number }> {
  const now = Date.now();
  if (now - lastConsolidationTime < CONSOLIDATION_COOLDOWN_MS) {
    return { merged: 0, pruned: 0, refreshed: 0 };
  }
  lastConsolidationTime = now;
  return withWriteLock(async () => {
    const entries = await loadEntries();
    let merged = 0;
    let pruned = 0;
    let refreshed = 0;

    const active = entries.filter(e => !e.deprecated && e.embedding?.length > 0);

    const clusters = loadClusters();
    const compared = new Set<string>();
    let comparisonCount = 0;
    for (let i = 0; i < active.length; i++) {
      if (compared.size >= MAX_COMPARISONS) break;
      const ei = active[i];
      const ci = clusters.centroids.length > 0 ? nearestCentroid(ei.embedding, clusters.centroids) : 0;
      for (let j = i + 1; j < active.length; j++) {
        if (compared.size >= MAX_COMPARISONS) break;
        const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
        if (compared.has(key)) continue;
        compared.add(key);
        comparisonCount++;
        if (comparisonCount % YIELD_INTERVAL === 0) await yieldToEventLoop();
        const ej = active[j];
        const cj = clusters.centroids.length > 0 ? nearestCentroid(ej.embedding, clusters.centroids) : 0;
        if (ci !== cj && compared.size > CROSS_CLUSTER_EARLY_BREAK) continue;
        const sim = cosineSimilarity(active[i].embedding, active[j].embedding);
        if (sim > SIMILARITY_MERGE_THRESHOLD) {
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
          dropper.ttl = new Date(now + PRUNE_TTL_DAYS * 86_400_000).toISOString();
          merged++;
        }
      }
    }

    await yieldToEventLoop();

    for (const entry of entries) {
      if (entry.deprecated) continue;
      const ttlTime = new Date(entry.ttl).getTime();
      if (ttlTime < now) {
        if (entry.importance < LOW_IMPORTANCE_THRESHOLD || entry.accessCount < LOW_ACCESS_THRESHOLD) {
          entry.deprecated = true;
          entry.ttl = new Date(now + PRUNE_TTL_DAYS * 86_400_000).toISOString();
          pruned++;
        } else {
          const newDays = computeAdaptiveTTL(entry.importance, entry.accessCount);
          entry.ttl = new Date(now + newDays * 86_400_000).toISOString();
          refreshed++;
        }
      }
    }

    await yieldToEventLoop();

    await reclusterCentroids(entries);
    if (merged > 0 || pruned > 0 || refreshed > 0) {
      await saveAllEntries(entries);
    }
    return { merged, pruned, refreshed };
  });
}
