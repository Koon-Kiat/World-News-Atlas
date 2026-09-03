import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  liveBatchSize,
  liveCorpusLimit,
  loadNewsDataset,
  resetLiveCorpusForTesting,
  setLiveProviderFactoryForTesting,
} from "@/lib/news/data-store";
import { resetProviderRequestCacheForTesting } from "@/lib/news/providers";
import { ProviderError, type NewsProvider } from "@/lib/news/providers/provider";
import { buildNewsResponse, DEFAULT_NEWS_QUERY } from "@/lib/news/query";
import type {
  NewsQuery,
  ProviderArticle,
  ProviderFetchRequest,
  ProviderFetchResult,
  ProviderName,
} from "@/lib/news/types";

const query = (page: number, sort: NewsQuery["sort"] = "newest"): NewsQuery => ({
  ...DEFAULT_NEWS_QUERY,
  page,
  pageSize: 12,
  sort,
});

class PagedProvider implements NewsProvider {
  readonly capabilities = {
    latest: true,
    search: true,
    languages: true,
    sourceMetadata: true,
    requiresCredentials: false,
  } as const;
  readonly offsets: number[] = [];

  constructor(
    readonly name: ProviderName,
    private readonly total: number,
    private readonly sourcePrefix = "Provider",
  ) {}

  private result(request: ProviderFetchRequest): ProviderFetchResult {
    const offset = request.continuation?.offset ?? 0;
    this.offsets.push(offset);
    const count = Math.min(request.limit ?? 96, Math.max(0, this.total - offset));
    const articles: ProviderArticle[] = Array.from({ length: count }, (_, index) => {
      const articleIndex = offset + index;
      return {
        provider: this.name,
        providerArticleId: `${this.name}-${articleIndex}`,
        title: `Independent report ${articleIndex} on event ${articleIndex}`,
        description: `Current coverage item ${articleIndex}.`,
        url: `https://${this.name.toLowerCase()}-${this.sourcePrefix.toLowerCase()}.example/story-${articleIndex}`,
        publishedAt: new Date(Date.UTC(2026, 7, 30, 20, 0) - articleIndex * 60_000).toISOString(),
        language: "en",
        sourceName: `${this.sourcePrefix} ${articleIndex}`,
      };
    });
    const nextOffset = offset + count;
    const exhausted = nextOffset >= this.total;
    return {
      provider: this.name,
      articles,
      receivedAt: new Date().toISOString(),
      continuation: exhausted ? null : { offset: nextOffset },
      exhausted,
    };
  }

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return Promise.resolve(this.result(request));
  }

  search(_query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return Promise.resolve(this.result(request));
  }
}

class WindowRecordingProvider extends PagedProvider {
  readonly windows: Array<{ from?: string; to?: string }> = [];

  override fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    this.windows.push({
      from: request.from?.toISOString(),
      to: request.to?.toISOString(),
    });
    return super.fetchLatest(request);
  }
}

class SameStoryProvider implements NewsProvider {
  readonly name = "OTHER" as const;
  readonly capabilities = {
    latest: true,
    search: true,
    languages: true,
    sourceMetadata: true,
    requiresCredentials: false,
  } as const;
  calls = 0;

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.search("world", request);
  }

  search(_query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    this.calls += 1;
    const second = Boolean(request.continuation?.offset);
    const common = {
      provider: this.name,
      publishedAt: "2026-08-30T12:00:00Z",
      language: "en",
    } as const;
    const articles: ProviderArticle[] = second
      ? [{
          ...common,
          providerArticleId: "same-tracked",
          title: "Japan launches lunar probe toward Moon",
          url: "https://bbc.com/lunar-probe?utm_source=bing",
          sourceName: "BBC",
        }, {
          ...common,
          providerArticleId: "reuters-followup",
          title: "Japan launches lunar probe to Moon",
          url: "https://reuters.com/world/japan-lunar-probe",
          sourceName: "Reuters",
        }]
      : [{
          ...common,
          providerArticleId: "same",
          title: "Japan launches lunar probe toward Moon",
          url: "https://bbc.com/lunar-probe",
          sourceName: "BBC",
        }];
    return Promise.resolve({
      provider: this.name,
      articles,
      receivedAt: new Date().toISOString(),
      continuation: second ? null : { offset: 1 },
      exhausted: second,
    });
  }
}

class OutOfOrderProvider implements NewsProvider {
  readonly name = "OTHER" as const;
  readonly capabilities = {
    latest: true,
    search: true,
    languages: true,
    sourceMetadata: true,
    requiresCredentials: false,
  } as const;

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    const laterStage = Boolean(request.continuation?.offset);
    const publishedAt = laterStage ? "2026-08-30T18:00:00Z" : "2026-08-30T12:00:00Z";
    return Promise.resolve({
      provider: this.name,
      articles: [{
        provider: this.name,
        providerArticleId: laterStage ? "newer" : "older",
        title: laterStage ? "Newer independent update" : "Older independent report",
        description: "A separately reported development.",
        url: `https://ordering.example/${laterStage ? "newer" : "older"}`,
        publishedAt,
        language: "en",
        sourceName: "Ordering Wire",
      }],
      receivedAt: new Date().toISOString(),
      continuation: laterStage ? null : { offset: 1 },
      exhausted: laterStage,
    });
  }

  search(_query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.fetchLatest(request);
  }
}

