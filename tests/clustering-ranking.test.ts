import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clusterArticles,
  clusterArticlesHybrid,
  clusterArticlesHybridIncremental,
  resetEmbeddingCacheForTesting,
  semanticContentHash,
} from "@/lib/news/cluster";
import { normalizeProviderArticle } from "@/lib/news/normalize";
import { scoreTwoCountryRelevance } from "@/lib/news/ranking";
import type { TextEmbeddingProvider } from "@/lib/news/embeddings";
import type { StoryView } from "@/lib/news/types";

function normalized(id: string, title: string) {
  return normalizeProviderArticle({
    provider: "RSS",
    providerArticleId: id,
    title,
    description: "Japan and Singapore agencies described a digital shipping project.",
    url: `https://example.com/${id}`,
    publishedAt: new Date().toISOString(),
    language: "en",
    sourceName: id,
    sourceCountry: id === "one" ? "JP" : "SG",
  });
}

describe("story clustering", () => {
  beforeEach(() => resetEmbeddingCacheForTesting());

  it("groups similar coverage but leaves a different event separate", () => {
    const clusters = clusterArticles([
      normalized("one", "Japan and Singapore launch digital shipping corridor"),
      normalized("two", "Singapore and Japan launch digital corridor for shipping"),
      normalized("three", "Japan opens new mountain rail museum"),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.articles.length).sort()).toEqual([1, 2]);
  });

  it("clusters semantic headline variants without merging a different event", async () => {
    const articles = [
      normalized("lunar", "Japan launches new lunar spacecraft"),
      normalized("moon", "Tokyo sends its latest probe toward the Moon"),
      normalized("chips", "Japan announces new semiconductor subsidies"),
    ];
    const embed = vi.fn(async (texts: string[]) => texts.map((text) => {
      if (text.includes("lunar")) return [1, 0, 0];
      if (text.includes("probe")) return [0.995, 0.1, 0];
      return [0, 1, 0];
    }));
    const provider: TextEmbeddingProvider = { id: "test:semantic", embed };

    const clusters = await clusterArticlesHybrid(articles, { embeddingProvider: provider });

    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.articles.length).sort()).toEqual([1, 2]);
    expect(clusters.find((cluster) => cluster.articles.length === 2)?.articles.map(({ providerArticleId }) => providerArticleId)).toEqual(
      expect.arrayContaining(["lunar", "moon"]),
    );
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0]).toHaveLength(3);
  });

  it("reuses cached embeddings by stable semantic content hash", async () => {
    const articles = [
      normalized("cache-one", "Japan and Singapore launch a lunar project"),
      normalized("cache-two", "Singapore and Japan start a Moon project"),
    ];
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
    const provider: TextEmbeddingProvider = { id: "test:cache", embed };

    await clusterArticlesHybrid(articles, { embeddingProvider: provider });
    await clusterArticlesHybrid(articles, { embeddingProvider: provider });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(semanticContentHash(articles[0])).toBe(semanticContentHash({ ...articles[0] }));
    expect(semanticContentHash(articles[0])).not.toBe(semanticContentHash({ ...articles[0], title: `${articles[0].title} updated` }));
  });

  it("degrades to deterministic lexical clustering when embeddings fail", async () => {
    const articles = [
      normalized("fallback-one", "Japan and Singapore launch digital shipping corridor"),
      normalized("fallback-two", "Singapore and Japan launch digital corridor for shipping"),
    ];
    const provider: TextEmbeddingProvider = {
      id: "test:failing",
      embed: vi.fn(async () => { throw new Error("simulated outage"); }),
    };

    const clusters = await clusterArticlesHybrid(articles, { embeddingProvider: provider });

    expect(clusters).toHaveLength(1);
    expect(clusters[0].articles).toHaveLength(2);
  });

  it("uses lexical-only clustering when no embedding provider is configured", async () => {
    const articles = [
      normalized("no-key-one", "Japan and Singapore launch digital shipping corridor"),
      normalized("no-key-two", "Singapore and Japan launch digital corridor for shipping"),
    ];
    await expect(clusterArticlesHybrid(articles, { embeddingProvider: null })).resolves.toHaveLength(1);
  });

  it("embeds only articles that survive cheap candidate generation", async () => {
    const related = [
      normalized("candidate-one", "Japan and Singapore launch digital shipping corridor"),
      normalized("candidate-two", "Singapore and Japan start a digital shipping corridor"),
    ];
    const unrelated = normalizeProviderArticle({
      provider: "RSS",
      providerArticleId: "unrelated-weather",
      title: "Municipal weather office records overnight rainfall",
      description: null,
      url: "https://weather.example/unrelated",
      publishedAt: new Date().toISOString(),
      sourceName: "Weather Desk",
    });
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));

    await clusterArticlesHybrid([...related, unrelated], {
      embeddingProvider: { id: "test:candidates", embed },
    });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0]).toHaveLength(2);
  });

  it("compares incoming articles without revisiting existing cluster pairs", async () => {
    const existingArticles = Array.from({ length: 20 }, (_, index) =>
      normalizeProviderArticle({
        provider: "RSS",
        providerArticleId: `existing-${index}`,
        title: `Isolated report ${index}`,
        description: null,
        url: `https://isolated.example/${index}`,
        publishedAt: new Date().toISOString(),
        sourceName: `Desk ${index}`,
      })
    );
    const existingClusters = clusterArticles(existingArticles);
    const incoming = normalizeProviderArticle({
      provider: "RSS",
      providerArticleId: "incoming",
      title: "A completely separate incoming bulletin",
      description: null,
      url: "https://isolated.example/incoming",
      publishedAt: new Date().toISOString(),
      sourceName: "Incoming Desk",
    });

    const result = await clusterArticlesHybridIncremental(existingClusters, [incoming], {
      embeddingProvider: null,
    });

    expect(existingClusters).toHaveLength(20);
    expect(result.comparedPairCount).toBe(20);
    expect(result.clusters).toHaveLength(21);
    expect(result.clusters.slice(0, 20).every((cluster, index) => cluster === existingClusters[index])).toBe(true);
  });
});

describe("two-country relevance", () => {
  it("ranks a focused bilateral story above an incidental global list", () => {
    const articles = [normalized("one", "Japan and Singapore launch digital shipping corridor")];
    const focused: StoryView = {
      id: "focused",
      title: "Japan and Singapore launch digital shipping corridor",
      summary: null,
      firstPublishedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      countries: [{ code: "JP", name: "Japan", relevanceScore: 1 }, { code: "SG", name: "Singapore", relevanceScore: 1 }],
      topics: ["technology"],
      importanceScore: 0.8,
      articles,
    };
    const incidental: StoryView = {
      ...focused,
      id: "incidental",
      title: "Global index surveys dozens of economies",
      countries: [
        ...focused.countries,
        ...["US", "CN", "GB", "FR", "DE", "IN", "AU", "BR"].map((code) => ({ code, name: code, relevanceScore: 0.55 })),
      ],
    };
    expect(scoreTwoCountryRelevance(focused, "JP", "SG")).toBeGreaterThan(
      scoreTwoCountryRelevance(incidental, "JP", "SG"),
    );
  });
});
