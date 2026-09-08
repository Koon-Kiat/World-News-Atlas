import "server-only";
import { createHash } from "node:crypto";
import { getSitesD1Binding } from "@/lib/db/d1";
import { clientKey } from "./client-key";
import { checkRateLimit, type RateLimitResult } from "./rate-limit";

export class D1RateLimitStore {
  private nextCleanupAt = 0;
  constructor(private readonly database: D1Database) {}

  async increment(key: string, options: { limit: number; windowMs: number }, now = Date.now()): Promise<RateLimitResult> {
    const hashed = createHash("sha256").update(key).digest("hex");
    if (now >= this.nextCleanupAt) {
      this.nextCleanupAt = now + 60_000;
      await this.database.prepare(`DELETE FROM api_rate_limit WHERE client_key IN
        (SELECT client_key FROM api_rate_limit WHERE reset_at <= ? ORDER BY reset_at LIMIT 500)`).bind(now).run();
    }
    const row = await this.database.prepare(`INSERT INTO api_rate_limit (client_key, count, reset_at)
      SELECT ?, 1, ? WHERE EXISTS (SELECT 1 FROM api_rate_limit WHERE client_key = ?)
        OR (SELECT COUNT(*) FROM api_rate_limit) < 10000
      ON CONFLICT(client_key) DO UPDATE SET
        count = CASE WHEN reset_at <= ? THEN 1 ELSE MIN(count + 1, ?) END,
        reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
      RETURNING count, reset_at`).bind(hashed, now + options.windowMs, hashed,
        now, options.limit + 1, now).first<{ count: number; reset_at: number }>();
    return { allowed: Boolean(row && row.count <= options.limit),
      remaining: row ? Math.max(0, options.limit - row.count) : 0,
      retryAfterSeconds: Math.max(1, Math.ceil(((row?.reset_at ?? now + options.windowMs) - now) / 1000)) };
  }
}

let shared: { database: D1Database; store: D1RateLimitStore } | undefined;
export async function limitNewsRequest(request: Request): Promise<RateLimitResult> {
  const database = await getSitesD1Binding();
  const key = clientKey(request, Boolean(database));
  const options = { limit: 90, windowMs: 60_000 };
  const local = checkRateLimit(key, options);
  if (!local.allowed) return local;
  if (!database) {
    if (process.env.NODE_ENV === "production") throw new Error("Distributed limiter unavailable");
    return local;
  }
  if (!shared || shared.database !== database) shared = { database, store: new D1RateLimitStore(database) };
  return shared.store.increment(key, options);
}
