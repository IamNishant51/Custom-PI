import { LRUCache } from "../../lru-cache";

let highlighter: ((code: string, lang: string) => string) | null = null;

async function getHighlighter(): Promise<typeof highlighter> {
  if (highlighter) return highlighter;
  try {
    const hl = await import("cli-highlight");
    highlighter = (code: string, lang: string) => {
      try {
        return hl.highlight(code, { language: lang, ignoreIllegals: true });
      } catch {
        return code;
      }
    };
  } catch {
    highlighter = (code: string) => code;
  }
  return highlighter;
}

const highlightCache = new LRUCache<string>({ capacity: 100, ttlMs: 300_000 });

function cacheKey(code: string, lang: string): string {
  return `${lang}:${code.length}:${code.slice(0, 64)}`;
}

export function highlightBlock(code: string, lang: string): string {
  const key = cacheKey(code, lang);
  const cached = highlightCache.get(key);
  return cached || code;
}

let triggerReRender: (() => void) | null = null;

export function setReRenderCallback(cb: () => void) {
  triggerReRender = cb;
}

export async function highlightAsync(code: string, lang: string): Promise<string> {
  if (!lang) return code;
  const key = cacheKey(code, lang);
  const cached = highlightCache.get(key);
  if (cached) return cached;

  const hl = await getHighlighter();
  if (!hl) return code;

  try {
    const result = hl(code, lang);
    highlightCache.set(key, result);
    if (triggerReRender) {
      setImmediate(() => {
        if (triggerReRender) triggerReRender();
      });
    }
    return result;
  } catch {
    return code;
  }
}
