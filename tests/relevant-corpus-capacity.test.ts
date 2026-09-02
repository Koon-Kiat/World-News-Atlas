import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNewsDataset,
  resetLiveCorpusForTesting,
  setLiveProviderFactoryForTesting,
} from "@/lib/news/data-store";
import { resetProviderRequestCacheForTesting } from "@/lib/news/providers";
import type { NewsProvider } from "@/lib/news/providers/provider";
import { DEFAULT_NEWS_QUERY } from "@/lib/news/query";
import type {
  ProviderArticle,
  ProviderFetchRequest,
  ProviderFetchResult,
  ProviderName,
} from "@/lib/news/types";

class IrrelevantFirstProvider implements NewsProvider {
  readonly name = "OTHER" as const;
  readonly capabilities = { latest: true, search: true, languages: true, sourceMetadata: true, requiresCredentials: false } as const;
  constructor(
    private readonly countryName: string,
    private readonly irrelevantCount = 400,
    private readonly relevantCount = 300,
  ) {}
  private result(request: ProviderFetchRequest): ProviderFetchResult {
    const offset = request.continuation?.offset ?? 0;
    const total = this.irrelevantCount + this.relevantCount;
    const count = Math.min(request.limit ?? 96, total - offset);
    const articles: ProviderArticle[] = Array.from({ length: count }, (_, index) => {
      const position = offset + index;
      const relevant = position >= this.irrelevantCount;
      return {
        provider: this.name,
        providerArticleId: `item-${position}`,
        title: `Eventword${position.toString(36)} development${(position * 17).toString(36)}`,
        description: relevant ? `${this.countryName} authorities released details.` : "A remote ocean observatory released details.",
        url: `https://capacity.example/item-${position}`,
        publishedAt: new Date(Date.UTC(2026, 7, 31, 0, 0) - position * 1_000).toISOString(),
        language: "en",
        sourceName: "Capacity Wire",
      };
    });
    const next = offset + count;
    return {
      provider: this.name,
      articles,
      receivedAt: new Date().toISOString(),
      continuation: next < total ? { offset: next } : null,
      exhausted: next >= total,
    };
  }
  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> { return Promise.resolve(this.result(request)); }
  search(_query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> { return Promise.resolve(this.result(request)); }
}

class SingleBatchProvider implements NewsProvider {
  readonly capabilities = { latest: true, search: true, languages: true, sourceMetadata: true, requiresCredentials: false } as const;

  constructor(
    readonly name: ProviderName,
    private readonly countryName: string | null,
  ) {}

  private result(request: ProviderFetchRequest): ProviderFetchResult {
    const count = request.limit ?? 96;
    const articles: ProviderArticle[] = Array.from({ length: count }, (_, index) => ({
      provider: this.name,
      providerArticleId: `${this.name}-${index}`,
      title: `${this.name} eventword${index.toString(36)} development${(index * 19).toString(36)}`,
      description: this.countryName
        ? `${this.countryName} authorities released details.`
        : "A remote ocean observatory released details.",
      url: `https://${this.name.toLowerCase()}-capacity.example/item-${index}`,
      publishedAt: new Date(Date.UTC(2026, 7, 30, 20, 0) - index * 1_000).toISOString(),
      language: "en",
      sourceName: `${this.name} Capacity Wire`,
    }));
    return {
      provider: this.name,
      articles,
      receivedAt: new Date().toISOString(),
      continuation: null,
      exhausted: true,
    };
  }

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return Promise.resolve(this.result(request));
  }

  search(_query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return Promise.resolve(this.result(request));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-31T00:00:00Z"));
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("NEWS_FIXTURES_ENABLED", "false");
  vi.stubEnv("NEWS_LIVE_BATCH_SIZE", "96");
  vi.stubEnv("NEWS_LIVE_CORPUS_LIMIT", "1000");
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

describe("query-relevant corpus capacity", () => {
  it("applies the shared stage cap after relevance filtering across providers", async () => {
    setLiveProviderFactoryForTesting(() => [
      new SingleBatchProvider("RSS", null),
      new SingleBatchProvider("NEWSAPI", "United States"),
    ]);

    const result = await loadNewsDataset({
      ...DEFAULT_NEWS_QUERY,
      countries: ["US"],
      period: "30d",
    });

    expect(result.articleCount).toBe(96);
    expect(result.stories).toHaveLength(96);
    expect(result.stories.every(({ articles }) => articles[0].provider === "NEWSAPI")).toBe(true);
    expect(result.diagnostics).toMatchObject({ rawArticleCount: 192, relevantArticleCount: 96 });
  });

  it.each([
    ["US", "United States"],
    ["JP", "Japan"],
    ["SG", "Singapore"],
  ])("does not let 400 irrelevant articles consume the %s corpus", async (country, countryName) => {
    setLiveProviderFactoryForTesting(() => [new IrrelevantFirstProvider(countryName)]);
    let result = await loadNewsDataset({ ...DEFAULT_NEWS_QUERY, countries: [country], period: "30d" });
    for (let attempt = 0; attempt < 12 && !result.corpusComplete; attempt += 1) {
      result = await loadNewsDataset({
        ...DEFAULT_NEWS_QUERY,
        countries: [country],
        period: "30d",
        page: Math.min(100, Math.max(1, Math.ceil(result.stories.length / 12))),
      });
    }
    expect(result.articleCount).toBe(300);
    expect(result.stories).toHaveLength(300);
    expect(result.diagnostics).toMatchObject({ rawArticleCount: 700, relevantArticleCount: 300 });
    expect(result.diagnostics?.providerContributions[0]).toMatchObject({ countryIrrelevant: 400, accepted: 300 });
  });

  it("accumulates at least 500 unique stories per high-volume country through bounded stages", async () => {
    for (const [country, countryName] of [["US", "United States"], ["JP", "Japan"], ["SG", "Singapore"]] as const) {
      resetProviderRequestCacheForTesting();
      resetLiveCorpusForTesting();
      setLiveProviderFactoryForTesting(() => [new IrrelevantFirstProvider(countryName, 0, 500)]);
      let result = await loadNewsDataset({ ...DEFAULT_NEWS_QUERY, countries: [country], period: "30d" });
      for (let attempt = 0; attempt < 8 && !result.corpusComplete; attempt += 1) {
        result = await loadNewsDataset({
          ...DEFAULT_NEWS_QUERY,
          countries: [country],
          period: "30d",
          page: Math.min(100, Math.max(1, Math.ceil(result.stories.length / 12))),
        });
      }
      expect(result.articleCount).toBe(500);
      expect(result.stories).toHaveLength(500);
      expect(result.diagnostics?.rawArticleCount).toBe(500);
    }
  });
});
