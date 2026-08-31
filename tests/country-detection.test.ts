import { describe, expect, it } from "vitest";
import { detectCountries, detectCountrySignals } from "@/lib/news/countries/detectCountries";
import { countryNameToCode, getCountryFlag, listCountries } from "@/lib/news/countries/metadata";
import { COUNTRY_SIGNALS } from "@/lib/news/countries/aliases";
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

  it("recognizes uppercase US without treating the lowercase pronoun as a country", () => {
    expect(detectCountries("Singapore expands US technology partnership").map(({ code }) => code)).toEqual(
      expect.arrayContaining(["SG", "US"]),
    );
    expect(detectCountries("Officials tell us the talks will continue").map(({ code }) => code)).not.toContain("US");
  });

  it("normalizes provider source-country names and codes", () => {
    expect(countryNameToCode("United States of America")).toBe("US");
    expect(countryNameToCode("sg")).toBe("SG");
  });

  it("can tag every selectable ISO country by its official name", () => {
    const selectableCodes = listCountries().map(({ code }) => code);
    const taggableCodes = new Set(COUNTRY_SIGNALS.map(({ code }) => code));

    expect(selectableCodes.every((code) => taggableCodes.has(code))).toBe(true);
    expect(detectCountries("Bhutan and Uruguay expand cultural ties").map(({ code }) => code)).toEqual(
      expect.arrayContaining(["BT", "UY"]),
    );
    expect(detectCountries("Namibia hosts Timor-Leste delegation").map(({ code }) => code)).toEqual(
      expect.arrayContaining(["NA", "TL"]),
    );
  });

  it("uses article URL slugs as a supplemental geography signal", () => {
    const article = normalizeProviderArticle({
      provider: "RSS",
      providerArticleId: "url-signal",
      title: "New housing rules take effect next month",
      description: "The measures apply nationwide.",
      url: "https://example.com/asia/singapore/new-housing-rules",
      publishedAt: new Date().toISOString(),
      sourceName: "Example News",
    });

    expect(article.countries.map(({ code }) => code)).toContain("SG");
  });

  it.each([
    ["日本政府が新政策を発表", "JP"],
    ["中国経済の成長率", "CN"],
    ["대한민국 대통령이 회담을 발표", "KR"],
    ["Deutschland kündigt neue Maßnahmen an", "DE"],
    ["La France annonce de nouvelles mesures", "FR"],
  ])("recognizes multilingual country text: %s", (headline, code) => {
    expect(detectCountries(headline).map((country) => country.code)).toContain(code);
  });

  it("recognizes multilingual aliases and mixed-language headlines", () => {
    expect(detectCountries("日本と Estados Unidos firman un acuerdo").map(({ code }) => code)).toEqual(
      expect.arrayContaining(["JP", "US"]),
    );
    expect(detectCountries("Россия and Deutschland reopen talks").map(({ code }) => code)).toEqual(
      expect.arrayContaining(["RU", "DE"]),
    );
  });

  it.each(["北海道", "沖縄", "福岡", "名古屋", "横浜"])(
    "recognizes Japanese geographic signal %s without requiring 日本",
    (place) => {
      expect(detectCountries(`${place}で大雪 交通機関に影響`).map(({ code }) => code)).toContain("JP");
    },
  );

  it("uses capitals and major cities as medium-high confidence signals", () => {
    const countries = detectCountrySignals({ title: "Leaders meet in 서울 before talks move to Berlin" });
    expect(countries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "KR", relevanceScore: expect.any(Number), methods: expect.arrayContaining(["city"]) }),
        expect.objectContaining({ code: "DE", relevanceScore: expect.any(Number), methods: expect.arrayContaining(["city"]) }),
      ]),
    );
    expect(countries.find(({ code }) => code === "KR")!.relevanceScore).toBeGreaterThanOrEqual(0.79);
  });

  it("rejects ambiguous country words and unsafe ISO-code false positives", () => {
    expect(detectCountries("Jordan scores for the Chicago team").map(({ code }) => code)).not.toContain("JO");
    expect(detectCountries("IT teams meet IN the main office").map(({ code }) => code)).not.toEqual(
      expect.arrayContaining(["IT", "IN"]),
    );
  });

  it("prioritizes provider coverage and structured metadata over weaker inference", () => {
    const countries = detectCountrySignals({
      title: "La France annonce une réforme",
      coverageCountries: ["JP"],
      structuredCountryCodes: ["DE"],
      structuredLocations: ["Seoul"],
    });
    expect(countries[0]).toMatchObject({ code: "JP", relevanceScore: 1 });
    expect(countries.find(({ code }) => code === "DE")).toMatchObject({ relevanceScore: 0.98 });
    expect(countries.find(({ code }) => code === "KR")?.methods).toContain("structured_location");
  });

  it("renders ISO country flags and a global fallback", () => {
    expect(getCountryFlag("SG")).toBe("🇸🇬");
    expect(getCountryFlag("invalid")).toBe("🌐");
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

  it("does not add Japan when a Japanese publisher reports only on France", () => {
    const article = normalizeProviderArticle({
      provider: "RSS",
      providerArticleId: "nhk-france",
      title: "フランス政府が新たな経済対策を発表",
      description: "パリで閣僚が会見しました。",
      url: "https://news.web.nhk/newsweb/na/na-k1000000099",
      publishedAt: new Date().toISOString(),
      language: "ja",
      sourceName: "NHK",
      sourceCountry: "JP",
    });
    expect(article.source.countryCode).toBe("JP");
    expect(article.countries.map(({ code }) => code)).toContain("FR");
    expect(article.countries.map(({ code }) => code)).not.toContain("JP");
  });
});

describe("country-code ambiguity", () => {
  it("does not interpret the US dollar prefix as a United States mention", () => {
    const countries = detectCountries(
      "Airline seeks US$1.5 billion from investors",
      "The carrier reported a large annual loss.",
    );

    expect(countries.some((country) => country.code === "US")).toBe(false);
  });
});
