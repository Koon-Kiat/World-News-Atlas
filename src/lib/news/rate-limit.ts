interface RateWindow {
  count: number;
  resetAt: number;
}

const windows = new Map<string, RateWindow>();

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
  now = Date.now(),
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  if (windows.size > 2_000) {
    for (const [entryKey, value] of windows) {
      if (value.resetAt <= now) windows.delete(entryKey);
    }
  }
  const current = windows.get(key);
  const window = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + options.windowMs }
    : current;
  window.count += 1;
  windows.set(key, window);
  return {
    allowed: window.count <= options.limit,
    remaining: Math.max(0, options.limit - window.count),
    retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
  };
}
