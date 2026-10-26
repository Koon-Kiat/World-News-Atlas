import { isTransientStatus, MAX_RETRY_AFTER_MS } from "./retry-policy.mjs";
import type { IngestionSummary } from "./ingest";
import type { ProviderFailure } from "./types";

export type IngestionOutcome = "SUCCESS" | "DEGRADED" | "RETRYABLE_FAILURE" | "TERMINAL_FAILURE";
export type FailureKind = "transient_provider" | "retryable_internal" | "terminal";

/** Only explicitly understood upstream conditions are eligible for degradation. */
export function ingestionFailureKind(code: string): FailureKind {
  if (["STORAGE_UNAVAILABLE", "LEASE_LOST", "OPERATION_TIMEOUT"].includes(code)) return "retryable_internal";
  // Public, credential-free discovery sources can block a crawler or return HTML.
  // Keep these observable without treating them as application auth/config errors.
  if (["PUBLIC_FEED_UNAVAILABLE", "PUBLIC_FEED_INVALID_RESPONSE"].includes(code)) return "transient_provider";
  if (["REQUEST_FAILED", "STAGE_TIMEOUT", "PROVIDER_COOLDOWN", "PROVIDER_BUSY", "ALL_FEEDS_FAILED"].includes(code)) return "transient_provider";
  const status = /^HTTP_(\d{3})$/.exec(code);
  return status && isTransientStatus(Number(status[1])) ? "transient_provider" : "terminal";
}

export function terminalIngestionFailure(code: string | undefined): boolean {
  return code !== undefined && ingestionFailureKind(code) === "terminal";
}

export function classifyIngestionOutcome(summary: IngestionSummary): IngestionOutcome {
  if (!summary.persisted) return "RETRYABLE_FAILURE";
  const failures = summary.providerFailures ?? [];
  if (failures.length !== summary.providersFailed) return "TERMINAL_FAILURE";
  if (failures.some(({ code }) => ingestionFailureKind(code) === "terminal")) return "TERMINAL_FAILURE";
  if (failures.some(({ code }) => ingestionFailureKind(code) === "retryable_internal")) return "RETRYABLE_FAILURE";
  // A successful empty stage or an already completed checkpoint is legitimate.
  // Raw/unaccepted articles alone never prove useful persisted work.
  const useful = summary.stored > 0 || (summary.usefulStages ?? 0) > 0;
  if (!useful) return "RETRYABLE_FAILURE";
  return failures.length ? "DEGRADED" : "SUCCESS";
}

export function ingestionRetryAfterMs(failures: ProviderFailure[] = []): number {
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ...failures.map(({ retryAfterMs }) =>
    Number.isFinite(retryAfterMs) ? retryAfterMs! : 0)));
}

export class IngestionError extends Error {
  constructor(public readonly code: "INVALID_STATE" | "INVALID_CONFIGURATION" | "INVARIANT_FAILED" | "STORAGE_UNAVAILABLE" | "LEASE_LOST" | "OPERATION_TIMEOUT") {
    super(code);
    this.name = "IngestionError";
  }
}
