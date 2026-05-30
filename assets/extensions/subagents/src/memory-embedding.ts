const OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings";
const EMBED_MODEL = "nomic-embed-text";
const MAX_CACHE_SIZE = 500;

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

export async function embed(text: string): Promise<number[]> {
  const key = text.slice(0, 200);
  const fromCache = cacheGet(key);
  if (fromCache) return fromCache;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(OLLAMA_EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding returned ${response.status}`);
    }

    const data: { embedding: number[] } = await response.json();
    cacheSet(key, data.embedding);
    return data.embedding;
  } finally {
    clearTimeout(timeout);
  }
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
