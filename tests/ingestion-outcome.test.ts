import { describe, expect, it } from "vitest";
import { classifyIngestionOutcome, ingestionFailureKind } from "@/lib/news/ingestion-outcome";
import type { IngestionSummary } from "@/lib/news/ingest";

const summary = (patch: Partial<IngestionSummary> = {}): IngestionSummary => ({
  runId: "policy-test", mode: "incremental", period: "24h", countries: [], stagesProcessed: 2,
  providersAttempted: 2, providersFailed: 0, providerFailures: [], usefulStages: 1,
  received: 4, normalized: 4, articlesWithCountries: 4, countryDetectionRate: 1,
  accepted: 4, outOfWindow: 0, countryIrrelevant: 0, rejected: 0, duplicatesRemoved: 0,
  stored: 4, storiesUpdated: 4, persisted: true, budgetExhausted: false, checkpointsCompleted: 1, durationMs: 100,
  ...patch,
});
describe("ingestion acceptance policy", () => {
  it("accepts persisted data and a legitimate empty stage", () => {
    expect(classifyIngestionOutcome(summary())).toBe("SUCCESS");
    expect(classifyIngestionOutcome(summary({ stored: 0 }))).toBe("SUCCESS");
  });
  it.each(["HTTP_429", "HTTP_503", "REQUEST_FAILED", "STAGE_TIMEOUT", "PROVIDER_COOLDOWN"])("degrades a useful operation with transient %s", (code) => {
    expect(classifyIngestionOutcome(summary({ providersFailed: 1, providerFailures: [{ provider: "GDELT", code }] }))).toBe("DEGRADED");
  });
  it.each(["HTTP_401", "HTTP_403", "INVALID_QUERY", "INVALID_CONFIGURATION", "INVALID_RESPONSE", "UNEXPECTED_FAILURE", "INVARIANT_FAILED"])("never degrades terminal %s", (code) => {
    expect(classifyIngestionOutcome(summary({ providersFailed: 1, providerFailures: [{ provider: "NEWSAPI", code }] }))).toBe("TERMINAL_FAILURE");
  });
  it("keeps all-provider outages and storage failures retryable and red", () => {
    expect(classifyIngestionOutcome(summary({ usefulStages: 0, stored: 0, providersFailed: 1, providerFailures: [{ provider: "GDELT", code: "HTTP_429" }] }))).toBe("RETRYABLE_FAILURE");
    expect(classifyIngestionOutcome(summary({ persisted: false }))).toBe("RETRYABLE_FAILURE");
    expect(classifyIngestionOutcome(summary({ providersFailed: 1, providerFailures: [{ provider: "GDELT", code: "STORAGE_UNAVAILABLE" }] }))).toBe("RETRYABLE_FAILURE");
    expect(classifyIngestionOutcome(summary({ usefulStages: 0, stored: 0, stagesProcessed: 0, providersAttempted: 0 }))).toBe("RETRYABLE_FAILURE");
  });
  it("rejects incomplete failure accounting", () => {
    expect(classifyIngestionOutcome(summary({ providersFailed: 1 }))).toBe("TERMINAL_FAILURE");
    expect(ingestionFailureKind("UNRECOGNIZED_CODE")).toBe("terminal");
  });
});
