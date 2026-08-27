interface RateWindow {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  increment(
    key: string,
    options: { limit: number; windowMs: number },
    now?: number,
  ): RateLimitResult;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, RateWindow>();

  constructor(private readonly maxEntries = 2_000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Rate-limit capacity must be a positive integer");
    }
  }

  get size(): number {
    return this.windows.size;
  }

  increment(
    key: string,
    options: { limit: number; windowMs: number },
    now = Date.now(),
  ): RateLimitResult {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.delete(key);
      this.removeExpired(now);
      while (this.windows.size >= this.maxEntries) {
        const oldestKey = this.windows.keys().next().value;
        if (oldestKey === undefined) break;
        this.windows.delete(oldestKey);
      }
    }

    const window = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : current;
    window.count += 1;
    this.windows.delete(key);
    this.windows.set(key, window);
    return {
      allowed: window.count <= options.limit,
      remaining: Math.max(0, options.limit - window.count),
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  }

  private removeExpired(now: number): void {
    for (const [key, value] of this.windows) {
      if (value.resetAt <= now) this.windows.delete(key);
    }
  }
}

const defaultRateLimitStore = new MemoryRateLimitStore();

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
  now = Date.now(),
  store: RateLimitStore = defaultRateLimitStore,
): RateLimitResult {
  return store.increment(key, options, now);
}
