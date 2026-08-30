import { describe, expect, it, vi } from "vitest";
import { deduplicateArticles } from "@/lib/news/deduplicate";
import { normalizeProviderArticle, normalizeProviderArticles } from "@/lib/news/normalize";
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

  it("preserves Japanese Unicode while inferring language and topics", () => {
    const result = normalizeProviderArticle({
      provider: "RSS",
      providerArticleId: "japanese-metadata",
      title: "日本政府が半導体投資を発表",
      description: "東京で新しい技術政策を説明しました。",
      url: "https://news.web.nhk/newsweb/na/na-k1000000000",
      publishedAt: new Date().toISOString(),
      sourceName: "NHK",
      sourceCountry: "JP",
    });

    expect(result.title).toBe("日本政府が半導体投資を発表");
    expect(result.description).toBe("東京で新しい技術政策を説明しました。");
    expect(result.language).toBe("ja");
    expect(result.topics).toEqual(expect.arrayContaining(["politics", "business", "technology"]));
    expect(result.countries).toEqual(expect.arrayContaining([expect.objectContaining({ code: "JP" })]));
  });

  it("infers Hangul conservatively and leaves Han-only text unknown without metadata", () => {
    expect(normalizeProviderArticle({
      provider: "OTHER",
      providerArticleId: "korean",
      title: "한국 정부가 새로운 정책을 발표했습니다",
      url: "https://example.com/korean",
      publishedAt: new Date().toISOString(),
      sourceName: "Example",
    }).language).toBe("ko");
    expect(normalizeProviderArticle({
      provider: "OTHER",
      providerArticleId: "han-only",
      title: "政府宣布新政策",
      url: "https://example.com/han-only",
      publishedAt: new Date().toISOString(),
      sourceName: "Example",
    }).language).toBe("und");
  });

  it("logs aggregate language, publisher-country, local-Japan, and source-resolution metrics", () => {
    const output: string[] = [];
    const consoleSpy = vi.spyOn(console, "info").mockImplementation((message) => output.push(String(message)));
    try {
      normalizeProviderArticles([{
        provider: "RSS",
        providerArticleId: "jp-observability",
        title: "日本政府が新しい政策を発表",
        description: "東京で発表しました。",
        url: "https://news.web.nhk/newsweb/na/na-k1000000001",
        publishedAt: new Date().toISOString(),
        language: "ja",
        sourceName: "NHK",
        sourceCountry: "JP",
      }]);
    } finally {
      consoleSpy.mockRestore();
    }
    const entry = JSON.parse(output.at(-1)!);
    expect(entry).toMatchObject({
      articles_by_language: { ja: 1 },
      articles_by_source_country: { JP: 1 },
      jp_local_article_count: 1,
      source_resolution_method: { registry: 1 },
    });
    expect(JSON.stringify(entry)).not.toContain("東京で発表しました");
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
