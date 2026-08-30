import { describe, expect, it } from "vitest";
import { buildGdeltDiscoveryQueries } from "@/lib/news/providers/gdelt";

describe("GDELT discovery planning", () => {
  it("issues separate English and Japanese discovery queries for Japan", () => {
    const queries = buildGdeltDiscoveryQueries('("Japan" OR "日本" OR "日本国")', {
      countries: ["JP"],
    });
    expect(queries).toHaveLength(2);
    expect(queries).toEqual(expect.arrayContaining([
      expect.stringContaining("sourcelang:english"),
      expect.stringContaining("sourcelang:japanese"),
    ]));
  });

  it("adds exact publisher-domain filters before the final server filter", () => {
    const queries = buildGdeltDiscoveryQueries("Japan", {
      countries: ["JP"],
      sourceTargets: [{
        id: "nhk",
        name: "NHK",
        domains: ["nhk.or.jp", "news.web.nhk"],
        providerIdentifiers: { GDELT: ["nhk.or.jp"] },
      }],
    });
    expect(queries.every((query) => query.includes("domainis:nhk.or.jp"))).toBe(true);
    expect(queries.every((query) => query.includes("domainis:news.web.nhk"))).toBe(true);
  });
});
