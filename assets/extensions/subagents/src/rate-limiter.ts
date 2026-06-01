import { upsertRateLimit, getRateLimit, getAllBreachedRateLimits } from "./state-db";

export interface RateLimitHeaders {
  remaining?: number;
  limit?: number;
  resetAt?: number;
}

const BACKOFF_BASE_MS = 1000;

export function trackRateLimit(service: string, headers: RateLimitHeaders): void {
  const now = Date.now();
  const prev = getRateLimit(service);
  const remaining = headers.remaining ?? prev?.remaining ?? 60;
  const limitTotal = headers.limit ?? prev?.limitTotal ?? 60;
  const resetAt = headers.resetAt ?? prev?.resetAt ?? (now + 60000);
  const breached = remaining < 5 ? 1 : 0;
  const backoffDelayMs = breached
    ? (prev?.backoffDelayMs || BACKOFF_BASE_MS) * 2
    : BACKOFF_BASE_MS;

  upsertRateLimit({
    service,
    remaining,
    limitTotal,
    resetAt,
    breached,
    backoffDelayMs: Math.min(backoffDelayMs, 60000),
    lastChecked: now,
  });
}

export async function waitIfThrottled(service: string): Promise<number> {
  const rl = getRateLimit(service);
  if (!rl || !rl.breached) return 0;
  const now = Date.now();
  if (rl.resetAt <= now) {
    upsertRateLimit({ ...rl, breached: 0, backoffDelayMs: BACKOFF_BASE_MS, lastChecked: now });
    return 0;
  }
  const delay = Math.min(rl.backoffDelayMs, rl.resetAt - now);
  if (delay > 0) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return delay;
}

export function getThrottleAdvisory(): string {
  const breached = getAllBreachedRateLimits();
  if (breached.length === 0) return "";
  return breached.map(r => `  ⚠ ${r.service}: ${r.remaining}/${r.limitTotal} remaining, backoff ${r.backoffDelayMs}ms`).join("\n");
}
