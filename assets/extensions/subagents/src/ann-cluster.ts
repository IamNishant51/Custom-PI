import type { MemoryEntry } from "./memory-types";
import { cosineSimilarity } from "./memory-embedding";
import { logger } from "./logger";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { PATHS } from "./config";

const MEMORY_DIR = PATHS.MEMORY;
const ANN_CLUSTERS_FILE = path.join(MEMORY_DIR, "ann-clusters.json");

const ANN_CLUSTERS = 16;
const ANN_CLUSTER_SEARCH_COUNT = 3;

export interface ClusterIndex {
  centroids: number[][];
  assignments: Record<string, number>;
}

const clusterDrift = new Map<string, number>();

export function getClusterDrift(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [id, drift] of clusterDrift) result[id] = drift;
  return result;
}

export function resetClusterDrift(): void {
  clusterDrift.clear();
}

export function loadClusters(): ClusterIndex {
  if (fs.existsSync(ANN_CLUSTERS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ANN_CLUSTERS_FILE, "utf8"));
    } catch { logger.warn("Failed to load cluster index"); }
  }
  return { centroids: [], assignments: {} };
}

function saveClusters(idx: ClusterIndex): void {
  ensureDirs();
  const tmpPath = ANN_CLUSTERS_FILE + ".tmp." + Date.now();
  fs.writeFileSync(tmpPath, JSON.stringify(idx), "utf8");
  fs.renameSync(tmpPath, ANN_CLUSTERS_FILE);
}

async function saveClustersAsync(idx: ClusterIndex): Promise<void> {
  ensureDirs();
  const tmpPath = ANN_CLUSTERS_FILE + ".tmp." + Date.now();
  await fsp.writeFile(tmpPath, JSON.stringify(idx), "utf8");
  await fsp.rename(tmpPath, ANN_CLUSTERS_FILE);
}

function ensureDirs(): void {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

export function nearestCentroid(embedding: number[], centroids: number[][]): number {
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

export function assignAndUpdate(embedding: number[], entryId: string): void {
  const cidx = loadClusters();
  const cid = assignToCluster(embedding, cidx);
  const oldAssignment = cidx.assignments[entryId];
  cidx.assignments[entryId] = cid;
  updateCentroid(embedding, cidx.centroids[cid], 0.05);

  // Track drift: if entry changed clusters, record the drift
  if (oldAssignment !== undefined && oldAssignment !== cid) {
    const currentDrift = clusterDrift.get(String(cid)) || 0;
    clusterDrift.set(String(cid), currentDrift + 1);
  }

  saveClusters(cidx);
}

export async function reclusterCentroids(entries: MemoryEntry[]): Promise<void> {
  const active = entries.filter(e => !e.deprecated && e.embedding?.length > 0);
  if (active.length === 0) return;
  const K = Math.min(ANN_CLUSTERS, active.length);
  const dim = active[0].embedding.length;

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

  saveClusters({ centroids, assignments });
}

export function getClusterSearchCandidates(queryVector: number[], candidateIds: Set<string>): void {
  const cidx = loadClusters();
  if (cidx.centroids.length > 0) {
    const dists = cidx.centroids.map((c, i) => ({ idx: i, sim: cosineSimilarity(queryVector, c) }));
    dists.sort((a, b) => b.sim - a.sim);
    const topC = dists.slice(0, ANN_CLUSTER_SEARCH_COUNT);
    for (const tc of topC) {
      for (const [eid, cid] of Object.entries(cidx.assignments)) {
        if (cid === tc.idx) candidateIds.add(eid);
      }
    }
  }
}
