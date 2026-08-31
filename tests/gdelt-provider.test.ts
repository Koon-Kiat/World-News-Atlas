import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGdeltDiscoveryQueries, GdeltProvider } from "@/lib/news/providers/gdelt";

afterEach(() => vi.unstubAllGlobals());

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

  it("continues through supported bounded date windows instead of repeating the first window", async () => {
    const requestedUrls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      const firstWindow = requestedUrls.length === 1;
      return new Response(JSON.stringify({ articles: [{
        url: `https://example.com/${requestedUrls.length}`,
        title: `Japan report ${requestedUrls.length}`,
        seendate: firstWindow ? "20260830T120000Z" : "20260829T120000Z",
        domain: "example.com",
        language: "English",
      }] }), { status: 200 });
    }));

    const provider = new GdeltProvider();
    const first = await provider.search("Japan", {
      language: "en",
      from: new Date("2026-08-28T00:00:00Z"),
      to: new Date("2026-08-31T00:00:00Z"),
      limit: 1,
    });
    await provider.search("Japan", {
      language: "en",
      from: new Date("2026-08-28T00:00:00Z"),
      to: new Date("2026-08-31T00:00:00Z"),
      limit: 1,
      continuation: first.continuation ?? undefined,
    });

    expect(requestedUrls[0].searchParams.has("timespan")).toBe(false);
    expect(requestedUrls[0].searchParams.get("startdatetime")).toBe("20260828000000");
    expect(requestedUrls[0].searchParams.get("enddatetime")).toBe("20260831000000");
    expect(requestedUrls[1].searchParams.get("enddatetime")).toBe("20260830115959");
  });
});
