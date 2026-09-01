import { describe, expect, it } from "vitest";
import {
  buildCountryDiscoveryProfile,
  buildCountryDiscoveryQuery,
} from "@/lib/news/countries/discovery";
import { buildBingDiscoveryPlans } from "@/lib/news/providers/bing-news";
import { buildGdeltDiscoveryQueries } from "@/lib/news/providers/gdelt";

describe("data-driven country discovery", () => {
  it("uses high-confidence United States names instead of depending on the raw US code", () => {
    const profile = buildCountryDiscoveryProfile("US");
    const query = buildCountryDiscoveryQuery(["US"]);
    expect(profile.primaryNames).toContain("United States of America");
    expect(profile.demonyms).toContain("American");
    expect(query).toContain("United States");
    expect(query).not.toMatch(/^"US"$/);
    expect(profile.highConfidenceInstitutions).toEqual(expect.arrayContaining(["White House", "Federal Reserve"]));
  });

  it.each([
    ["DE", "Deutschland", "de-DE", "german"],
    ["FR", "France", "fr-FR", "french"],
    ["JP", "日本", "ja-JP", "japanese"],
    ["KR", "대한민국", "ko-KR", "korean"],
    ["CN", "中国", "zh-CN", "chinese"],
  ])("creates a bounded local-language lane for %s", (code, localName, market, gdeltLanguage) => {
    const profile = buildCountryDiscoveryProfile(code);
    expect(profile.localNames).toContain(localName);
    expect(profile.discoveryLocales.some((locale) => locale.market === market)).toBe(true);
    expect(profile.gdeltLanguages).toContain(gdeltLanguage);
    expect(profile.discoveryLocales.length).toBeLessThanOrEqual(3);
  });

  it("retains both principal Japanese spellings", () => {
    const query = buildCountryDiscoveryQuery(["JP"]);
    expect(query).toContain('"日本"');
    expect(query).toContain('"日本国"');
  });

  it("uses the reviewed en-US fallback when Bing has no documented Singapore market", () => {
    const profile = buildCountryDiscoveryProfile("SG");
    expect(profile.primaryNames).toContain("Singapore");
    expect(profile.discoveryLocales).toContainEqual(expect.objectContaining({ market: "en-US", fallback: true }));
  });

  it("derives native-name and documented language lanes without a country-specific code branch", () => {
    const profile = buildCountryDiscoveryProfile("GR");
    expect(profile.localNames).toContain("Ελλάδα");
    expect(profile.gdeltLanguages).toContain("greek");
    expect(profile.discoveryLocales).toEqual([
      expect.objectContaining({ market: "en-US", fallback: true }),
    ]);
    expect(buildGdeltDiscoveryQueries(buildCountryDiscoveryQuery(["GR"])!, { countries: ["GR"] }))
      .toContainEqual(expect.stringContaining("sourcelang:greek"));
  });

  it("builds staged, bounded Bing plans and multilingual GDELT branches", () => {
    const plans = buildBingDiscoveryPlans(buildCountryDiscoveryQuery(["DE"])!, { countries: ["DE"] });
    expect(plans.length).toBeLessThanOrEqual(18);
    expect(plans.some(({ market }) => market === "de-DE")).toBe(true);
    expect(plans.some(({ query }) => query.includes("Deutschland"))).toBe(true);
    const gdelt = buildGdeltDiscoveryQueries(buildCountryDiscoveryQuery(["DE"])!, { countries: ["DE"] });
    expect(gdelt).toEqual(expect.arrayContaining([
      expect.stringContaining("sourcelang:english"),
      expect.stringContaining("sourcelang:german"),
    ]));
  });
});
