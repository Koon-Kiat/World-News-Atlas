import { afterEach, describe, expect, it, vi } from "vitest";
import { BingNewsProvider } from "@/lib/news/providers/bing-news";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Bing News RSS provider", () => {
  it("continues global discovery across bounded query plans", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      void input;
      return new Response(
        `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new BingNewsProvider();
    const first = await provider.fetchLatest({
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-31T00:00:00Z"),
    });
    const second = await provider.fetchLatest({
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-31T00:00:00Z"),
      continuation: first.continuation ?? undefined,
    });

    expect(first).toMatchObject({ continuation: { offset: 2 }, exhausted: false });
    expect(second).toMatchObject({ continuation: { offset: 4 }, exhausted: false });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const requestedQueries = fetchMock.mock.calls.map(([input]) =>
      new URL(String(input)).searchParams.get("q")
    );
    expect(new Set(requestedQueries).size).toBe(4);
    expect(requestedQueries[0]).toContain("world OR international");
  });

  it("returns original publisher URLs, attribution, and secure thumbnails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0" xmlns:News="https://www.bing.com/news"><channel><title>News</title><item><title>Japan and Singapore deepen technology ties</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fwww.japantimes.co.jp%2Fnews%2Fbilateral%3Fref%3Dbing</link><description>Officials announced a joint programme.</description><pubDate>Tue, 25 Aug 2026 08:40:00 GMT</pubDate><News:Source>The Japan Times</News:Source><News:Image>http://www.bing.com/th?id=example&amp;pid=News</News:Image></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const result = await new BingNewsProvider().search('"Japan" AND "Singapore"', {
      from: new Date("2026-08-01T00:00:00Z"),
    });

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({
      provider: "OTHER",
      sourceName: "The Japan Times",
      url: "https://www.japantimes.co.jp/news/bilateral?ref=bing",
      imageUrl: "https://www.bing.com/th?id=example&pid=News",
    });
  });

  it("drops results outside the selected publication window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0" xmlns:News="https://www.bing.com/news"><channel><title>News</title><item><title>Older Japan and Singapore report</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.com%2Folder</link><pubDate>Tue, 01 Jul 2026 08:40:00 GMT</pubDate><News:Source>Example News</News:Source></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const result = await new BingNewsProvider().search('"Japan" AND "Singapore"', {
      from: new Date("2026-08-01T00:00:00Z"),
    });

    expect(result.articles).toHaveLength(0);
  });

  it("uses a bounded discovery fan-out and deduplicates publisher URLs", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      void input;
      return new Response(
        `<?xml version="1.0"?><rss version="2.0" xmlns:News="https://www.bing.com/news"><channel><title>News</title><item><title>Japan expands a current programme</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.com%2Fjapan-story</link><pubDate>Thu, 27 Aug 2026 08:40:00 GMT</pubDate><News:Source>Example News</News:Source></item></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new BingNewsProvider();
    let result = await provider.search('"Japan"', {
      countries: ["JP"],
      from: new Date("2026-08-01T00:00:00Z"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.continuation).toEqual({ offset: 2 });
    while (result.continuation) {
      result = await provider.search('"Japan"', {
        countries: ["JP"],
        from: new Date("2026-08-01T00:00:00Z"),
        continuation: result.continuation,
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(10);
    const requestedQueries = fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("q"));
    expect(requestedQueries).toContain('"Japan" site:reuters.com');
    expect(requestedQueries).toContain('"Japan" site:apnews.com');
    expect(requestedQueries.some((requestedQuery) => requestedQuery?.includes('"日本" OR "日本国"'))).toBe(true);
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("mkt"))).toContain("ja-JP");
    expect(result.articles).toHaveLength(1);
    expect(result.exhausted).toBe(true);
  });

  it("pushes selected publisher domains into every upstream discovery query", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      void input;
      return new Response(
        `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await new BingNewsProvider().search('"Japan"', {
      countries: ["JP"],
      sourceTargets: [{
        id: "japan-times",
        name: "The Japan Times",
        domains: ["japantimes.co.jp"],
        providerIdentifiers: {},
      }, {
        id: "nhk",
        name: "NHK",
        domains: ["nhk.or.jp", "news.web.nhk"],
        providerIdentifiers: {},
      }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [input] of fetchMock.mock.calls) {
      expect(new URL(String(input)).searchParams.get("q")).toContain("site:japantimes.co.jp");
      expect(new URL(String(input)).searchParams.get("q")).toContain("site:news.web.nhk");
    }
  });
});
