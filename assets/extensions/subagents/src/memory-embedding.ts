const OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings";
const EMBED_MODEL = "nomic-embed-text";

interface OllamaEmbedResponse {
  embedding: number[];
}

const cache = new Map<string, { embedding: number[]; timestamp: number }>();
const CACHE_TTL_MS = 300_000;

export async function embed(text: string): Promise<number[]> {
  const key = text.slice(0, 200);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.embedding;
  }

  const response = await fetch(OLLAMA_EMBED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding returned ${response.status}`);
  }

  const data: OllamaEmbedResponse = await response.json();
  cache.set(key, { embedding: data.embedding, timestamp: Date.now() });
  return data.embedding;
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