class FailingProvider implements NewsProvider {
  readonly name = "NEWSAPI" as const;
  readonly capabilities = {
    latest: true,
    search: true,
    languages: true,
    sourceMetadata: true,
    requiresCredentials: true,
  } as const;
  calls = 0;

  fetchLatest(): Promise<ProviderFetchResult> {
    this.calls += 1;
    return Promise.reject(new Error("temporary provider failure"));
  }

  search(): Promise<ProviderFetchResult> {
    return this.fetchLatest();
  }
}

class TerminalFailureProvider extends FailingProvider {
  fetchLatest(): Promise<ProviderFetchResult> {
    this.calls += 1;
    return Promise.reject(new ProviderError(this.name, "HTTP_400", "invalid provider query"));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-31T00:00:00Z"));
  vi.stubEnv("NEWS_FIXTURES_ENABLED", "false");
  vi.stubEnv("NEWS_LIVE_BATCH_SIZE", "96");
  vi.stubEnv("NEWS_LIVE_CORPUS_LIMIT", "220");
  vi.stubEnv("NEWS_LIVE_LOW_WATER", "24");
  vi.stubEnv("NEWS_SEMANTIC_CLUSTERING_ENABLED", "false");
  resetProviderRequestCacheForTesting();
  resetLiveCorpusForTesting();
});

