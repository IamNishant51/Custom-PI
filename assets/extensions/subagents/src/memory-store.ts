import type { MemoryEntry, SearchResult, MemoryStats, MemoryType } from "./memory-types";
import { embed, cosineSimilarity } from "./memory-embedding";

// Backward-compatible re-exports from the refactored modules
export { loadEntries, saveAllEntries, loadSync as load, store, remove, markContradicted, stats, getRecent, getTopByPriority, getSkills, searchExisting, withWriteLock, genId, computeAdaptiveTTL, recalibrateNow, flushWrite as flush } from "./core-store";
export { search, searchEphemeral, getEphemeral, storeEphemeral, clearEphemeral, searchSystemic, retrieveAll } from "./search";
export type { CachedResult } from "./search";
export { consolidate } from "./consolidation";
export { loadClusters, nearestCentroid, getClusterDrift, resetClusterDrift } from "./ann-cluster";
