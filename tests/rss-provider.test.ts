import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RSS_FEEDS } from "@/config/news-sources";
import { RssProvider } from "@/lib/news/providers/rss";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RSS provider", () => {
  it("loads a reviewed publisher feed without requiring credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>World</title><item><title>Live world update</title><link>https://www.bbc.com/news/articles/example</link><guid>example</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate><description>Current international coverage.</description><media:thumbnail width="640" height="360" url="https://ichef.bbci.co.uk/news/example.jpg" /></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const provider = new RssProvider([DEFAULT_RSS_FEEDS[0]]);
    const result = await provider.fetchLatest();

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({
      provider: "RSS",
      sourceName: "BBC News",
      title: "Live world update",
      imageUrl: "https://ichef.bbci.co.uk/news/example.jpg",
    });
  });

  it("selects the largest publisher-supplied media image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>World</title><item><title>Guardian world update</title><link>https://www.theguardian.com/world/example</link><guid>guardian-example</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate><description>Current international coverage.</description><media:content width="140" url="https://i.guim.co.uk/example-140.jpg" /><media:content width="700" url="https://i.guim.co.uk/example-700.jpg" /></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const provider = new RssProvider([DEFAULT_RSS_FEEDS[1]]);
    const result = await provider.fetchLatest();

    expect(result.articles[0].imageUrl).toBe("https://i.guim.co.uk/example-700.jpg");
  });

  it("matches every quoted country term for bilateral searches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>World</title><item><title>Japan and Singapore launch a new corridor</title><link>https://www.bbc.com/news/articles/bilateral</link><guid>bilateral</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate><description>Ministers from both countries announced the plan.</description></item><item><title>Japan announces a domestic policy</title><link>https://www.bbc.com/news/articles/domestic</link><guid>domestic</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const provider = new RssProvider([DEFAULT_RSS_FEEDS[0]]);
    const result = await provider.search('"Japan" AND "Singapore"');

    expect(result.articles.map((article) => article.providerArticleId)).toEqual(["bilateral"]);
  });

  it("matches either quoted term when gathering broad bilateral candidates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>World</title><item><title>Japan announces a domestic policy</title><link>https://www.bbc.com/news/articles/japan</link><guid>japan</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate></item><item><title>Singapore opens a new trade corridor</title><link>https://www.bbc.com/news/articles/singapore</link><guid>singapore</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate></item><item><title>Unrelated world update</title><link>https://www.bbc.com/news/articles/other</link><guid>other</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const provider = new RssProvider([DEFAULT_RSS_FEEDS[0]]);
    const result = await provider.search('"Japan" OR "Singapore"');

    expect(result.articles.map((article) => article.providerArticleId)).toEqual([
      "japan",
      "singapore",
    ]);
  });

  it("rejects items without a trustworthy publication time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>World</title><item><title>Missing date</title><link>https://www.bbc.com/news/articles/missing</link><guid>missing</guid></item><item><title>Invalid date</title><link>https://www.bbc.com/news/articles/invalid</link><guid>invalid</guid><pubDate>not-a-date</pubDate></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const result = await new RssProvider([DEFAULT_RSS_FEEDS[0]]).fetchLatest();
    expect(result.articles).toEqual([]);
  });

  it("rejects implausibly future-dated items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>World</title><item><title>Future item</title><link>https://www.bbc.com/news/articles/future</link><guid>future</guid><pubDate>Tue, 25 Aug 2099 12:00:00 GMT</pubDate></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const result = await new RssProvider([DEFAULT_RSS_FEEDS[0]]).fetchLatest();
    expect(result.articles).toEqual([]);
  });

  it("enforces the requested lower publication bound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>World</title><item><title>Too old</title><link>https://www.bbc.com/news/articles/old</link><guid>old</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate></item><item><title>In range</title><link>https://www.bbc.com/news/articles/current</link><guid>current</guid><pubDate>Wed, 26 Aug 2026 18:00:00 GMT</pubDate></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const result = await new RssProvider([DEFAULT_RSS_FEEDS[0]]).fetchLatest({
      from: new Date("2026-08-26T00:00:00Z"),
    });
    expect(result.articles.map((article) => article.providerArticleId)).toEqual(["current"]);
    expect(result.articles[0].publishedAt).toBe("2026-08-26T18:00:00.000Z");
  });
});
