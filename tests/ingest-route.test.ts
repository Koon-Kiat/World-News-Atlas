// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { signIngestionPayload } from "@/lib/news/ingest-auth";
import { handleIngestionRequest } from "@/lib/news/ingest-route";
import type { IngestionSummary } from "@/lib/news/ingest";
import type { NewsStore } from "@/lib/news/store";

const secret = "test-secret-that-is-more-than-thirty-two-characters";
const now = new Date("2026-09-02T08:00:00.000Z");

function summary(): IngestionSummary {
  return {
    runId: "run-test", mode: "incremental", period: "30d", countries: [], stagesProcessed: 1,
    providersAttempted: 1, providersFailed: 0, received: 4, normalized: 4, articlesWithCountries: 3,
    countryDetectionRate: 0.75, accepted: 3, outOfWindow: 0, countryIrrelevant: 1, rejected: 1,
    duplicatesRemoved: 0, stored: 3, storiesUpdated: 2, persisted: true, budgetExhausted: false,
    checkpointsCompleted: 1, durationMs: 20,
  };
}

function replayProtectedStore(): NewsStore {
  const nonces = new Set<string>();
  return {
    persistStoryCandidates: vi.fn(), loadStories: vi.fn(), loadCoverage: vi.fn(), load: vi.fn(), save: vi.fn(),
    startStage: vi.fn(), finishStage: vi.fn(), nextCountryBatch: vi.fn(), deleteExpiredIngestionNonces: vi.fn(async () => 0),
    claimIngestionNonce: vi.fn(async (nonce: string) => {
      if (nonces.has(nonce)) return false;
      nonces.add(nonce);
      return true;
    }),
  } as unknown as NewsStore;
}

async function signedRequest(body: string, overrides: Record<string, string> = {}): Promise<Request> {
  const timestamp = overrides.timestamp ?? String(Math.floor(now.getTime() / 1_000));
  const nonce = overrides.nonce ?? "0123456789abcdef0123456789abcdef";
  const signature = overrides.signature ?? await signIngestionPayload(secret, timestamp, nonce, body);
  return new Request("https://example.com/api/internal/ingest/run", {
    method: "POST", headers: {
      "content-type": "application/json", "x-ingest-timestamp": timestamp,
      "x-ingest-nonce": nonce, "x-ingest-signature": signature,
    }, body,
  });
}

describe("signed ingestion route", () => {
  it("accepts a valid bounded request and rejects nonce replay", async () => {
    const body = JSON.stringify({ period: "30d", mode: "incremental", scope: "global", stageLimit: 2 });
    const store = replayProtectedStore();
    const run = vi.fn(async () => summary());
    const dependencies = { secret, store, now: () => now, run };
    const first = await handleIngestionRequest(await signedRequest(body), dependencies);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ summary: { runId: "run-test", stored: 3 } });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ countries: [], stageLimit: 2, store }));
    expect((await handleIngestionRequest(await signedRequest(body), dependencies)).status).toBe(409);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects tampered, stale, and non-strict inputs", async () => {
    const store = replayProtectedStore();
    const run = vi.fn(async () => summary());
    const body = JSON.stringify({ scope: "countries", stageLimit: 4 });
    expect((await handleIngestionRequest(await signedRequest(body, { signature: "0".repeat(64) }), { secret, store, now: () => now, run })).status).toBe(401);
    const staleTimestamp = String(Math.floor((now.getTime() - 301_000) / 1_000));
    expect((await handleIngestionRequest(await signedRequest(body, {
      timestamp: staleTimestamp, nonce: "abcdef0123456789abcdef0123456789",
    }), { secret, store, now: () => now, run })).status).toBe(401);
    const invalidBody = JSON.stringify({ scope: "global", unexpected: true });
    expect((await handleIngestionRequest(await signedRequest(invalidBody, { nonce: "fedcba9876543210fedcba9876543210" }), { secret, store, now: () => now, run })).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});
