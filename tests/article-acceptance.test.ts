import { describe, expect, it } from "vitest";
import { articleRejectionReason } from "@/lib/news/acceptance";
import { DEFAULT_NEWS_QUERY } from "@/lib/news/query";
import type { NormalizedArticle } from "@/lib/news/types";

function article(countryCodes: string[]): NormalizedArticle {
  return {
    id: "article",
    provider: "OTHER",
    providerArticleId: "article",
    title: "A shared regional development",
    description: null,
    url: "https://example.com/article",
    canonicalUrl: "https://example.com/article",
    imageUrl: null,
    publishedAt: "2026-08-20T00:00:00Z",
    language: "en",
    source: {
      id: "example",
      name: "Example",
      domain: "example.com",
      countryCode: null,
      region: null,
      language: "en",
      scope: "INTERNATIONAL",
      qualityScore: 0.8,
    },
    countries: countryCodes.map((code) => ({ code, name: code, relevanceScore: 0.9 })),
    topics: ["world"],
    importanceScore: 0.5,
    relevanceScore: 0.8,
  };
}

describe("live query acceptance", () => {
  const from = new Date("2026-08-01T00:00:00Z");
  const to = new Date("2026-09-01T00:00:00Z");

  it("does not spend bilateral corpus capacity on an article about only one selected country", () => {
    const reason = articleRejectionReason(article(["JP"]), {
      ...DEFAULT_NEWS_QUERY,
      countries: ["JP", "SG"],
      period: "30d",
    }, from, to);

    expect(reason).toBe("country_irrelevant");
  });

  it("accepts an article with strong signals for both selected countries", () => {
    const reason = articleRejectionReason(article(["JP", "SG"]), {
      ...DEFAULT_NEWS_QUERY,
      countries: ["JP", "SG"],
      period: "30d",
    }, from, to);

    expect(reason).toBeNull();
  });
});
