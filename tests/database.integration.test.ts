// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clusterArticles } from "@/lib/news/cluster";
import { loadDatabaseCoverage, loadDatabaseStories } from "@/lib/news/data-store";
import { D1NewsStore } from "@/lib/news/d1-store";
import { D1RateLimitStore } from "@/lib/news/distributed-rate-limit";
import { D1IngestionRequestStore, INGESTION_LEASE_MS, INGESTION_RECORD_TTL_MS, MAX_INGESTION_ATTEMPTS } from "@/lib/news/ingestion-requests";
import { handleIngestionRequest } from "@/lib/news/ingest-route";
import { signIngestionPayload } from "@/lib/news/ingest-auth";
import type { IngestionSummary } from "@/lib/news/ingest";
import * as providers from "@/lib/news/providers";
import { ProviderError, type NewsProvider } from "@/lib/news/providers/provider";
import type { ProviderFetchRequest, ProviderFetchResult } from "@/lib/news/types";
import { persistStoryCandidates } from "@/lib/news/persistence";
import { buildNewsResponse } from "@/lib/news/query";
import { canonicalSourceId } from "@/lib/news/sources/registry";
import type { NewsStore } from "@/lib/news/store";
import type { NewsQuery, NormalizedArticle } from "@/lib/news/types";
import { D1GdeltRateControl } from "@/lib/news/providers/gdelt-rate-control";

const migration = readdirSync("drizzle").filter((file) => file.endsWith(".sql")).sort()
  .flatMap((file) => readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean));
const baseQuery: NewsQuery = { countries: [], sourcePerspective: "all", sources: [], period: "30d", sort: "newest", page: 1, pageSize: 12 };
const ingestionSummary = (patch: Partial<IngestionSummary> = {}): IngestionSummary => ({
  runId: "integration-run", mode: "incremental", period: "24h", countries: [], stagesProcessed: 1,
  providersAttempted: 1, providersFailed: 0, received: 1, normalized: 1, articlesWithCountries: 1,
  countryDetectionRate: 1, accepted: 1, outOfWindow: 0, countryIrrelevant: 0, rejected: 0,
  duplicatesRemoved: 0, stored: 1, storiesUpdated: 1, persisted: true, budgetExhausted: false,
  checkpointsCompleted: 1, durationMs: 10, ...patch,
});

let miniflare: Miniflare;
let database: D1Database;
let store: NewsStore;

function article(
  id: string,
  title: string,
  countries: Array<{ code: string; name: string; relevanceScore: number }>,
  options: { ageMinutes?: number; topics?: string[]; language?: string; sourceName?: string } = {},
): NormalizedArticle {
  const sourceName = options.sourceName ?? "Integration News";
  return {
    id, provider: "RSS", providerArticleId: id, title, description: `${title} reporting summary`,
    url: `https://example.com/${id}`, canonicalUrl: `https://example.com/${id}`, imageUrl: null,
    publishedAt: new Date(Date.now() - (options.ageMinutes ?? 1) * 60_000).toISOString(),
    language: options.language ?? "en",
    source: {
      id: canonicalSourceId({ name: sourceName, domain: sourceName === "Integration News" ? "example.com" : null, countryCode: "JP" }),
      name: sourceName, domain: sourceName === "Integration News" ? "example.com" : null,
      countryCode: "JP", region: "Asia", language: options.language ?? "en", scope: "NATIONAL", qualityScore: 0.9,
    },
    sourceIdentifier: sourceName, countries, topics: options.topics ?? ["politics"], importanceScore: 0.8, relevanceScore: 0.9,
  };
}

async function countRows(table: "article" | "story" | "story_article"): Promise<number> {
  return (await database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>())?.count ?? 0;
}

beforeEach(async () => {
  providers.resetProviderRequestCacheForTesting();
  miniflare = new Miniflare(convertV4MiniflareOptions({
    name: "news-test", modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "world-news-test", LEGACY: "world-news-upgrade-test" },
  }));
  await miniflare.ready;
  database = await miniflare.getD1Database("DB", "news-test") as unknown as D1Database;
  for (const statement of migration) await database.prepare(statement).run();
  store = new D1NewsStore(database);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await miniflare.dispose();
});