afterEach(() => {
  setLiveProviderFactoryForTesting();
  resetProviderRequestCacheForTesting();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("incremental live corpus", () => {
  it("keeps the per-stage batch independent from the accumulated corpus limit", () => {
    expect(liveBatchSize()).toBe(96);
    expect(liveCorpusLimit()).toBe(220);
  });

  it("uses larger accumulated relevant-corpus limits for longer periods", () => {
    vi.stubEnv("NEWS_LIVE_CORPUS_LIMIT", "2000");
    expect(liveCorpusLimit("24h")).toBe(360);
    expect(liveCorpusLimit("latest")).toBe(500);
    expect(liveCorpusLimit("7d")).toBe(750);
    expect(liveCorpusLimit("30d")).toBe(1000);
    expect(liveBatchSize()).toBe(96);
  });

  it("separates cached corpora when a material query parameter changes", async () => {
    const provider = new PagedProvider("OTHER", 300);
    setLiveProviderFactoryForTesting(() => [provider]);

    await loadNewsDataset(query(1));
    await loadNewsDataset({ ...query(1), language: "ja" });
    await loadNewsDataset({ ...query(1), sources: ["nhk"] });

    expect(provider.offsets).toEqual([0, 0, 0]);
  });

  it("pins one exact provider time range for every stage in a live corpus lifecycle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00Z"));
    const provider = new WindowRecordingProvider("OTHER", 300);
    setLiveProviderFactoryForTesting(() => [provider]);

    await loadNewsDataset(query(1));
    vi.setSystemTime(new Date("2026-08-31T00:45:00Z"));
    await loadNewsDataset(query(6));

    expect(provider.windows).toHaveLength(2);
    expect(provider.windows[0]).toEqual(provider.windows[1]);
    expect(provider.windows[0].to).toBe("2026-08-31T00:00:00.000Z");
  });

  it("keeps worker stages bounded while growing past 200 stable stories to the corpus maximum", async () => {
    const provider = new PagedProvider("OTHER", 300);
    setLiveProviderFactoryForTesting(() => [provider]);

    const first = await loadNewsDataset(query(1));
    expect(first.articleCount).toBe(96);
    expect(first.stories).toHaveLength(96);
    expect(first.corpusComplete).toBe(false);
    const firstResponse = buildNewsResponse(
      first.stories,
      query(1),
      first.dataSource,
      first.notice,
      first,
    );
    expect(firstResponse.meta).toMatchObject({
      total: 96,
      articleCount: 96,
      corpusComplete: false,
      hasMore: true,
      nextPage: 2,
    });
    const initialIds = first.stories.slice(0, 24).map(({ id }) => id);

    const cached = await loadNewsDataset(query(2));
    expect(cached.articleCount).toBe(96);
    expect(provider.offsets).toEqual([0]);

    const secondStage = await loadNewsDataset(query(6));
    expect(secondStage.articleCount).toBe(192);
    expect(secondStage.stories.slice(0, 24).map(({ id }) => id)).toEqual(initialIds);

    const finalStage = await loadNewsDataset(query(14));
    expect(finalStage.articleCount).toBe(220);
    expect(finalStage.stories.length).toBeGreaterThanOrEqual(200);
    expect(finalStage.corpusComplete).toBe(true);
    expect(provider.offsets).toEqual([0, 96, 192]);

    const response = buildNewsResponse(
      finalStage.stories,
      query(14),
      finalStage.dataSource,
      finalStage.notice,
      finalStage,
    );
    expect(response.meta).toMatchObject({
      total: 220,
      articleCount: 220,
      materializedStoryCount: 220,
      corpusComplete: true,
    });
    const exhaustedResponse = buildNewsResponse(
      finalStage.stories,
      query(19),
      finalStage.dataSource,
      finalStage.notice,
      finalStage,
    );
    expect(exhaustedResponse.meta).toMatchObject({ hasMore: false, nextPage: null });
  });

  it("deduplicates across stages and merges later coverage into the stable earlier story", async () => {
    const provider = new SameStoryProvider();
    setLiveProviderFactoryForTesting(() => [provider]);

    const first = await loadNewsDataset(query(1));
    const firstId = first.stories[0].id;
    const second = await loadNewsDataset(query(1));

    expect(provider.calls).toBe(2);
    expect(second.articleCount).toBe(2);
    expect(second.stories).toHaveLength(1);
    expect(second.stories[0].id).toBe(firstId);
    expect(second.stories[0].articles).toHaveLength(2);
    expect(new Set(second.stories[0].articles.map(({ canonicalUrl }) => canonicalUrl)).size).toBe(2);
    const response = buildNewsResponse(
      second.stories,
      query(1),
      second.dataSource,
      second.notice,
      second,
    );
    expect(response.meta).toMatchObject({
      total: 1,
      materializedStoryCount: 1,
      articleCount: 2,
    });
  });

  it("reorders a newer story discovered in a later stage ahead of older coverage", async () => {
    setLiveProviderFactoryForTesting(() => [new OutOfOrderProvider()]);

    const first = await loadNewsDataset(query(1));
    const second = await loadNewsDataset(query(1));

    expect(first.stories.map(({ title }) => title)).toEqual(["Older independent report"]);
    expect(second.stories.map(({ title }) => title)).toEqual([
      "Newer independent update",
      "Older independent report",
    ]);
  });

  it("preserves provider diversity and never requests an exhausted provider again", async () => {
    const rss = new PagedProvider("RSS", 10, "RSS");
    const bing = new PagedProvider("OTHER", 160, "Bing");
    setLiveProviderFactoryForTesting(() => [rss, bing]);

    const first = await loadNewsDataset(query(1, "popular"));
    const originalOrder = first.stories.map(({ id }) => id);
    expect(first.stories.some((story) => story.articles[0].provider === "RSS")).toBe(true);
    expect(first.stories.some((story) => story.articles[0].provider === "OTHER")).toBe(true);

    const expanded = await loadNewsDataset(query(7, "popular"));
    expect(expanded.stories.slice(0, originalOrder.length).map(({ id }) => id)).toEqual(originalOrder);
    expect(rss.offsets).toEqual([0]);
    expect(bing.offsets).toEqual([0, 96]);
  });

  it("isolates a failing provider while healthy continuation keeps expanding", async () => {
    const failing = new FailingProvider();
    const healthy = new PagedProvider("OTHER", 140, "Healthy");
    setLiveProviderFactoryForTesting(() => [failing, healthy]);

    const first = await loadNewsDataset(query(1));
    expect(first.stories).toHaveLength(96);
    const second = await loadNewsDataset(query(7));
    expect(second.stories).toHaveLength(140);
    expect(second.stories.length - first.stories.length).toBeLessThanOrEqual(liveBatchSize());
    expect(healthy.offsets).toEqual([0, 96]);
    expect(failing.calls).toBe(1);
    expect(second.corpusComplete).toBe(false);
  });

  it("lets a corpus finish when another provider has a terminal request failure", async () => {
    const failing = new TerminalFailureProvider();
    const healthy = new PagedProvider("OTHER", 10, "Healthy");
    setLiveProviderFactoryForTesting(() => [failing, healthy]);

    const result = await loadNewsDataset(query(1));

    expect(result.stories).toHaveLength(10);
    expect(result.corpusComplete).toBe(true);
    expect(failing.calls).toBe(1);
  });

  it("marks an expired process-local continuation as reset instead of silently reusing it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00Z"));
    const provider = new PagedProvider("OTHER", 40, "Reset");
    setLiveProviderFactoryForTesting(() => [provider]);
    const first = await loadNewsDataset(query(1));

    resetLiveCorpusForTesting();
    vi.setSystemTime(new Date("2026-08-31T00:00:01Z"));
    const restarted = await loadNewsDataset({
      ...query(2),
      continuationId: first.continuationId,
    });

    expect(restarted.continuationReset).toBe(true);
    expect(restarted.continuationId).not.toBe(first.continuationId);
  });
});
