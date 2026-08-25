import { describe, expect, it } from "vitest";
import { deduplicateArticles } from "@/lib/news/deduplicate";
import { normalizeProviderArticle } from "@/lib/news/normalize";
import { canonicalizeArticleUrl } from "@/lib/news/url";

const providerArticle = (url: string, title = "Japan and Singapore launch digital trade corridor") =>
  normalizeProviderArticle({
    provider: "GDELT",
    providerArticleId: url,
    title,
    description: "The Japanese and Singaporean agencies announced the project in Tokyo.",
    url,
    publishedAt: new Date().toISOString(),
    language: "en",
    sourceName: "Example News",
    sourceCountry: "GB",
  });

describe("provider normalization", () => {
  it("removes common tracking parameters and normalizes the host", () => {
    expect(
      canonicalizeArticleUrl(
        "https://WWW.Example.com/story/?utm_source=newsletter&b=2&a=1#section",
      ),
    ).toBe("https://example.com/story?a=1&b=2");
  });

  it("normalizes provider data into the internal article model", () => {
    const result = providerArticle("https://publisher.example/story");
    expect(result).toMatchObject({
      provider: "GDELT",
      language: "en",
      canonicalUrl: "https://publisher.example/story",
    });
    expect(result.topics).toEqual(expect.arrayContaining(["technology", "business"]));
  });
});

describe("article deduplication", () => {
  it("collapses the same canonical URL returned with different tracking parameters", () => {
    const first = providerArticle("https://example.com/story?utm_source=gdelt");
    const second = providerArticle("https://www.example.com/story?utm_medium=rss");
    const result = deduplicateArticles([first, second]);
    expect(result.articles).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
  });
});
