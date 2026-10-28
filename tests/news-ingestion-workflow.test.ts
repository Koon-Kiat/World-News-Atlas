// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runScheduledIngestion, scheduledIngestionMode, ARCHIVE_SCHEDULE, ingestionMarkdown, ingestionExitCode, isTransientStatus, REQUEST_TIMEOUT_MS, CONNECT_TIMEOUT_MS } from "../scripts/scheduled-ingestion.mjs";

const secret = "test-only-secret-at-least-thirty-two-characters";
function success(body: string) {
  return { status: 200, retryAfter: undefined, json: { requestId: JSON.parse(body).requestId, state: "SUCCEEDED",
    summary: { runId: "run-test", persisted: true, stagesProcessed: 4, stored: 10, storiesUpdated: 9, providersFailed: 0 } } };
}
describe("scheduled ingestion", () => {
  it("reports bounded provider error codes without accepting raw messages or Markdown", () => {
    const report = ingestionMarkdown([{ scope: "global", invocation: 1, success: false, attempts: 3, durationMs: 100,
      category: "http_422", summary: { ...success('{}').json.summary, providerFailures: [
        { provider: "GDELT", code: "REQUEST_FAILED" }, { provider: "NEWSAPI", code: "HTTP_401" },
        { provider: "RSS", code: "secret|injected\ntext" }, { provider: "UNKNOWN", code: "HTTP_500" },
      ] } }]);
    expect(report).toContain("GDELT: REQUEST_FAILED, NEWSAPI: HTTP_401");
    expect(report).not.toContain("secret"); expect(report).not.toContain("UNKNOWN");
  });
  it("preserves cadence, manual dispatch, concurrency and a bounded job timeout", () => {
    const workflow = readFileSync(".github/workflows/news-ingestion.yml", "utf8");
    expect(workflow).toContain('cron: "*/30 * * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("group: production-news-ingestion");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("timeout-minutes: 25");
    expect(workflow).toContain("node scripts/scheduled-ingestion.mjs");
    const script = readFileSync("scripts/scheduled-ingestion.mjs", "utf8");
    expect(script).toContain("process.exitCode = await ingestionExitCode");
  });
  it("retries a lost response with fresh authentication but the same signed logical operation", async () => {
    const requests: Array<{ headers: Record<string, string>; body: string }> = [];
    const send = vi.fn(async (_url: string, headers: Record<string, string>, body: string) => {
      requests.push({ headers, body });
      if (requests.length === 1) throw new Error("ECONNRESET");
      return success(body);
    });
    const wait = vi.fn(async () => {});
    const result = await runScheduledIngestion({ url: "https://example.test/ingest", secret, send, wait });
    expect(result.success).toBe(true);
    expect(result.results.map((result: { scope: string }) => result.scope)).toEqual(["global", "countries", "countries"]);
    expect(requests[0].body).toBe(requests[1].body);
    expect(requests[0].headers["X-Ingest-Nonce"]).not.toBe(requests[1].headers["X-Ingest-Nonce"]);
    for (const request of requests) {
      const h = request.headers;
      expect(h["X-Ingest-Signature"]).toBe(createHmac("sha256", secret).update(`${h["X-Ingest-Timestamp"]}.${h["X-Ingest-Nonce"]}.${request.body}`).digest("hex"));
      expect(JSON.parse(request.body).stageLimit).toBe(4);
    }
    expect(JSON.parse(requests[2].body).requestId).not.toBe(JSON.parse(requests[3].body).requestId);
    expect(wait).toHaveBeenCalledOnce();
  });
  it("does not retry authentication failures, continues later scopes, and retains successful summaries", async () => {
    const send = vi.fn(async (_url: string, _headers: Record<string, string>, body: string) =>
      JSON.parse(body).scope === "global" ? { status: 401, json: null, retryAfter: undefined } : success(body));
    const result = await runScheduledIngestion({ url: "https://example.test/ingest", secret, send, wait: async () => {} });
    expect(result.success).toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.results[0].attempts).toBe(1);
    expect(result.results[1].summary).toMatchObject({ stored: 10 });
    expect(result.results[2].success).toBe(true);
    const report = ingestionMarkdown(result.results);
    expect(report).toContain("http_401"); expect(report).toContain("run-test"); expect(report).not.toContain(secret);
  });
  it("bounds malformed successes and transient failures, while polling accepted running operations", async () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) expect(isTransientStatus(status)).toBe(true);
    for (const status of [400, 401, 403, 409, 422]) expect(isTransientStatus(status)).toBe(false);
    let attempts = 0;
    const wait = vi.fn<(milliseconds: number) => Promise<void>>(async () => {});
    const result = await runScheduledIngestion({ url: "https://example.test/ingest", secret, wait,
      send: async (_url: string, _headers: Record<string, string>, body: string) => {
        if (JSON.parse(body).scope === "countries") return success(body);
        attempts++;
        return attempts === 1 ? { status: 202, retryAfter: "15", json: { requestId: JSON.parse(body).requestId, state: "RUNNING" } }
          : { status: 200, retryAfter: undefined, json: { state: "SUCCEEDED", summary: {} } };
      } });
    expect(result.success).toBe(false); expect(attempts).toBe(4);
    expect(wait).toHaveBeenCalledTimes(3); expect(wait.mock.calls[0][0]).toBe(15_000);
    expect(result.results[2].success).toBe(true);
  });
  it("keeps polling after a genuine disconnect during legitimate 140s work", async () => {
    let time = 0;
    let lost = false;
    const result = await runScheduledIngestion({ url: "https://example.test/ingest", secret, now: () => time,
      wait: async (ms: number) => { time += ms; }, random: () => 0,
      send: async (_url: string, _headers: Record<string, string>, body: string) => {
        if (JSON.parse(body).scope === "global") {
          if (!lost) { lost = true; time += 90_000; throw new Error("timeout"); }
          if (time < 140_000) return { status: 202, retryAfter: "15", json: { requestId: JSON.parse(body).requestId, state: "RUNNING" } };
        }
        return success(body);
      } });
    expect(result.success).toBe(true);
    expect(result.results[0].durationMs).toBeGreaterThanOrEqual(140_000);
    expect(result.results[0].durationMs).toBeLessThan(300_000);
  });
  it("allows a 150s response with a 165s timeout and keeps the 10s connection limit", async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(165_000);
    expect(CONNECT_TIMEOUT_MS).toBe(10_000);
    let time = 0;
    const send = vi.fn(async (_url: string, _headers: Record<string, string>, body: string, timeout = REQUEST_TIMEOUT_MS) => {
      expect(timeout).toBe(165_000);
      time += 150_000;
      return success(body);
    });
    const wait = vi.fn(async () => {});
    const result = await runScheduledIngestion({ url: "https://example.test/ingest", secret, now: () => time, send, wait });
    expect(result.success).toBe(true); expect(send).toHaveBeenCalledTimes(3); expect(wait).not.toHaveBeenCalled();
  });
  it("never starts a truncated request and stops retrying after the six-minute scope window", async () => {
    let time = 0;
    const timeouts: number[] = [];
    const timestamps: string[] = [];
    const result = await runScheduledIngestion({ url: "https://example.test/ingest", secret, now: () => time, random: () => 0,
      wait: async (ms: number) => { time += ms; },
      send: async (_url: string, headers: Record<string, string>, body: string, timeout = REQUEST_TIMEOUT_MS) => {
        if (JSON.parse(body).scope !== "global") return success(body);
        timeouts.push(timeout); timestamps.push(headers["X-Ingest-Timestamp"]);
        time += timeout;
        throw new Error("timeout");
      } });
    expect(timeouts).toEqual([165_000, 165_000, 165_000]);
    expect(timestamps[0]).not.toBe(timestamps[1]);
    expect(result.results[0].durationMs).toBeLessThanOrEqual(360_000 + 165_000);
    expect(result.results[0].success).toBe(false); expect(result.results[2].success).toBe(true);
  });
  it("waits out an orphaned server lease without abandoning a newly started operation", async () => {
    // Reproduces Actions run 40657846707: the first global attempt died without
    // releasing the 180s lease, so every poll saw RUNNING/BUSY until it expired.
    let time = 0;
    let lock = { id: "", until: 0 };
    const done = new Set<string>();
    const timeouts: number[] = [];
    const result = await runScheduledIngestion({ url: "https://example.test/ingest", secret, now: () => time, random: () => 0,
      wait: async (ms: number) => { time += ms; },
      send: async (_url: string, _headers: Record<string, string>, body: string, timeout = REQUEST_TIMEOUT_MS) => {
        const { requestId } = JSON.parse(body);
        timeouts.push(timeout);
        if (done.has(requestId)) return success(body);
        if (lock.until > time) {
          return { status: 202, retryAfter: "15", json: { requestId, state: lock.id === requestId ? "RUNNING" : "BUSY" } };
        }
        if (time === 0) { lock = { id: requestId, until: 200_000 }; time += 20_000; return { status: 503, retryAfter: undefined, json: null }; }
        lock = { id: requestId, until: time + 60_000 };
        if (timeout < 60_000) { time += timeout; done.add(requestId); throw new Error("timeout"); }
        time += 60_000; done.add(requestId); lock.until = 0;
        return success(body);
      } });
    expect(result.results.map((r: { category: string }) => r.category)).toEqual(["success", "success", "success"]);
    expect(timeouts.every((timeout) => timeout === REQUEST_TIMEOUT_MS)).toBe(true);
  });
  it("returns a failing CLI exit code after retaining and reporting later successful scopes", async () => {
    const report = vi.fn(async () => {});
    const code = await ingestionExitCode({ url: "https://example.test/ingest", secret,
      send: async (_url: string, _headers: Record<string, string>, body: string) =>
        JSON.parse(body).scope === "global" ? { status: 403, json: null } : success(body) }, report);
    expect(code).toBe(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("country-rotation-next | SUCCESS"));
  });
  it("separates scheduled incremental discovery and archive reconciliation, preserving manual periods", () => {
    expect(scheduledIngestionMode({ eventName: "schedule", schedule: "*/30 * * * *" })).toEqual({ period: "24h", mode: "incremental" });
    expect(scheduledIngestionMode({ eventName: "schedule", schedule: ARCHIVE_SCHEDULE })).toEqual({ period: "30d", mode: "backfill" });
    for (const period of ["latest", "24h", "7d", "30d"]) expect(scheduledIngestionMode({ eventName: "workflow_dispatch", period }).period).toBe(period);
    expect(() => scheduledIngestionMode({ period: "invalid" })).toThrow();
  });
  it.each(["60", "Thu, 01 Jan 1970 00:01:00 GMT"])("respects a server cooldown beyond the old 30-second clamp: %s", async (retryAfter) => {
    let time = 0;
    const starts: number[] = [];
    const result = await runScheduledIngestion({ url: "https://example.test/ingest", secret, now: () => time, random: () => 0,
      wait: async (ms: number) => { time += ms; }, send: async (_url: string, _headers: Record<string, string>, body: string) => {
        starts.push(time);
        return starts.length === 1 ? { status: 503, retryAfter, json: null } : success(body);
      } });
    expect(starts[1]).toBe(60_000); expect(result.success).toBe(true);
  });
  it("stops within the deadline without shortening a long provider cooldown", async () => {
    const wait = vi.fn(async () => {});
    const send = vi.fn(async () => ({ status: 503, retryAfter: "900", json: null }));
    const result = await runScheduledIngestion({ url: "https://example.test/ingest", secret, wait, send, now: () => 0 });
    expect(send).toHaveBeenCalledTimes(3); expect(wait).not.toHaveBeenCalled();
    expect(result.results.every((r: { category: string }) => r.category === "cooldown_exceeds_deadline")).toBe(true);
  });
  it("does not retry a semantically transient but exhausted logical operation", async () => {
    const send = vi.fn(async (_url: string, _headers: Record<string, string>, body: string) => ({ status: 503,
      json: { requestId: JSON.parse(body).requestId, state: "RETRY_BUDGET_EXHAUSTED", retryEligible: false } }));
    const result = await runScheduledIngestion({ url: "https://example.test/ingest", secret, send });
    expect(send).toHaveBeenCalledTimes(3); expect(result.success).toBe(false);
  });
  it("exits successfully for explicit degraded results while reporting the provider failure", async () => {
    const report = vi.fn(async () => {});
    const code = await ingestionExitCode({ url: "https://example.test/ingest", secret,
      send: async (_url: string, _headers: Record<string, string>, body: string) => {
        const response = success(body);
        return { ...response, retryAfter: "60", json: { ...response.json, state: "DEGRADED", outcome: "DEGRADED",
          summary: { ...response.json.summary, providersFailed: 1, providerFailures: [{ provider: "GDELT", code: "HTTP_429", retryAfterMs: 60_000 }] } } };
      } }, report);
    expect(code).toBe(0); expect(report).toHaveBeenCalledWith(expect.stringContaining("**Outcome: DEGRADED**"));
    expect(report).toHaveBeenCalledWith(expect.stringContaining("GDELT: HTTP_429"));
  });
});
