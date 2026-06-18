import dns from "node:dns";
import { vaultGet } from "./vault.mjs";

const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.|169\.254\.|::1|fc00:|fe80:|localhost)/i;

export async function isPrivateUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    if (PRIVATE_IP_RE.test(url.hostname)) return true;
    const { address } = await dns.promises.lookup(url.hostname, { family: 4 });
    return PRIVATE_IP_RE.test(address);
  } catch {
    return true;
  }
}

export async function webFetchUrl(url) {
  if (await isPrivateUrl(url)) return "Error: Fetching private/internal URLs is not allowed";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; pi-custom-pack/1.0)",
        "Accept": "text/html,text/plain,application/json,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();
    if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(text);
        return JSON.stringify(parsed, null, 2).slice(0, 10000);
      } catch {
        return text.slice(0, 10000);
      }
    }
    const stripped = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return stripped.slice(0, 10000);
  } catch (e) {
    return `Error fetching URL: ${e.message}`;
  }
}

export async function searchWebRaw(query, count = 5) {
  const results = [];
  const providers = [];

  providers.push(async () => {
    const tavilyKey = process.env.TAVILY_API_KEY || vaultGet("TAVILY_API_KEY") || "";
    if (!tavilyKey) return null;
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavilyKey, query, search_depth: "basic", max_results: count }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.results || []).map(r => ({
        title: r.title || "Tavily Search Result",
        url: r.url,
        snippet: r.content || ""
      }));
    } catch { return null; }
  });

  providers.push(async () => {
    const serperKey = process.env.SERPER_API_KEY || vaultGet("SERPER_API_KEY") || "";
    if (!serperKey) return null;
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: count }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.organic || []).map(r => ({
        title: r.title || "Google Search Result",
        url: r.link,
        snippet: r.snippet || ""
      }));
    } catch { return null; }
  });

  providers.push(async () => {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();
      const links = [];
      const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      const snippets = [];
      let sMatch;
      while ((sMatch = snippetRegex.exec(html)) !== null) {
        snippets.push(sMatch[1].replace(/<[^>]+>/g, "").trim());
      }
      let idx = 0;
      while ((m = linkRegex.exec(html)) !== null && links.length < count) {
        let href = m[1];
        if (href.includes("//duckduckgo.com/l/?uddg=")) {
          href = href.replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, "").replace(/&rut=.*$/, "");
          href = decodeURIComponent(href);
        }
        const title = m[2].replace(/<[^>]+>/g, "").trim();
        const snippet = snippets[idx] || "";
        if (href && title) {
          links.push({ title, url: href, snippet });
        }
        idx++;
      }
      if (links.length) return links;
      throw new Error("No DDG results");
    } catch { return null; }
  });

  providers.push(async () => {
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${count}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      return (data.hits || []).slice(0, count).map(h => ({
        title: h.title || h.story_title || "",
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        snippet: (h.story_text || h.comment_text || "").replace(/<[^>]+>/g, "").slice(0, 200),
      })).filter(h => h.title);
    } catch { return null; }
  });

  providers.push(async () => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${count}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      return (data.query?.search || []).map(r => ({
        title: r.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
        snippet: r.snippet.replace(/<[^>]+>/g, ""),
      }));
    } catch { return null; }
  });

  for (const provider of providers) {
    const r = await provider();
    if (r && r.length > 0) {
      results.push(...r);
      break;
    }
  }
  return results;
}

export async function webSearch(query, count = 5) {
  const results = await searchWebRaw(query, count);
  if (!results.length) return "Web search returned no results. Try a different query.";
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet.slice(0, 200)}` : ""}`).join("\n\n");
}
