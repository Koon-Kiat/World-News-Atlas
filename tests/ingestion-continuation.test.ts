import { beforeEach, describe, expect, it } from "vitest";
import { ingestionCountryBatchSize, runNewsIngestion } from "@/lib/news/ingest";
import {
  countryBatchForRun,
  discoveryKeyFor,
  HIGH_VOLUME_COUNTRIES,
  MemoryIngestionStateStore,
} from "@/lib/news/ingestion-state";
import { resetProviderRequestCacheForTesting } from "@/lib/news/providers";
import { ProviderError, type NewsProvider } from "@/lib/news/providers/provider";
import type {
  ProviderFetchRequest,
  ProviderFetchResult,
  ProviderName,
} from "@/lib/news/types";

class HistoricalProvider implements NewsProvider {
  readonly name = "GDELT" as const;
  readonly capabilities = { latest: true, search: true, languages: true, sourceMetadata: true, requiresCredentials: false } as const;
  readonly offsets: number[] = [];
  readonly windows: Array<{ from?: string; to?: string }> = [];
  result(request: ProviderFetchRequest): ProviderFetchResult {
    const offset = request.continuation?.offset ?? 0;
    this.offsets.push(offset);
    this.windows.push({ from: request.from?.toISOString(), to: request.to?.toISOString() });
    const final = offset === 3;
    return {
      provider: this.name,
      articles: [{
        provider: this.name,
        providerArticleId: `archive-${offset}`,
        title: `Archiveevent${offset} bulletin${offset * 13}`,
        description: "United States agencies published an update.",
        url: `https://archive.example/${offset}`,
        publishedAt: new Date(Date.UTC(2026, 7, 30) - offset * 6 * 24 * 3_600_000).toISOString(),
        sourceName: "Archive Desk",
        language: "en",
      }],
      receivedAt: new Date().toISOString(),
      continuation: final ? null : { offset: offset + 1 },
      exhausted: final,
      coverage: {
        archiveCapable: true,
        windowStart: request.from?.toISOString(),
        windowEnd: request.to?.toISOString(),
        coveredFrom: final ? request.from?.toISOString() : new Date(Date.UTC(2026, 7, 30) - offset * 6 * 24 * 3_600_000).toISOString(),
        coveredTo: request.to?.toISOString(),
        timeRangeCovered: final,
        exhaustionReason: final ? "time_range_covered" : undefined,
      },
    };
  }
  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> { return Promise.resolve(this.result(request)); }
  search(_query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> { return Promise.resolve(this.result(request)); }
}

class ResumableProvider implements NewsProvider {
  readonly capabilities = { latest: true, search: true, languages: true, sourceMetadata: true, requiresCredentials: false } as const;
  readonly steps: number[] = [];
  private readonly cursorSteps = new Map<string, number>();
  constructor(readonly name: ProviderName, private readonly totalStages: number) {}
  private stepFor(request: ProviderFetchRequest): number {
    if (this.name === "NEWSAPI") return Math.max(0, (request.continuation?.page ?? 1) - 1);
    if (this.name === "GDELT") return request.continuation?.before
      ? this.cursorSteps.get(request.continuation.before) ?? 0
      : 0;
    return request.continuation?.completedPlanIds?.length ?? request.continuation?.offset ?? 0;
  }
  private result(request: ProviderFetchRequest): ProviderFetchResult {
    const step = this.stepFor(request);
    this.steps.push(step);
    const exhausted = step + 1 >= this.totalStages;
    let continuation: ProviderFetchResult["continuation"] = null;
    if (!exhausted && this.name === "NEWSAPI") continuation = { page: step + 2 };
    else if (!exhausted && this.name === "GDELT") {
      const before = new Date(Date.UTC(2026, 7, 30, 0, 0) - step * 3_600_000).toISOString();
      this.cursorSteps.set(before, step + 1);
      continuation = { before };
    } else if (!exhausted) {
      continuation = {
        offset: step + 1,
        completedPlanIds: Array.from({ length: step + 1 }, (_, index) => `${this.name}-${index}`),
      };
    }
    return {
      provider: this.name,
      articles: [{
        provider: this.name,
        providerArticleId: `${this.name}-${step}`,
        title: `United States ${this.name} event ${step}`,
        description: "United States agencies published a distinct update.",
        url: `https://${this.name.toLowerCase()}.example/${step}`,
        publishedAt: new Date(Date.UTC(2026, 7, 30, 12) - step * 3_600_000).toISOString(),
        sourceName: `${this.name} desk`,
        language: "en",
      }],
      receivedAt: new Date().toISOString(),
      continuation,
      exhausted,
      coverage: {
        archiveCapable: this.name === "NEWSAPI" || this.name === "GDELT",
        windowStart: request.from?.toISOString(),
        windowEnd: request.to?.toISOString(),
        coveredFrom: exhausted ? request.from?.toISOString() : undefined,
        coveredTo: request.to?.toISOString(),
        timeRangeCovered: exhausted && (this.name === "NEWSAPI" || this.name === "GDELT"),
        exhaustionReason: exhausted
          ? this.name === "NEWSAPI" || this.name === "GDELT"
            ? "time_range_covered"
            : this.name === "RSS"
              ? "feed_exhausted"
              : "plan_exhausted"
          : undefined,
      },
    };
  }
  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> { return Promise.resolve(this.result(request)); }
  search(_query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> { return Promise.resolve(this.result(request)); }
}

beforeEach(() => resetProviderRequestCacheForTesting());

describe("bounded resumable ingestion", () => {
  it("saves a cursor at the worker budget and resumes the same fixed 30-day snapshot", async () => {
    const provider = new HistoricalProvider();
    const store = new MemoryIngestionStateStore();
    const snapshotTo = new Date("2026-08-31T00:00:00Z");
    const first = await runNewsIngestion({ providers: [provider], persist: false, stateStore: store, mode: "backfill", period: "30d", countries: ["US"], stageLimit: 2, snapshotTo });
    expect(first).toMatchObject({ stagesProcessed: 2, budgetExhausted: true, accepted: 2 });
    expect(provider.offsets).toEqual([0, 1]);
    const key = discoveryKeyFor({ mode: "backfill", countryCode: "US", period: "30d" });
    expect(await store.load(key, "GDELT")).toMatchObject({ cursor: { offset: 2 }, coverageComplete: false, status: "PARTIAL" });

    const second = await runNewsIngestion({ providers: [provider], persist: false, stateStore: store, mode: "backfill", period: "30d", countries: ["US"], stageLimit: 4, snapshotTo: new Date("2026-09-01T00:00:00Z") });
    expect(provider.offsets).toEqual([0, 1, 2, 3]);
    expect(second).toMatchObject({ stagesProcessed: 2, checkpointsCompleted: 1 });
    expect(await store.load(key, "GDELT")).toMatchObject({ cursor: null, exhausted: true, coverageComplete: true, windowEnd: "2026-08-31T00:00:00.000Z" });

    const repeated = await runNewsIngestion({ providers: [provider], persist: false, stateStore: store, mode: "backfill", period: "30d", countries: ["US"], stageLimit: 4, snapshotTo });
    expect(repeated).toMatchObject({ stagesProcessed: 0, checkpointsCompleted: 1 });
    expect(provider.offsets).toEqual([0, 1, 2, 3]);

    const extension = await runNewsIngestion({ providers: [provider], persist: false, stateStore: store, mode: "backfill", period: "30d", countries: ["US"], stageLimit: 4, snapshotTo: new Date("2026-09-01T00:00:00Z") });
    expect(extension.stagesProcessed).toBe(4);
    expect(provider.windows.slice(-4)).toEqual(Array.from({ length: 4 }, () => ({
      from: "2026-08-31T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    })));
  });

  it("rotates every structured high-volume country while retaining regular-country capacity", () => {
    const batches = Array.from({ length: 5 }, (_, run) => countryBatchForRun(run, 8));
    const selected = new Set(batches.flat());
    expect(HIGH_VOLUME_COUNTRIES.every((code) => selected.has(code))).toBe(true);
    expect(batches.every((batch) => batch.some((code) => !HIGH_VOLUME_COUNTRIES.includes(code as typeof HIGH_VOLUME_COUNTRIES[number])))).toBe(true);
    expect(countryBatchForRun(0, 1)[0]).toBe(HIGH_VOLUME_COUNTRIES[0]);
    expect(HIGH_VOLUME_COUNTRIES).not.toContain(countryBatchForRun(1, 1)[0] as typeof HIGH_VOLUME_COUNTRIES[number]);
    expect(ingestionCountryBatchSize(8, 24, 4)).toBe(6);
  });

  it("resumes every provider cursor shape until all bounded plans, feeds, pages, and windows finish", async () => {
    const providers = [
      new ResumableProvider("OTHER", 3),
      new ResumableProvider("RSS", 2),
      new ResumableProvider("NEWSAPI", 3),
      new ResumableProvider("GDELT", 3),
    ];
    const store = new MemoryIngestionStateStore();
    const options = {
      providers,
      persist: false,
      stateStore: store,
      mode: "backfill" as const,
      period: "30d" as const,
      countries: ["US"],
      stageLimit: 4,
      snapshotTo: new Date("2026-08-31T00:00:00Z"),
    };
    for (let run = 0; run < 4; run += 1) await runNewsIngestion(options);

    expect(providers.map(({ steps }) => steps)).toEqual([
      [0, 1, 2],
      [0, 1],
      [0, 1, 2],
      [0, 1, 2],
    ]);
    const key = discoveryKeyFor({ mode: "backfill", countryCode: "US", period: "30d" });
    await Promise.all(providers.map(async ({ name }) => {
      const checkpoint = await store.load(key, name);
      expect(checkpoint?.exhausted).toBe(true);
      expect(checkpoint?.cursor).toBeNull();
    }));
  });

  it("persists a provider ceiling as partial exhausted coverage without retrying the same fixed window", async () => {
    let calls = 0;
    const provider: NewsProvider = {
      name: "NEWSAPI",
      capabilities: { latest: true, search: true, languages: true, sourceMetadata: true, requiresCredentials: true },
      fetchLatest: async () => {
        calls += 1;
        throw new ProviderError("NEWSAPI", "PROVIDER_LIMIT", "simulated plan ceiling");
      },
      search: async () => {
        calls += 1;
        throw new ProviderError("NEWSAPI", "PROVIDER_LIMIT", "simulated plan ceiling");
      },
    };
    const store = new MemoryIngestionStateStore();
    const snapshotTo = new Date("2026-08-31T00:00:00Z");
    const options = { providers: [provider], persist: false, stateStore: store, mode: "backfill" as const, period: "30d" as const, countries: ["US"], stageLimit: 1, snapshotTo };
    await runNewsIngestion(options);
    await runNewsIngestion(options);

    const key = discoveryKeyFor({ mode: "backfill", countryCode: "US", period: "30d" });
    expect(calls).toBe(1);
    expect(await store.load(key, "NEWSAPI")).toMatchObject({
      status: "PARTIAL",
      exhausted: true,
      coverageComplete: false,
      lastSuccessfulAt: undefined,
    });
  });
});
