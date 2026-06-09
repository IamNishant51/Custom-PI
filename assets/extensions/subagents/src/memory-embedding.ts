const OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings";
const OLLAMA_EMBED_MODELS = ["nomic-embed-text", "all-minilm", "bge-small-en-v1.5", "snowflake-arctic-embed"];
const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";
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

async function tryOllamaEmbed(text: string, signal: AbortSignal): Promise<number[] | null> {
  for (const model of OLLAMA_EMBED_MODELS) {
    try {
      const response = await fetch(OLLAMA_EMBED_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
        signal,
      });
      if (!response.ok) continue;
      const data: { embedding: number[] } = await response.json();
      return data.embedding;
    } catch {
      continue;
    }
  }
  return null;
}

async function tryOpenAIEmbed(text: string, signal: AbortSignal): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.CUSTOM_PI_OPENAI_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch(OPENAI_EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
      signal,
    });
    if (!response.ok) return null;
    const data: { data: { embedding: number[] }[] } = await response.json();
    if (data.data?.[0]?.embedding) return data.data[0].embedding;
    return null;
  } catch {
    return null;
  }
}

export async function embed(text: string): Promise<number[]> {
  const key = text.slice(0, 200);
  const fromCache = cacheGet(key);
  if (fromCache) return fromCache;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const embeddingModel = process.env.CUSTOM_PI_EMBEDDING_MODEL || "nomic-embed-text";

  let result: number[] | null = null;

  if (embeddingModel.startsWith("openai/") || embeddingModel === "text-embedding-3-small" || embeddingModel === "text-embedding-3-large" || embeddingModel === "text-embedding-ada-002") {
    result = await tryOpenAIEmbed(text, controller.signal);
  }

  if (!result) {
    result = await tryOllamaEmbed(text, controller.signal);
  }

  clearTimeout(timeout);

  if (!result) {
    result = fallbackEmbed(text);
  }

  cacheSet(key, result);
  return result;
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
