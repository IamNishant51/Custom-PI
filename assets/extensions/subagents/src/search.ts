import { logger } from "./logger";
import type { MemoryEntry, SearchResult, MemoryType } from "./memory-types";
import { embed, cosineSimilarity } from "./memory-embedding";
import { loadEntries, saveAllEntries, withWriteLock, recalibrateNow, loadSync } from "./core-store";
import { getClusterSearchCandidates } from "./ann-cluster";
import fs from "node:fs";
import path from "node:path";

const MIN_SCORE = 0.55;

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

export async function search(
  query: string,
  k = 5,
  project?: string,
  recordSuccess = false,
  typeFilter?: MemoryType,
): Promise<SearchResult[]> {
  const qv = await embed(query);
  const entries = loadSync();
  if (!entries.length) return [];

  const candidateIds = new Set<string>();
  getClusterSearchCandidates(qv, candidateIds);

  const scored: SearchResult[] = [];

  for (const entry of entries) {
    if (entry.deprecated) continue;
    if (project && entry.project !== project && entry.project !== "global") continue;
    if (typeFilter && entry.type !== typeFilter) continue;
    if (candidateIds.size > 0 && !candidateIds.has(entry.id)) continue;
    const semanticScore = cosineSimilarity(qv, entry.embedding);
    const finalScore = multiSignalScore(semanticScore, query, entry);
    scored.push({ entry, score: finalScore });
  }

  scored.sort((a, b) => b.score - a.score);

  const aboveThreshold = scored.filter(s => s.score >= MIN_SCORE);
  const top = aboveThreshold.slice(0, k);
  const secondTier = scored.filter(s => s.score >= MIN_SCORE * 0.7).slice(k, k + 5);

  withWriteLock(async () => {
    const fresh = await loadEntries();
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
    await saveAllEntries(fresh);
  });

  return top;
}

// Three-Tier Cache

export interface CachedResult {
  content: string;
  source: "tier1" | "tier2" | "tier3";
  confidence: number;
  timestamp: number;
}

const TIER1_TTL = 600_000;
const tier1Store = new Map<string, { content: string; timestamp: number }>();

export function storeEphemeral(key: string, content: string): void {
  tier1Store.set(key, { content, timestamp: Date.now() });
}

export function getEphemeral(key: string): string | null {
  const entry = tier1Store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TIER1_TTL) {
    tier1Store.delete(key);
    return null;
  }
  return entry.content;
}

export function searchEphemeral(query: string): CachedResult[] {
  const results: CachedResult[] = [];
  const q = query.toLowerCase();
  for (const [key, entry] of tier1Store) {
    if (Date.now() - entry.timestamp > TIER1_TTL) {
      tier1Store.delete(key);
      continue;
    }
    if (key.toLowerCase().includes(q) || entry.content.toLowerCase().includes(q)) {
      results.push({
        content: entry.content,
        source: "tier1",
        confidence: 0.95,
        timestamp: entry.timestamp,
      });
    }
  }
  return results.sort((a, b) => b.timestamp - a.timestamp).slice(0, 3);
}

export function clearEphemeral(): void {
  tier1Store.clear();
}

let tier3Index: { path: string; content: string }[] | null = null;
let tier3IndexTime = 0;
const TIER3_TTL = 300_000;

function ensureTier3Index(): { path: string; content: string }[] {
  const now = Date.now();
  if (tier3Index && now - tier3IndexTime < TIER3_TTL) return tier3Index;
  tier3Index = [];
  tier3IndexTime = now;

  const projectRoot = process.env.PI_PROJECT_ROOT || process.cwd();
  const files = [
    "AGENT.md",
    "package.json",
    "README.md",
    ".opencode/rules.md",
    "assets/extensions/subagents/AGENT.md",
  ];
  for (const rel of files) {
    const p = path.join(projectRoot, rel);
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf8").slice(0, 5000);
        tier3Index.push({ path: rel, content });
      }
    } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
  }
  return tier3Index!;
}

export function searchSystemic(query: string): CachedResult[] {
  const index = ensureTier3Index();
  const q = query.toLowerCase();
  const results: CachedResult[] = [];
  for (const entry of index) {
    const content = entry.content;
    const lower = content.toLowerCase();
    if (!lower.includes(q)) {
      const tokens = q.split(/\s+/).filter(t => t.length > 2);
      const matchCount = tokens.filter(t => lower.includes(t)).length;
      if (matchCount < Math.max(1, tokens.length * 0.5)) continue;
    }
    results.push({
      content: `[${entry.path}]\n${content.slice(0, 1000)}`,
      source: "tier3",
      confidence: 0.70,
      timestamp: Date.now(),
    });
  }
  return results.slice(0, 3);
}

export async function retrieveAll(query: string, opts?: {
  k?: number;
  project?: string;
  minConfidence?: number;
}): Promise<CachedResult[]> {
  const k = opts?.k ?? 5;
  const minConfidence = opts?.minConfidence ?? 0.70;
  const results: CachedResult[] = [];

  const t1 = searchEphemeral(query);
  for (const r of t1) {
    if (r.confidence >= minConfidence) results.push(r);
  }

  if (results.length < k) {
    const sem = await search(query, k, opts?.project, false);
    for (const s of sem) {
      const confidence = s.score;
      if (confidence >= minConfidence) {
        results.push({
          content: s.entry.content.slice(0, 2000),
          source: "tier2",
          confidence,
          timestamp: new Date(s.entry.lastAccessed).getTime(),
        });
      }
    }
  }

  if (results.length < k) {
    const t3 = searchSystemic(query);
    for (const r of t3) {
      if (r.confidence >= minConfidence && !results.find(ex => ex.content === r.content)) {
        results.push(r);
      }
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence).slice(0, k);
}
