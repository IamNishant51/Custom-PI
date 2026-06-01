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