describe("D1 news integration", () => {
  it("fences every data and checkpoint write after an attempt loses its lease", async () => {
    const now = new Date();
    const claim = await store.ingestionRequests.claim("fenced-write-operation", "digest", now);
    if (claim.state !== "ACCEPTED") throw new Error("Expected acceptance");
    const fenced = new D1NewsStore(database).forIngestion("fenced-write-operation", claim.token);
    const checkpoint = {
      provider: "RSS" as const, discoveryKey: "incremental:JP:24h:all", countryCode: "JP", language: null,
      mode: "incremental" as const, status: "PARTIAL" as const, windowStart: new Date(now.getTime() - 86_400_000).toISOString(),
      windowEnd: now.toISOString(), cursor: { offset: 1 }, exhausted: false, coverageComplete: false,
      receivedCount: 1, acceptedCount: 1, duplicateCount: 0,
    };
    const stage = { ...checkpoint, windowStart: new Date(checkpoint.windowStart), windowEnd: now };
    const stageId = await fenced.startStage(stage);
    await fenced.save(checkpoint);
    const candidate = clusterArticles([article("fenced", "Japan report", [{ code: "JP", name: "Japan", relevanceScore: 1 }])]);
    await fenced.persistStoryCandidates(candidate);
    await database.batch([
      database.prepare("UPDATE ingestion_operation_lock SET lease_until = 0"),
      database.prepare("UPDATE ingestion_logical_request SET lease_until = 0"),
    ]);
    const replacement = await store.ingestionRequests.claim("fenced-write-operation", "digest", new Date());
    if (replacement.state !== "ACCEPTED") throw new Error("Expected resumed attempt");
    const writes = [
      () => fenced.persistStoryCandidates(clusterArticles([article("stale", "Stale worker report", [])])),
      () => fenced.save({ ...checkpoint, cursor: { offset: 999 } }),
      () => fenced.startStage(stage),
      () => fenced.finishStage(stageId, { ...checkpoint, normalizedCount: 1, outOfWindowCount: 0, irrelevantCount: 0, storedCount: 1, storiesUpdated: 1 }),
      () => fenced.nextCountryBatch(1),
    ];
    for (const write of writes) await expect(write()).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(await countRows("article")).toBe(1);
    expect((await store.load(checkpoint.discoveryKey, "RSS"))?.cursor).toEqual({ offset: 1 });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM provider_ingestion_run").first()).toEqual({ count: 1 });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM ingestion_scheduler_state").first()).toEqual({ count: 0 });
    expect(await database.prepare("SELECT attempt_token FROM ingestion_operation_lock").first()).toEqual({ attempt_token: replacement.token });
    const current = new D1NewsStore(database).forIngestion("fenced-write-operation", replacement.token);
    await current.save({ ...checkpoint, cursor: { offset: 2 } });
    await database.prepare("UPDATE ingestion_operation_lock SET lease_until = 0").run();
    await expect(current.save(checkpoint)).rejects.toMatchObject({ code: "LEASE_LOST" });
    await database.prepare("DELETE FROM ingestion_operation_lock").run();
    await expect(current.nextCountryBatch(1)).rejects.toMatchObject({ code: "LEASE_LOST" });
  }, 20_000);

  it("round-trips failed feed progress across independent database store instances", async () => {
    const now = new Date().toISOString();
    const cursor = { offset: 1, completedPlanIds: ["https://feeds.bbci.co.uk/news/world/rss.xml"],
      attemptedPlanIds: ["https://feeds.bbci.co.uk/news/world/rss.xml", "https://www.aljazeera.com/xml/rss/all.xml"] };
    await store.save({ provider: "RSS", discoveryKey: "feed-progress", countryCode: null, language: null,
      mode: "incremental", status: "FAILED", windowStart: now, windowEnd: now, cursor,
      exhausted: false, coverageComplete: false, receivedCount: 1, acceptedCount: 1, duplicateCount: 0 });
    expect((await new D1NewsStore(database).load("feed-progress", "RSS"))?.cursor).toEqual(cursor);
  });

  it("rejects corrupt stored cursors instead of silently restarting discovery", async () => {
    const now = new Date().toISOString();
    await store.save({ provider: "GDELT", discoveryKey: "corrupt", countryCode: null, language: null, mode: "backfill",
      status: "PARTIAL", windowStart: now, windowEnd: now, cursor: null, exhausted: false, coverageComplete: false,
      receivedCount: 0, acceptedCount: 0, duplicateCount: 0 });
    for (const cursor of ["not json", "[]", '{"page":-1}', '{"before":"yesterday"}', '{"discoveryCursors":{"a":42}}']) {
      await database.prepare("UPDATE provider_ingestion_checkpoint SET cursor = ?").bind(cursor).run();
      await expect(store.load("corrupt", "GDELT")).rejects.toMatchObject({ code: "INVALID_STATE" });
    }
  });
  it("shares atomic GDELT starts and cooldowns across separate runtime instances", async () => {
    const first = new D1GdeltRateControl(database);
    const second = new D1GdeltRateControl(database);
    const now = 1_000_000;
    const slots = await Promise.all([first.acquire(now, 5500), second.acquire(now, 5500)]);
    expect(slots.filter(({ granted }) => granted)).toHaveLength(1);
    expect(slots.find(({ granted }) => !granted)?.waitMs).toBe(5500);
    expect(await first.defer("60", now, 0)).toBe(60_000);
    expect(await second.acquire(now + 5500, 5500)).toEqual({ granted: false, cooldown: true, waitMs: 54_500 });
    // A late short response cannot erase a previously observed long cooldown.
    await Promise.all([first.defer("120", now, 0), second.defer("30", now, 0)]);
    expect((await first.acquire(now + 60_000, 5500)).waitMs).toBe(60_000);
    expect((await second.acquire(now + 120_000, 5500)).granted).toBe(true);
    expect(await database.prepare("SELECT COUNT(*) AS count FROM provider_request_control").first()).toEqual({ count: 1 });
  });
  it("shares exponential fallback and expires backoff history after a quiet interval", async () => {
    const first = new D1GdeltRateControl(database); const second = new D1GdeltRateControl(database);
    const now = 1_000_000;
    expect(await first.defer(null, now, 0)).toBe(30_000);
    expect(await second.defer(null, now + 30_000, 0)).toBe(60_000);
    expect(await first.defer("bad", now + 90_000, 0)).toBe(120_000);
    expect(await second.defer(null, now + 1_000_000, 0)).toBe(30_000);
  });
  it("does not spend operation attempts or acquire the lock while a retry cooldown is active", async () => {
    const requests = store.ingestionRequests;
    const now = new Date();
    const accepted = await requests.claim("cooldown-operation", "digest", now);
    if (accepted.state !== "ACCEPTED") throw new Error("Expected acceptance");
    const summary = ingestionSummary({ stored: 0, providersFailed: 1,
      providerFailures: [{ provider: "GDELT", code: "HTTP_429", retryAfterMs: 60_000 }] });
    await requests.finish("cooldown-operation", accepted.token, "FAILED_RETRYABLE", summary, now);
    const early = await requests.claim("cooldown-operation", "digest", new Date(now.getTime() + 1000));
    expect(early).toMatchObject({ state: "FAILED_RETRYABLE", retryAfterMs: 59_000, attempts: 1 });
    expect(await database.prepare("SELECT lease_until FROM ingestion_operation_lock").first()).toEqual({ lease_until: 0 });
    expect(await requests.claim("cooldown-operation", "digest", new Date(now.getTime() + 60_000))).toMatchObject({ state: "ACCEPTED", attempts: 2 });
  });
  it("fails corrupted saved plans terminally and releases the operation lock", async () => {
    const now = new Date(); const requests = store.ingestionRequests;
    const accepted = await requests.claim("corrupted-operation", "digest", now);
    if (accepted.state !== "ACCEPTED") throw new Error("Expected acceptance");
    await requests.finish("corrupted-operation", accepted.token, "FAILED_RETRYABLE", null, now);
    await database.prepare("UPDATE ingestion_logical_request SET plan_json = ? WHERE request_id = ?").bind('{"snapshotTo":"invalid","countries":42}', "corrupted-operation").run();
    await expect(requests.claim("corrupted-operation", "digest", now)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await requests.claim("new-operation", "digest", now)).toMatchObject({ state: "ACCEPTED" });
  });
  it("reserves distinct country batches atomically and keeps archive rotation independent", async () => {
    const batches = await Promise.all([store.nextCountryBatch(1), store.nextCountryBatch(1)]);
    expect(batches[0]).not.toEqual(batches[1]);
    expect(await store.nextCountryBatch(1, "backfill")).toEqual(["US"]);
    expect(await database.prepare("SELECT COUNT(*) AS count FROM ingestion_scheduler_state").first()).toEqual({ count: 2 });
  });
  it.each([
    { stored: -1 }, { stagesProcessed: "one" }, { persisted: "true" },
    { providerFailures: [null] }, { providerFailures: [{ provider: "GDELT", code: "HTTP_429", retryAfterMs: -1 }] },
  ])("rejects corrupted completed summaries instead of replaying success: %j", async (corruption) => {
    const now = new Date(); const requests = store.ingestionRequests;
    const accepted = await requests.claim("corrupted-summary", "digest", now);
    if (accepted.state !== "ACCEPTED") throw new Error("Expected acceptance");
    await requests.finish("corrupted-summary", accepted.token, "SUCCEEDED", ingestionSummary(), now);
    await database.prepare("UPDATE ingestion_logical_request SET summary_json = ? WHERE request_id = ?")
      .bind(JSON.stringify({ ...ingestionSummary(), ...corruption }), "corrupted-summary").run();
    await expect(requests.claim("corrupted-summary", "digest", now)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await requests.claim("unrelated-operation", "digest", now)).toMatchObject({ state: "ACCEPTED" });
  });
  it("upgrades populated pre-retry D1 tables additively and keeps legacy failures terminal", async () => {
    const legacy = await miniflare.getD1Database("LEGACY", "news-test") as unknown as D1Database;
    for (const name of ["0000_world_news_d1.sql", "0001_parallel_martin_li.sql"]) {
      for (const statement of readFileSync(`drizzle/${name}`, "utf8").split("--> statement-breakpoint").filter((sql) => sql.trim())) {
        await legacy.prepare(statement).run();
      }
    }
    const legacyStore = new D1NewsStore(legacy);
    await persistStoryCandidates(clusterArticles([article("preserved", "Japan space telescope launch", [{ code: "JP", name: "Japan", relevanceScore: 1 }])]), legacyStore);
    const now = new Date();
    await legacy.prepare(`INSERT INTO ingestion_logical_request (request_id, body_digest, state, lease_until, expires_at, updated_at)
      VALUES ('legacy-failure', 'digest', 'FAILED', 0, ?, ?)`)
      .bind(now.getTime() + INGESTION_RECORD_TTL_MS, now.getTime()).run();
    const before = await legacy.prepare("SELECT * FROM article").all();
    for (const name of readdirSync("drizzle").filter((file) => file.endsWith(".sql") && file >= "0002").sort()) {
      for (const statement of readFileSync(`drizzle/${name}`, "utf8").split("--> statement-breakpoint").filter((sql) => sql.trim())) await legacy.prepare(statement).run();
    }
    expect((await legacy.prepare("SELECT * FROM article").all()).results).toEqual(before.results);
    expect(await legacy.prepare("SELECT COUNT(*) AS count FROM story_article").first()).toEqual({ count: 1 });
    expect((await new D1IngestionRequestStore(legacy).claim("legacy-failure", "digest", now)).state).toBe("FAILED_TERMINAL");
  });
  it("shares rate limits across independent instances and expires quotas without storing IP addresses", async () => {
    const first = new D1RateLimitStore(database);
    const second = new D1RateLimitStore(database);
    const options = { limit: 2, windowMs: 1000 };
    expect((await first.increment("203.0.113.2", options, 1000)).allowed).toBe(true);
    expect((await second.increment("203.0.113.2", options, 1001)).allowed).toBe(true);
    expect(await first.increment("203.0.113.2", options, 1002)).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 1 });
    const row = await database.prepare("SELECT client_key FROM api_rate_limit").first<{ client_key: string }>();
    expect(row?.client_key).toMatch(/^[a-f0-9]{64}$/);
    expect((await second.increment("203.0.113.2", options, 2001)).allowed).toBe(true);
  });

  it("atomically retries expired workers and fences old attempts from the new lease", async () => {
    const first = new D1IngestionRequestStore(database);
    const second = new D1IngestionRequestStore(database);
    const now = new Date();
    const results = await Promise.all([first.claim("same-operation", "digest", now), second.claim("same-operation", "digest", now)]);
    expect(results.map((result) => result.state).sort()).toEqual(["ACCEPTED", "RUNNING"]);
    const accepted = results.find((result) => result.state === "ACCEPTED")!;
    if (accepted.state !== "ACCEPTED") throw new Error("Expected acceptance");
    expect((await first.claim("other-operation", "digest", now)).state).toBe("BUSY");
    expect((await first.claim("same-operation", "changed-digest", now)).state).toBe("CONFLICT");
    const stale = new Date(now.getTime() + INGESTION_LEASE_MS + 1);
    const retried = await second.claim("same-operation", "digest", stale);
    expect(retried.state).toBe("ACCEPTED");
    if (retried.state !== "ACCEPTED") throw new Error("Expected retry");
    expect(retried.token).not.toBe(accepted.token);
    expect(await first.renew("same-operation", accepted.token, stale)).toBe(false);
    await expect(first.finish("same-operation", accepted.token, "SUCCEEDED", null, stale)).rejects.toThrow("lease was lost");
    await expect(first.savePlan("same-operation", accepted.token, { countries: [], snapshotTo: now.toISOString() }, stale)).rejects.toThrow("lease was lost");
    expect((await second.claim("other-operation", "digest", stale)).state).toBe("BUSY");
    expect(await second.renew("same-operation", retried.token, stale)).toBe(true);
    await second.finish("same-operation", retried.token, "FAILED_TERMINAL", null, stale);
    expect((await second.claim("same-operation", "digest", stale)).state).toBe("FAILED_TERMINAL");
    expect((await second.claim("other-operation", "digest", stale)).state).toBe("ACCEPTED");
    const expired = new Date(now.getTime() + INGESTION_RECORD_TTL_MS + 1);
    await first.claim("fresh-operation", "digest", expired);
    expect(await database.prepare("SELECT request_id FROM ingestion_logical_request WHERE request_id = 'same-operation'").first()).toBeNull();
  });

  it("bounds internal failure retries and retains terminal failure across an expired worker", async () => {
    const requests = new D1IngestionRequestStore(database);
    const now = new Date();
    for (let attempt = 1; attempt <= MAX_INGESTION_ATTEMPTS; attempt++) {
      const claim = await requests.claim("bounded-request", "digest", now);
      if (claim.state !== "ACCEPTED") throw new Error("Expected acceptance");
      expect(await requests.finish("bounded-request", claim.token, "FAILED_RETRYABLE", null, now))
        .toBe(attempt === MAX_INGESTION_ATTEMPTS ? "RETRY_BUDGET_EXHAUSTED" : "FAILED_RETRYABLE");
    }
    expect((await requests.claim("bounded-request", "digest", now)).state).toBe("RETRY_BUDGET_EXHAUSTED");
    const claim = await requests.claim("permanent-provider", "digest", now);
    if (claim.state !== "ACCEPTED") throw new Error("Expected acceptance");
    await requests.markTerminalFailure("permanent-provider", claim.token, now);
    expect((await requests.claim("permanent-provider", "digest", new Date(now.getTime() + INGESTION_LEASE_MS + 1))).state).toBe("FAILED_TERMINAL");
  });

  it("resumes a signed logical request after persistence succeeds but its checkpoint write fails", async () => {
    const secret = "integration-only-long-hmac-secret-at-least-32-chars";
    const firstTime = new Date();
    let now = firstTime;
    const body = JSON.stringify({ requestId: "transient-internal-request", scope: "countries", stageLimit: 4 });
    const signed = async (nonce: string) => {
      const timestamp = String(Math.floor(now.getTime() / 1000));
      return new Request("https://example.test/api/internal/ingest/run", { method: "POST", body, headers: {
        "Content-Type": "application/json", "X-Ingest-Timestamp": timestamp, "X-Ingest-Nonce": nonce,
        "X-Ingest-Signature": await signIngestionPayload(secret, timestamp, nonce, body),
      } });
    };
    const fakeProvider = (name: "RSS" | "GDELT"): NewsProvider => {
      const result = vi.fn(async (request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> => ({
        provider: name, receivedAt: firstTime.toISOString(), exhausted: true, continuation: null,
        articles: [{ provider: name, providerArticleId: name, title: name === "RSS" ? "Japan launches space research satellite" : "Japan announces nationwide hospital funding",
          description: "Japan government agencies published this report.", sourceName: "Integration News", sourceCountry: "JP",
          url: `https://example.com/resume-${name}`, publishedAt: new Date(firstTime.getTime() - 60_000).toISOString() }],
        coverage: { archiveCapable: true, timeRangeCovered: true, coveredFrom: request.from?.toISOString(), coveredTo: request.to?.toISOString() },
      }));
      return { name, capabilities: { latest: true, search: true, languages: true, sourceMetadata: true, requiresCredentials: false },
        fetchLatest: result, search: (_query, request) => result(request) };
    };
    const rss = fakeProvider("RSS"); const gdelt = fakeProvider("GDELT");
    vi.spyOn(providers, "createConfiguredProviders").mockReturnValue([rss, gdelt]);
    const rotation = vi.spyOn(D1NewsStore.prototype, "nextCountryBatch").mockResolvedValue(["JP"]);
    const originalSave = D1NewsStore.prototype.save;
    let failed = false;
    vi.spyOn(D1NewsStore.prototype, "save").mockImplementation(async function (this: D1NewsStore, checkpoint) {
      if (checkpoint.provider === "GDELT" && !failed) { failed = true; throw new Error("Transient D1 checkpoint failure"); }
      await originalSave.call(this, checkpoint);
    });
    const dependencies = { secret, now: () => now, store };
    expect((await handleIngestionRequest(await signed("a".repeat(32)), dependencies)).status).toBe(503);
    expect(await countRows("article")).toBe(2);
    const storiesBefore = await countRows("story");
    const saved = await database.prepare("SELECT state, plan_json FROM ingestion_logical_request WHERE request_id = ?").bind("transient-internal-request").first<{ state: string; plan_json: string }>();
    expect(saved?.state).toBe("FAILED_RETRYABLE");
    expect(JSON.parse(saved!.plan_json)).toEqual({ countries: ["JP"], snapshotTo: firstTime.toISOString() });
    now = new Date(firstTime.getTime() + 1000);
    providers.resetProviderRequestCacheForTesting();
    const retry = await handleIngestionRequest(await signed("b".repeat(32)), dependencies);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ state: "SUCCEEDED", summary: { checkpointsCompleted: 2, stagesProcessed: 1 } });
    expect(rotation).toHaveBeenCalledOnce();
    expect(rss.fetchLatest).toHaveBeenCalledOnce(); expect(gdelt.fetchLatest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(gdelt.fetchLatest).mock.calls[1][0]?.to).toEqual(firstTime);
    expect(await countRows("article")).toBe(2); expect(await countRows("story_article")).toBe(2);
    expect(await countRows("story")).toBe(storiesBefore);
    expect((await handleIngestionRequest(await signed("c".repeat(32)), dependencies)).status).toBe(200);
    expect((await handleIngestionRequest(await signed("b".repeat(32)), dependencies)).status).toBe(409);
    expect(gdelt.fetchLatest).toHaveBeenCalledTimes(2);
  }, 20_000);

  it.each(["HTTP_401", "HTTP_403", "HTTP_400", "PROVIDER_LIMIT", "MISSING_CREDENTIAL", "INVALID_QUERY"])("does not rerun terminal provider failure %s", async (code) => {
    const secret = "integration-only-long-hmac-secret-at-least-32-chars";
    const now = new Date();
    const fetchLatest = vi.fn(async (): Promise<ProviderFetchResult> => { throw new ProviderError("RSS", code, "permanent"); });
    vi.spyOn(providers, "createConfiguredProviders").mockReturnValue([{ name: "RSS",
      capabilities: { latest: true, search: true, languages: true, sourceMetadata: true, requiresCredentials: false }, fetchLatest, search: fetchLatest }]);
    const body = JSON.stringify({ requestId: "terminal-provider-request", scope: "global", stageLimit: 1 });
    for (let attempt = 0; attempt < 2; attempt++) {
      const nonce = crypto.randomUUID().replaceAll("-", ""); const timestamp = String(Math.floor(now.getTime() / 1000));
      const request = new Request("https://example.test/api/internal/ingest/run", { method: "POST", body, headers: {
        "Content-Type": "application/json", "X-Ingest-Timestamp": timestamp, "X-Ingest-Nonce": nonce,
        "X-Ingest-Signature": await signIngestionPayload(secret, timestamp, nonce, body),
      } });
      const response = await handleIngestionRequest(request, { secret, now: () => now, store });
      expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ state: "FAILED_TERMINAL" });
      providers.resetProviderRequestCacheForTesting();
    }
    expect(fetchLatest).toHaveBeenCalledOnce();
  });

  it("makes a fresh provider attempt on a signed retry instead of replaying its cached 503", async () => {
    const secret = "integration-only-long-hmac-secret-at-least-32-chars";
    let now = new Date();
    const fetchLatest = vi.fn().mockRejectedValueOnce(new ProviderError("GDELT", "HTTP_503", "transient"))
      .mockResolvedValue({ provider: "GDELT", articles: [], receivedAt: now.toISOString(), exhausted: true, continuation: null });
    vi.spyOn(providers, "createConfiguredProviders").mockReturnValue([{ name: "GDELT",
      capabilities: { latest: true, search: true, languages: true, sourceMetadata: true, requiresCredentials: false }, fetchLatest, search: fetchLatest }]);
    const body = JSON.stringify({ requestId: "cached-provider-failure", scope: "global", stageLimit: 1 });
    for (let attempt = 0; attempt < 2; attempt++) {
      const nonce = crypto.randomUUID().replaceAll("-", ""); const timestamp = String(Math.floor(now.getTime() / 1000));
      const request = new Request("https://example.test/api/internal/ingest/run", { method: "POST", body, headers: {
        "Content-Type": "application/json", "X-Ingest-Timestamp": timestamp, "X-Ingest-Nonce": nonce,
        "X-Ingest-Signature": await signIngestionPayload(secret, timestamp, nonce, body),
      } });
      const response = await handleIngestionRequest(request, { secret, now: () => now, store });
      expect(response.status).toBe(attempt === 0 ? 503 : 200);
      expect(await response.json()).toMatchObject({ state: attempt === 0 ? "FAILED_RETRYABLE" : "SUCCEEDED",
        summary: { providerFailures: attempt === 0 ? [{ provider: "GDELT", code: "HTTP_503" }] : [] } });
      now = new Date(now.getTime() + 1000);
    }
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it("returns running/completed signed retries without duplicating ingestion and retains nonce rejection", async () => {
    const secret = "integration-only-long-hmac-secret-at-least-32-chars";
    const now = new Date();
    const body = JSON.stringify({ requestId: "logical-operation-0001", scope: "global", stageLimit: 1 });
    const signed = async (raw = body, nonce = crypto.randomUUID().replaceAll("-", "")) => {
      const timestamp = String(Math.floor(now.getTime() / 1000));
      return new Request("https://example.test/api/internal/ingest/run", { method: "POST", body: raw, headers: {
        "Content-Type": "application/json", "X-Ingest-Timestamp": timestamp, "X-Ingest-Nonce": nonce,
        "X-Ingest-Signature": await signIngestionPayload(secret, timestamp, nonce, raw),
      } });
    };
    let finish: ((summary: IngestionSummary) => void) | undefined;
    const running = new Promise<IngestionSummary>((resolve) => { finish = resolve; });
    const run = vi.fn(async () => running);
    const dependencies = { secret, now: () => now, store, run };
    const firstRequest = await signed(body, "a".repeat(32));
    const first = handleIngestionRequest(firstRequest, dependencies);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce(), { timeout: 5000 });
    const replay = await handleIngestionRequest(await signed(), dependencies);
    expect(replay.status).toBe(202); expect(await replay.json()).toMatchObject({ state: "RUNNING" });
    expect((await handleIngestionRequest(await signed(body, "a".repeat(32)), dependencies)).status).toBe(409);
    const completed = ingestionSummary({ runId: "run-original", stored: 7, storiesUpdated: 4 });
    finish!(completed);
    expect((await first).status).toBe(200);
    const retry = await handleIngestionRequest(await signed(), dependencies);
    expect(retry.status).toBe(200); expect(await retry.json()).toMatchObject({ summary: completed });
    expect(run).toHaveBeenCalledOnce();
    expect((await handleIngestionRequest(await signed(body.replace('"global"', '"countries"')), dependencies)).status).toBe(409);
  }, 20_000);

  it("persists and reclusters idempotently with every relational link intact", async () => {
    const initial = article("cluster-a", "Japan launches a regional technology programme", [{ code: "JP", name: "Japan", relevanceScore: 1 }]);
    await persistStoryCandidates(clusterArticles([initial]), store);
    await persistStoryCandidates(clusterArticles([initial]), store);
    expect(await countRows("article")).toBe(1);
    expect(await countRows("story")).toBe(1);
    expect(await countRows("story_article")).toBe(1);

    const related = article("cluster-b", "Japan and Singapore launch technology programme", [
      { code: "JP", name: "Japan", relevanceScore: 1 },
      { code: "SG", name: "Singapore", relevanceScore: 1 },
    ], { topics: ["technology"] });
    await persistStoryCandidates(clusterArticles([{ ...initial, topics: ["technology"] }, related]), store);
    const query = { ...baseQuery, countries: ["JP", "SG"], topic: "technology" };
    const response = buildNewsResponse(await loadDatabaseStories(query, store), query, "database");
    expect(response.meta.total).toBe(1);
    expect(response.stories[0].articles).toHaveLength(2);
    expect(response.stories[0].countries.map(({ code }) => code).sort()).toEqual(["JP", "SG"]);
    expect(await countRows("story")).toBe(1);
  }, 15_000);

  it("preserves untouched articles when a later provider stage reclusters only part of a story", async () => {
    const first = article("partial-a", "Japan technology investment expands", [{ code: "JP", name: "Japan", relevanceScore: 1 }]);
    const second = article("partial-b", first.title, [{ code: "SG", name: "Singapore", relevanceScore: 1 }], { topics: ["technology"], ageMinutes: 90 });
    // Explicit candidates reproduce different provider batches independently of
    // the similarity threshold used by the clustering algorithm.
    const combined = { ...clusterArticles([first])[0], articles: [first, second] };
    await store.persistStoryCandidates([combined]);
    await store.persistStoryCandidates([clusterArticles([first])[0]]);
    expect(await countRows("story_article")).toBe(2);
    expect((await store.loadStories({ ...baseQuery, countries: ["SG"], topic: "technology" })).flatMap(({ articles }) => articles).map(({ canonicalUrl }) => canonicalUrl)).toContain(second.canonicalUrl);

    const changed = { ...first, title: "Japan election results announced", topics: ["politics"] };
    await store.persistStoryCandidates(clusterArticles([changed]));
    expect(await countRows("article")).toBe(2);
    expect(await countRows("story_article")).toBe(2);
    expect(await countRows("story")).toBe(2);
    const remaining = await store.loadStories({ ...baseQuery, countries: ["SG"], topic: "technology" });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].articles.map(({ canonicalUrl }) => canonicalUrl)).toEqual([second.canonicalUrl]);
    expect(remaining[0].title).toBe(second.title);
    expect(remaining[0].firstPublishedAt).toBe(second.publishedAt);
    expect(remaining[0].countries.map(({ code }) => code)).toEqual(["SG"]);
  }, 20_000);

  it("returns Unicode, source, topic, country, and newest-first queries", async () => {
    const older = article("old", "Older Japan politics report", [{ code: "JP", name: "Japan", relevanceScore: 1 }], { ageMinutes: 90, sourceName: "Example News" });
    const newest = article("new", "日本政府が半導体投資を発表", [{ code: "JP", name: "Japan", relevanceScore: 1 }], { ageMinutes: 1, topics: ["technology"], language: "ja" });
    await persistStoryCandidates([...clusterArticles([older]), ...clusterArticles([newest])], store);
    const all = await loadDatabaseStories({ ...baseQuery, countries: ["JP"] }, store);
    expect(all.map(({ title }) => title)).toEqual(["日本政府が半導体投資を発表", "Older Japan politics report"]);
    const japanese = await loadDatabaseStories({ ...baseQuery, countries: ["JP"], topic: "technology", language: "ja" }, store);
    expect(japanese).toHaveLength(1);
    const sourceId = canonicalSourceId({ name: "Example News", domain: null, countryCode: "JP" });
    const exactSource = await loadDatabaseStories({ ...baseQuery, sources: [sourceId] }, store);
    expect(exactSource.map(({ title }) => title)).toEqual(["Older Japan politics report"]);
  });

  it("persists checkpoints, scheduler rotation, and nonce replay protection", async () => {
    const now = new Date("2026-09-02T00:00:00.000Z");
    const windowStart = new Date("2026-08-03T00:00:00.000Z");
    vi.stubEnv("GDELT_ENABLED", "true");
    vi.stubEnv("NEWSAPI_KEY", "");
    for (const provider of ["OTHER", "RSS", "GDELT"] as const) {
      await store.save({
        provider, discoveryKey: "backfill:JP:30d:all", countryCode: "JP", language: null, mode: "backfill",
        status: "SUCCEEDED", windowStart: windowStart.toISOString(), windowEnd: now.toISOString(), cursor: null,
        exhausted: true, coverageComplete: provider === "GDELT", receivedCount: 10, acceptedCount: 8, duplicateCount: 2,
        coveredFrom: provider === "GDELT" ? windowStart.toISOString() : undefined,
        coveredTo: provider === "GDELT" ? now.toISOString() : undefined, lastSuccessfulAt: now.toISOString(),
      });
    }
    await expect(loadDatabaseCoverage({ ...baseQuery, countries: ["JP"] }, store, now))
      .resolves.toMatchObject({ complete: true, archiveComplete: true, checkpointCount: 3 });
    expect(await store.nextCountryBatch(4)).not.toEqual(await store.nextCountryBatch(4));
    const expiresAt = new Date(now.getTime() + 300_000);
    await expect(store.claimIngestionNonce("a".repeat(24), now, expiresAt)).resolves.toBe(true);
    await expect(store.claimIngestionNonce("a".repeat(24), now, expiresAt)).resolves.toBe(false);
    await expect(store.deleteExpiredIngestionNonces(new Date(expiresAt.getTime() + 1))).resolves.toBe(1);
  });
});
