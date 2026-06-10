export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class LRUCache<T = unknown> {
  private capacity: number;
  private ttlMs: number;
  private cache = new Map<string, CacheEntry<T>>();

  constructor(options?: { capacity?: number; ttlMs?: number }) {
    this.capacity = options?.capacity ?? 1000;
    this.ttlMs = options?.ttlMs ?? 60_000;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.ttlMs),
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    this.prune();
    return this.cache.size;
  }

  keys(): string[] {
    this.prune();
    return Array.from(this.cache.keys());
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }
}

const _caches = new Map<string, LRUCache>();

export function getCache(name: string, options?: { capacity?: number; ttlMs?: number }): LRUCache {
  if (!_caches.has(name)) {
    _caches.set(name, new LRUCache(options));
  }
  return _caches.get(name)!;
}

export function clearAllCaches(): void {
  for (const cache of _caches.values()) cache.clear();
  _caches.clear();
}
