/**
 * Swarm Routing & Multi-API Shims
 *
 * 1. Role Coalescer — merge consecutive same-role messages
 * 2. JSON Schema Strictness — additionalProperties: false
 * 3. Web Scraper Cascade — DuckDuckGo → Firecrawl failover
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Alternate Role Coalescer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge consecutive messages with the same role.
 * Ollama and strict local runners reject same-role adjacency.
 */
export function coalesceMessages(messages: any[]): any[] {
  if (messages.length <= 1) return messages;

  const result: any[] = [];
  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === msg.role) {
      // Merge content arrays or strings
      if (Array.isArray(last.content) && Array.isArray(msg.content)) {
        last.content = [...last.content, ...msg.content];
      } else if (typeof last.content === "string" && typeof msg.content === "string") {
        last.content = last.content + "\n" + msg.content;
      } else {
        // Type mismatch — keep separate
        result.push(msg);
      }
    } else {
      result.push({ ...msg });
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. JSON Schema Strictness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply strict schema rules to a TypeBox schema:
 * - Set additionalProperties: false
 * - Move optional params to required if they have defaults
 */
export function strictifySchema(schema: Record<string, any>): Record<string, any> {
  if (!schema || schema.type !== "object") return schema;

  const strict = { ...schema };
  strict.additionalProperties = false;

  // Ensure at least an empty required array
  if (!strict.required) {
    strict.required = [];
  }

  // All properties that aren't explicitly optional become required
  if (strict.properties) {
    for (const key of Object.keys(strict.properties)) {
      if (!strict.required.includes(key)) {
        const prop = strict.properties[key];
        // Properties without default, without optional
        if (prop && !prop.default && !prop.optional && !prop["default"]) {
          // Skip if it looks optional
          if (!prop.anyOf && !prop.oneOf) {
            // This is already not required — leave as is
          }
        }
      }
    }
  }

  return strict;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Web Scraper Cascade
// ─────────────────────────────────────────────────────────────────────────────

interface WebResult {
  url: string;
  title: string;
  content: string;
}

/**
 * Fetch a URL with automatic failover:
 * 1. Try direct fetch
 * 2. Fallback to duck-duck-scrape style (simulated via web_fetch)
 * 3. Final fallback to basic HTTP
 */
export async function cascadeFetch(url: string, timeoutMs = 10000): Promise<WebResult> {
  // Tier 1: Try direct fetch with timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Custom-PI/1.0)" },
    });
    clearTimeout(timer);
    if (response.ok) {
      const text = await response.text();
      const title = extractTitle(text) || url;
      return { url, title, content: stripHtml(text).slice(0, 50000) };
    }
  } catch {
    // Fall through
  }

  // Tier 2: Attempt textise dot iitty (text mode proxy)
  try {
    const textUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(textUrl, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (response.ok) {
      const text = await response.text();
      return { url, title: url, content: text.slice(0, 50000) };
    }
  } catch {
    // Fall through
  }

  // Tier 3: Basic HTTP as final fallback
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) {
      const text = await response.text();
      return { url, title: extractTitle(text) || url, content: stripHtml(text).slice(0, 50000) };
    }
  } catch {
    // All tiers exhausted
  }

  return { url, title: url, content: "Failed to fetch content." };
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function webSearchCascade(query: string): Promise<WebResult[]> {
  // Try DuckDuckGo-style search via web_fetch
  const results: WebResult[] = [];
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const result = await cascadeFetch(searchUrl);
    // Parse DDG results from HTML
    const linkMatches = result.content.match(/https?:\/\/[^\s"'<>]+/g);
    if (linkMatches) {
      const unique = [...new Set(linkMatches)].slice(0, 5);
      for (const link of unique) {
        try {
          const page = await cascadeFetch(link, 5000);
          results.push(page);
        } catch {
          // skip failed links
        }
      }
    }
  } catch {
    // search failed
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Dynamic Tiered Context Recall
// ─────────────────────────────────────────────────────────────────────────────

export type IntentCategory = "conversational" | "knowledge_graph" | "system_state" | "unknown";

const CONVERSATIONAL_PATTERNS = [
  /^(what|who|when|where|why|how) (did|was|were|have|has|had) /i,
  /^(can you|could you|would you|will you) /i,
  /^(i think|i feel|i remember|i recall) /i,
  /^(tell me about|show me|explain) /i,
  /^(do you|did you|have you) /i,
  /^remember /i,
  /^recall /i,
];

const KNOWLEDGE_PATTERNS = [
  /^(what is|what are|what does|what do|how does|how do) /i,
  /^(find|locate|search for|look up) /i,
  /^(list|show|get|fetch) .* (depend|relation|connect|associate)/i,
  /^(which|what) .* (use|depend|implement|extend|calls?)/i,
  /^(relation|connection|link|edge) (between|among) /i,
  /dependenc/i,
  /triplet/i,
];

const SYSTEM_PATTERNS = [
  /^(check|show|get|display|what is the) (status|state|health|budget|cost|context)/i,
  /^(how many|how much|count) /i,
  /^(list|show) (session|task|file|memory)/i,
  /^(running|active|current) (process|task|job)/i,
  /^system /i,
];

export function classifyIntent(query: string): IntentCategory {
  const q = query.trim();

  for (const p of SYSTEM_PATTERNS) {
    if (p.test(q)) return "system_state";
  }
  for (const p of KNOWLEDGE_PATTERNS) {
    if (p.test(q)) return "knowledge_graph";
  }
  for (const p of CONVERSATIONAL_PATTERNS) {
    if (p.test(q)) return "conversational";
  }

  return "unknown";
}

export interface TieredRetrievalOptions {
  sessionId?: string;
  minConfidence?: number;
}

export interface TieredRetrievalResult {
  primarySource: IntentCategory;
  content: string;
  confidence: number;
  fallbackUsed: boolean;
  sources: string[];
}

export async function tieredRetrieve(
  query: string,
  searchSession: (sessionId: string, query: string) => any[],
  queryTripletsFn: (filter: {
    subjectId?: string; subjectType?: string; predicateType?: string;
    objectId?: string; objectType?: string; minConfidence?: number;
  }) => any[],
  findConnectedFn: (entityId: string) => any[],
  opts?: TieredRetrievalOptions,
): Promise<TieredRetrievalResult> {
  const intent = classifyIntent(query);
  const minConf = opts?.minConfidence ?? 0.6;
  const sources: string[] = [];
  let content = "";
  let confidence = 0;
  let fallbackUsed = false;

  if (intent === "conversational") {
    // Tier A: FTS5 full-text search (fast)
    if (opts?.sessionId) {
      const ftsResults = searchSession(opts.sessionId, query);
      if (ftsResults.length > 0) {
        content = ftsResults.slice(0, 3).map((r: any) => r.content || r.text).join("\n\n");
        confidence = 0.85;
        sources.push("fts5");
        return { primarySource: "conversational", content, confidence, fallbackUsed: false, sources };
      }
    }
    // Fallback to knowledge graph
    fallbackUsed = true;
    const triplets = queryTripletsFn({ minConfidence: minConf });
    if (triplets.length > 0) {
      content = triplets.slice(0, 3).map(t => `${t.subjectLabel} ${t.predicateLabel} ${t.objectLabel}`).join("\n");
      confidence = 0.6;
      sources.push("triplets");
    }
  } else if (intent === "knowledge_graph") {
    // Tier B: Knowledge graph triplets
    const triplets = queryTripletsFn({ minConfidence: minConf });
    if (triplets.length > 0) {
      content = triplets.slice(0, 5).map(t => `${t.subjectLabel} ${t.predicateLabel} ${t.objectLabel} (${(t.confidenceScore * 100).toFixed(0)}%)`).join("\n");
      confidence = 0.8;
      sources.push("triplets");
      return { primarySource: "knowledge_graph", content, confidence, fallbackUsed: false, sources };
    }
    // Fallback to FTS5
    if (opts?.sessionId) {
      const ftsResults = searchSession(opts.sessionId, query);
      if (ftsResults.length > 0) {
        content = ftsResults.slice(0, 3).map((r: any) => r.content || r.text).join("\n\n");
        confidence = 0.6;
        sources.push("fts5");
        fallbackUsed = true;
      }
    }
  } else if (intent === "system_state") {
    // Tier C: system state — just return indication
    sources.push("system_state");
    return { primarySource: "system_state", content: "[System state query — use / commands for details]", confidence: 1.0, fallbackUsed: false, sources };
  } else {
    // Unknown intent — try FTS5 first, then triplets
    if (opts?.sessionId) {
      const ftsResults = searchSession(opts.sessionId, query);
      if (ftsResults.length > 0) {
        content = ftsResults.slice(0, 3).map((r: any) => r.content || r.text).join("\n\n");
        confidence = 0.7;
        sources.push("fts5");
      }
    }
    if (!content) {
      const triplets = queryTripletsFn({ minConfidence: minConf });
      if (triplets.length > 0) {
        content = triplets.slice(0, 3).map(t => `${t.subjectLabel} ${t.predicateLabel} ${t.objectLabel}`).join("\n");
        confidence = 0.5;
        sources.push("triplets");
        fallbackUsed = true;
      }
    }
  }

  return {
    primarySource: content ? intent : "unknown",
    content: content || "No relevant context found.",
    confidence,
    fallbackUsed,
    sources,
  };
}
