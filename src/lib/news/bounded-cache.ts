export interface TtlCache<T> {
  get(key: string, now?: number): T | undefined;
  set(key: string, value: T, ttlMs: number, now?: number): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export class MemoryTtlCache<T> implements TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Cache capacity must be a positive integer");
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number, now = Date.now()): void {
    this.entries.delete(key);
    this.removeExpired(now);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, { value, expiresAt: now + Math.max(1, ttlMs) });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
