import { describe, expect, it } from "vitest";
import { KNOWN_SOURCE_SEEDS } from "@/config/news-sources";
import { normalizeProviderArticle } from "@/lib/news/normalize";
import {
  domainFromUrl,
  resolveSourceDetailed,
  sourceTargetsFromSelections,
} from "@/lib/news/sources/registry";

const source = (overrides: Partial<Parameters<typeof resolveSourceDetailed>[0]> = {}) =>
  resolveSourceDetailed({
    provider: "GDELT",
    sourceName: "Unknown publisher",
    articleUrl: "https://publisher.example/story",
    ...overrides,
  });

describe("publisher identity and country resolution", () => {
  it("keeps maintained publisher IDs unique and resolves API selections to provider targets", () => {
    expect(new Set(KNOWN_SOURCE_SEEDS.map(({ id }) => id)).size).toBe(KNOWN_SOURCE_SEEDS.length);
    expect(sourceTargetsFromSelections(["nhk", "The Japan Times"])).toEqual([
      expect.objectContaining({ id: "nhk", domains: expect.arrayContaining(["nhk.or.jp", "news.web.nhk"]) }),
      expect.objectContaining({ id: "japan-times", domains: ["japantimes.co.jp"] }),
    ]);
  });

  it("resolves maintained publishers before conflicting metadata", () => {
    const result = source({
      sourceName: "BBC",
      articleUrl: "https://bbc.com/world/story",
      sourceCountry: "AU",
    });
    expect(result.source).toMatchObject({ name: "BBC", countryCode: "GB", domain: "bbc.com" });
    expect(result.source.id).toBe("bbc");
    expect(result.resolution).toEqual({ method: "registry", confidence: 1 });
  });

  it("resolves provider-specific publisher identifiers", () => {
    const result = source({
      provider: "NEWSAPI",
      sourceIdentifier: "bbc-news",
      articleUrl: "https://syndication.example/story",
    });
    expect(result.source).toMatchObject({ name: "BBC", countryCode: "GB" });
    expect(result.resolution.method).toBe("provider");
  });

  it("normalizes subdomains through registrable-domain matching", () => {
    expect(domainFromUrl("https://edition.example.com/story")).toBe("example.com");
    const result = source({ articleUrl: "https://news.bbc.co.uk/world/story" });
    expect(result.source).toMatchObject({ name: "BBC", domain: "bbc.com", countryCode: "GB" });
    expect(result.resolution.method).toBe("domain");
  });

  it.each([
    ["https://news.example.co.jp/story", "JP"],
    ["https://news.example.com.sg/story", "SG"],
    ["https://news.example.com.my/story", "MY"],
    ["https://news.example.co.uk/story", "GB"],
    ["https://news.example.com.au/story", "AU"],
    ["https://example.sg/story", "SG"],
    ["https://example.de/story", "DE"],
    ["https://example.fr/story", "FR"],
  ])("uses reliable ccTLD evidence for %s", (url, code) => {
    const result = source({ articleUrl: url });
    expect(result.source.countryCode).toBe(code);
    expect(result.resolution.method).toBe("cctld");
  });

  it.each([
    ["news.publisher.co.jp", "publisher.co.jp"],
    ["news.publisher.com.sg", "publisher.com.sg"],
    ["news.publisher.com.my", "publisher.com.my"],
    ["news.publisher.co.uk", "publisher.co.uk"],
    ["news.publisher.com.au", "publisher.com.au"],
  ])("uses the public suffix list for %s", (hostname, expected) => {
    expect(domainFromUrl(`https://${hostname}/story`)).toBe(expected);
  });

  it("does not infer a country from a generic domain", () => {
    const result = source({ articleUrl: "https://edition.unknown-publisher.com/story" });
    expect(result.source).toMatchObject({ domain: "unknown-publisher.com", countryCode: null });
    expect(result.resolution).toEqual({ method: "unknown", confidence: 0 });
  });

  it("distinguishes provider and RSS configuration provenance", () => {
    expect(source({ sourceCountry: "DE" }).resolution.method).toBe("provider");
    expect(source({ sourceCountry: "DE", metadataOrigin: "rss-config" }).resolution.method).toBe("rss-config");
  });

  it("never derives publisher country from article subject matter", () => {
    const article = normalizeProviderArticle({
      provider: "OTHER",
      providerArticleId: "subject-is-not-source",
      title: "Japan announces a new transport policy",
      description: "Officials in Tokyo described the change.",
      url: "https://unknown-publisher.com/japan/policy",
      publishedAt: new Date().toISOString(),
      sourceName: "Unknown Publisher",
    });
    expect(article.source.countryCode).toBeNull();
    expect(article.countries.map(({ code }) => code)).toContain("JP");
  });
});
