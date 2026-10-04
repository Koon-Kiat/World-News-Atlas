import { getSitesD1Binding } from "@/lib/db/d1";
import { MAX_RETRY_AFTER_MS, parseRetryAfter, PROVIDER_BACKOFF_BASE_MS } from "../retry-policy.mjs";
import { ProviderError } from "./provider";

export const GDELT_REQUEST_INTERVAL_MS = 5_500;
export interface GdeltSlot { granted: boolean; waitMs: number; cooldown: boolean }
export interface GdeltRateControl {
  acquire(now: number, intervalMs: number): Promise<GdeltSlot>;
  defer(value: string | null, now: number, jitter: number): Promise<number>;
}

/** One atomic slot per database, shared by scheduled ingestion and live browsing. */
export class D1GdeltRateControl implements GdeltRateControl {
  constructor(private readonly database: D1Database) {}
  async acquire(now: number, intervalMs: number): Promise<GdeltSlot> {
    const results = await this.database.batch([
      this.database.prepare(`INSERT INTO provider_request_control (provider, next_request_at, cooldown_until, failures, last_failure_at)
        VALUES ('GDELT', ?, 0, 0, 0)
        ON CONFLICT(provider) DO UPDATE SET next_request_at = excluded.next_request_at
        WHERE next_request_at <= ? AND cooldown_until <= ? RETURNING provider`).bind(now + intervalMs, now, now),
      this.database.prepare("SELECT next_request_at, cooldown_until FROM provider_request_control WHERE provider = 'GDELT'"),
    ]);
    if (results[0].results.length) return { granted: true, waitMs: 0, cooldown: false };
    const row = results[1].results[0] as { next_request_at: number; cooldown_until: number };
    return { granted: false, waitMs: Math.max(0, Math.max(row.next_request_at, row.cooldown_until) - now), cooldown: row.cooldown_until > now };
  }
  async defer(value: string | null, now: number, jitter: number): Promise<number> {
    const explicit = parseRetryAfter(value, now);
    const row = await this.database.prepare(`INSERT INTO provider_request_control
      (provider, next_request_at, cooldown_until, failures, last_failure_at) VALUES ('GDELT', 0, ?, 1, ?)
      ON CONFLICT(provider) DO UPDATE SET
        cooldown_until = MAX(cooldown_until, ? + MIN(?, COALESCE(?, ? * (1 << CASE WHEN last_failure_at <= ? THEN 0 ELSE MIN(failures, 5) END)) + ?)),
        failures = CASE WHEN last_failure_at <= ? THEN 1 ELSE MIN(failures + 1, 6) END,
        last_failure_at = excluded.last_failure_at
      RETURNING cooldown_until`)
      .bind(now + Math.min(MAX_RETRY_AFTER_MS, (explicit ?? PROVIDER_BACKOFF_BASE_MS) + jitter), now,
        now, MAX_RETRY_AFTER_MS, explicit, PROVIDER_BACKOFF_BASE_MS, now - MAX_RETRY_AFTER_MS, jitter, now - MAX_RETRY_AFTER_MS)
      .first<{ cooldown_until: number }>();
    if (!row) throw new Error("Provider cooldown was not saved");
    return Math.max(0, row.cooldown_until - now);
  }
}

/** Development/test fallback only. Production always requires its existing DB. */
export class MemoryGdeltRateControl implements GdeltRateControl {
  private nextAt = 0;
  private cooldownUntil = 0;
  private failures = 0;
  private lastFailureAt = 0;
  async acquire(now: number, intervalMs: number): Promise<GdeltSlot> {
    const waitMs = Math.max(0, Math.max(this.nextAt, this.cooldownUntil) - now);
    if (waitMs > 0) return { granted: false, waitMs, cooldown: this.cooldownUntil > now };
    this.nextAt = now + intervalMs;
    return { granted: true, waitMs: 0, cooldown: false };
  }
  async defer(value: string | null, now: number, jitter: number): Promise<number> {
    if (now - this.lastFailureAt >= MAX_RETRY_AFTER_MS) this.failures = 0;
    const delay = Math.min(MAX_RETRY_AFTER_MS, (parseRetryAfter(value, now) ?? PROVIDER_BACKOFF_BASE_MS * 2 ** Math.min(this.failures, 5)) + jitter);
    this.cooldownUntil = Math.max(this.cooldownUntil, now + delay);
    this.failures++;
    this.lastFailureAt = now;
    return this.cooldownUntil - now;
  }
}

let memory = new MemoryGdeltRateControl();
export function resetGdeltRateControlForTesting(): void { memory = new MemoryGdeltRateControl(); }
export async function configuredGdeltRateControl(): Promise<GdeltRateControl> {
  const database = await getSitesD1Binding();
  if (database) return new D1GdeltRateControl(database);
  if (process.env.NODE_ENV === "production") throw new ProviderError("GDELT", "STORAGE_UNAVAILABLE", "Provider coordination unavailable");
  return memory;
}

export function waitForProviderSlot(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal?.removeEventListener("abort", aborted); reject(new ProviderError("GDELT", "STAGE_TIMEOUT", "Provider stage cancelled")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}
