const OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings";
const EMBED_MODELS = ["nomic-embed-text", "all-minilm", "bge-small-en-v1.5", "snowflake-arctic-embed"];
const MAX_CACHE_SIZE = 500;

interface CacheEntry {
  embedding: number[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 300_000;

function cacheGet(key: string): number[] | undefined {
  const cached = cache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.timestamp >= CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, cached);
  return cached.embedding;
}

function cacheSet(key: string, embedding: number[]): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { embedding, timestamp: Date.now() });
}

function fallbackEmbed(text: string): number[] {
  const dims = 64;
  const vec = new Array(dims).fill(0);
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, " ");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let hash = 0;
    for (let j = 0; j < t.length; j++) {
      hash = ((hash << 5) - hash) + t.charCodeAt(j);
      hash |= 0;
    }
    vec[Math.abs(hash) % dims] += 1;
    for (let n = 2; n <= 3 && n <= t.length; n++) {
      for (let k = 0; k <= t.length - n; k++) {
        const ng = t.slice(k, k + n);
        let nh = 0;
        for (let j = 0; j < ng.length; j++) {
          nh = ((nh << 5) - nh) + ng.charCodeAt(j);
          nh |= 0;
        }
        vec[Math.abs(nh) % dims] += 0.5;
      }
    }
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (mag > 0) for (let i = 0; i < dims; i++) vec[i] /= mag;
  return vec;
}

export async function embed(text: string): Promise<number[]> {
  const key = text.slice(0, 200);
  const fromCache = cacheGet(key);
  if (fromCache) return fromCache;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  for (const model of EMBED_MODELS) {
    try {
      const response = await fetch(OLLAMA_EMBED_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
        signal: controller.signal,
      });

      if (!response.ok) continue;

      const data: { embedding: number[] } = await response.json();
      cacheSet(key, data.embedding);
      return data.embedding;
    } catch {
      continue;
    }
  }

  clearTimeout(timeout);

  const fb = fallbackEmbed(text);
  cacheSet(key, fb);
  return fb;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
