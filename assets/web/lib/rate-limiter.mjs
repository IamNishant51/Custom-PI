// ── Token Bucket Rate Limiter ────────────────────────────────────────────────

export class TokenBucket {
  constructor(capacity, refillRate, refillIntervalMs = 1000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.refillIntervalMs = refillIntervalMs;
    this.lastRefill = Date.now();
  }

  async consume(count = 1) {
    this._refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    const waitMs = Math.ceil((count - this.tokens) / this.refillRate) * this.refillIntervalMs;
    await new Promise(r => setTimeout(r, Math.min(waitMs, 30000)));
    this._refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.refillIntervalMs) {
      this.tokens = Math.min(this.capacity, this.tokens + this.refillRate * Math.floor(elapsed / this.refillIntervalMs));
      this.lastRefill = now;
    }
  }
}

// Singleton rate limiter instances
export const rateLimiters = {
  dag: new TokenBucket(5, 1, 1000),         // 5 burst, 1/sec refill
  vault: new TokenBucket(10, 2, 1000),      // 10 burst, 2/sec
  settings: new TokenBucket(5, 1, 1000),    // 5 burst, 1/sec
  social: new TokenBucket(3, 1, 5000),      // 3 burst, 1/5sec
  mutation: new TokenBucket(10, 2, 1000),   // 10 burst, 2/sec — generic mutation endpoints
  chat: new TokenBucket(5, 1, 2000),        // 5 burst, 1/2sec — chat completions
};
