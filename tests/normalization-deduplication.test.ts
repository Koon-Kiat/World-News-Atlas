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

  it("matches topic terms as words instead of fragments inside unrelated words", () => {
    const result = normalizeProviderArticle({
      provider: "RSS",
      providerArticleId: "word-boundaries",
      title: "Officials said the report is ready",
      description: "The latest update contains no specialist subject matter.",
      url: "https://example.com/word-boundaries",
      publishedAt: new Date().toISOString(),
      sourceName: "Example News",
    });

    expect(result.topics).toEqual(["world"]);
    expect(result.topics).not.toEqual(expect.arrayContaining(["technology", "transport", "sports"]));
  });

  it("removes feed markup from provider text", () => {
    const result = normalizeProviderArticle({
      provider: "NEWSAPI",
      providerArticleId: "clean-text",
      title: "<![CDATA[World &amp; regional update]]>",
      description: "<![CDATA[The <strong>latest</strong> report.]]>",
      url: "https://example.com/clean-text",
      publishedAt: new Date().toISOString(),
      sourceName: "Example News",
    });
    expect(result.title).toBe("World & regional update");
    expect(result.description).toBe("The latest report.");
  });

  it("keeps publisher origin separate from article country signals", () => {
    const result = normalizeProviderArticle({
      provider: "RSS",
      providerArticleId: "national-source",
      title: "Government announces a new transport programme",
      description: "The policy begins next month.",
      url: "https://www.japantimes.co.jp/news/example",
      publishedAt: new Date().toISOString(),
      sourceName: "The Japan Times",
      sourceCountry: "JP",
      sourceScope: "NATIONAL",
    });

    expect(result.source.countryCode).toBe("JP");
    expect(result.countries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "JP" })]),
    );
  });

  it("uses an explicit country-category feed as an article country signal", () => {
    const result = normalizeProviderArticle({
      provider: "RSS",
      providerArticleId: "country-category",
      title: "Government announces a new transport programme",
      description: "The policy begins next month.",
      url: "https://www.channelnewsasia.com/singapore/example",
      publishedAt: new Date().toISOString(),
      sourceName: "CNA",
      sourceCountry: "SG",
      coverageCountries: ["SG"],
    });

    expect(result.countries).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SG", relevanceScore: 1 })]),
    );
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
