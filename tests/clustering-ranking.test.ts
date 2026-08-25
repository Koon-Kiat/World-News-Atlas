import { describe, expect, it } from "vitest";
import { clusterArticles } from "@/lib/news/cluster";
import { normalizeProviderArticle } from "@/lib/news/normalize";
import { scoreTwoCountryRelevance } from "@/lib/news/ranking";
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
  it("groups similar coverage but leaves a different event separate", () => {
    const clusters = clusterArticles([
      normalized("one", "Japan and Singapore launch digital shipping corridor"),
      normalized("two", "Singapore and Japan launch digital corridor for shipping"),
      normalized("three", "Japan opens new mountain rail museum"),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.articles.length).sort()).toEqual([1, 2]);
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
