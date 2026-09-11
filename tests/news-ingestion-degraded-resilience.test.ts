// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  ingestionMarkdown,
  runScheduledIngestion,
  summaryHasUsefulProgress,
} from "../scripts/scheduled-ingestion.mjs";

const secret = "test-only-secret-at-least-thirty-two-characters";

function success(body: string) {
  return {
    status: 200,
    retryAfter: undefined,
    json: {
      requestId: JSON.parse(body).requestId,
      state: "SUCCEEDED",
      summary: {
        runId: "run-success",
        persisted: true,
        stagesProcessed: 3,
        providersAttempted: 3,
        providersFailed: 0,
        received: 12,
        normalized: 12,
        accepted: 10,
        checkpointsCompleted: 2,
        stored: 10,
        storiesUpdated: 9,
      },
    },
  };
}

function degraded(body: string, status = 503, state = "FAILED_RETRYABLE") {
  return {
    status,
    retryAfter: "30",
    json: {
      requestId: JSON.parse(body).requestId,
      state,
      summary: {
        runId: "run-degraded",
        persisted: true,
        stagesProcessed: 3,
        providersAttempted: 3,
        providersFailed: 1,
        providerFailures: [{ provider: "OTHER", code: "REQUEST_FAILED" }],
        received: 8,
        normalized: 8,
        accepted: 7,
        checkpointsCompleted: 2,
        stored: 7,
        storiesUpdated: 7,
      },
    },
  };
}

describe("degraded scheduled ingestion resilience", () => {
  it("accepts persisted partial progress without retrying an upstream provider outage", async () => {
    const wait = vi.fn(async () => {});
    const send = vi.fn(async (_url: string, _headers: Record<string, string>, body: string) =>
      JSON.parse(body).scope === "global" ? degraded(body) : success(body));

    const outcome = await runScheduledIngestion({
      url: "https://example.test/ingest",
      secret,
      send,
      wait,
    });

    expect(outcome.success).toBe(true);
    expect(outcome.results[0]).toMatchObject({ success: true, attempts: 1, category: "degraded" });
    expect(send).toHaveBeenCalledTimes(3);
    expect(wait).not.toHaveBeenCalled();
    expect(summaryHasUsefulProgress(outcome.results[0].summary)).toBe(true);

    const report = ingestionMarkdown(outcome.results);
    expect(report).toContain("| global (1) | Degraded | 1 |");
    expect(report).toContain("OTHER: REQUEST_FAILED");
  });

  it("also recovers an already-terminalized partial request instead of making the workflow red", async () => {
    const send = vi.fn(async (_url: string, _headers: Record<string, string>, body: string) =>
      JSON.parse(body).scope === "global" ? degraded(body, 422, "FAILED_TERMINAL") : success(body));

    const outcome = await runScheduledIngestion({
      url: "https://example.test/ingest",
      secret,
      send,
      wait: async () => {},
    });

    expect(outcome.success).toBe(true);
    expect(outcome.results[0]).toMatchObject({ success: true, attempts: 1, category: "degraded", status: 422 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("still retries and fails when all provider work made zero useful progress", async () => {
    const wait = vi.fn(async () => {});
    const send = vi.fn(async (_url: string, _headers: Record<string, string>, body: string) => {
      if (JSON.parse(body).scope !== "global") return success(body);
      return {
        status: 503,
        retryAfter: undefined,
        json: {
          requestId: JSON.parse(body).requestId,
          state: "FAILED_RETRYABLE",
          summary: {
            runId: "run-no-progress",
            persisted: true,
            stagesProcessed: 1,
            providersAttempted: 1,
            providersFailed: 1,
            received: 0,
            normalized: 0,
            accepted: 0,
            checkpointsCompleted: 0,
            stored: 0,
            storiesUpdated: 0,
          },
        },
      };
    });

    const outcome = await runScheduledIngestion({
      url: "https://example.test/ingest",
      secret,
      send,
      wait,
      random: () => 0,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.results[0]).toMatchObject({ success: false, attempts: 3, category: "http_503" });
    expect(summaryHasUsefulProgress(outcome.results[0].summary)).toBe(false);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(5);
  });
});
