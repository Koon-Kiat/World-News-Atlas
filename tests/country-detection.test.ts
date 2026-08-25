import { describe, expect, it } from "vitest";
import { detectCountries } from "@/lib/news/countries/detectCountries";
import { countryNameToCode } from "@/lib/news/countries/metadata";
import { normalizeProviderArticle } from "@/lib/news/normalize";

describe("country detection", () => {
  it("finds countries from names, demonyms and reliable cities", () => {
    const result = detectCountries(
      "Japan and Singapore agencies meet in Tokyo",
      "Singaporean officials discussed a digital project.",
    );
    expect(result.map(({ code }) => code)).toEqual(expect.arrayContaining(["JP", "SG"]));
  });

  it("conservatively avoids ambiguous food and US-state mentions", () => {
    expect(detectCountries("Turkey prices rise before the holiday")).toEqual([]);
    expect(detectCountries("Georgia college team wins in Atlanta")).toEqual([]);
  });

  it("detects ambiguous countries when unambiguous context is present", () => {
    expect(detectCountries("Talks resume in Tbilisi, Republic of Georgia").map(({ code }) => code)).toContain("GE");
    expect(detectCountries("Turkish officials meet in Ankara").map(({ code }) => code)).toContain("TR");
  });

  it("normalizes provider source-country names and codes", () => {
    expect(countryNameToCode("United States of America")).toBe("US");
    expect(countryNameToCode("sg")).toBe("SG");
  });
});

describe("publisher country versus mentioned countries", () => {
  it("keeps a British publisher separate from an article about Japan", () => {
    const article = normalizeProviderArticle({
      provider: "GDELT",
      providerArticleId: "bbc-japan",
      title: "Japan expands technology research programme",
      description: "New laboratories will open in Tokyo.",
      url: "https://bbc.com/example/japan-research",
      publishedAt: new Date().toISOString(),
      language: "en",
      sourceName: "BBC",
      sourceIdentifier: "bbc.com",
    });
    expect(article.source.countryCode).toBe("GB");
    expect(article.countries.map(({ code }) => code)).toContain("JP");
    expect(article.countries.map(({ code }) => code)).not.toContain("GB");
  });
});
