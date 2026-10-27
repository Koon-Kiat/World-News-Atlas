import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RSS_FEEDS } from "@/config/news-sources";
import { RssProvider } from "@/lib/news/providers/rss";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RSS provider", () => {
  it("advances past blocked feeds without counting them as completed", async () => {
    const feeds = DEFAULT_RSS_FEEDS.slice(0, 5);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input) === feeds[0].feedUrl
      ? new Response("Blocked", { status: 403 })
      : new Response('<rss version="2.0"><channel><title>News</title></channel></rss>'));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new RssProvider(feeds);
    const first = await provider.fetchLatest();
    expect(first.failures).toEqual([{ provider: "RSS", code: "PUBLIC_FEED_UNAVAILABLE" }]);
    expect(first.continuation?.completedPlanIds).not.toContain(feeds[0].feedUrl);
    const second = await provider.fetchLatest({ continuation: first.continuation ?? undefined });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(String(fetchMock.mock.calls[4][0])).toBe(feeds[4].feedUrl);
    expect(second.exhausted).toBe(true);
    expect(second.coverage?.timeRangeCovered).toBe(false);
    // A new snapshot retries the publisher; failures are never a permanent skip.
    await provider.fetchLatest();
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("retains continuation even when the first entire feed batch is blocked", async () => {
    const feeds = DEFAULT_RSS_FEEDS.slice(0, 5);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === feeds[4].feedUrl
      ? new Response('<rss version="2.0"><channel><title>News</title></channel></rss>')
      : new Response("Blocked", { status: 403 })));
    const provider = new RssProvider(feeds);
    const first = await provider.fetchLatest();
    expect(first.failures).toHaveLength(4);
    expect(first.exhausted).toBe(false);
    const second = await provider.fetchLatest({ continuation: first.continuation ?? undefined });
    expect(second.failures).toEqual([]);
    expect(second.exhausted).toBe(true);
  });

  it("classifies malformed public feed content without hiding configuration errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<html>Upstream challenge</html>')));
    const result = await new RssProvider([DEFAULT_RSS_FEEDS[0]]).fetchLatest();
    expect(result.failures).toEqual([{ provider: "RSS", code: "PUBLIC_FEED_INVALID_RESPONSE" }]);
    const invalid = await new RssProvider([{ ...DEFAULT_RSS_FEEDS[0], feedUrl: "http://localhost/private" }]).fetchLatest();
    expect(invalid.failures).toEqual([{ provider: "RSS", code: "INVALID_CONFIGURATION" }]);
  });
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

  it("samples a bounded result across feeds instead of exhausting the first feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const isGuardian = url.includes("theguardian.com");
        const prefix = isGuardian ? "guardian" : "bbc";
        return new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>World</title><item><title>${prefix} one</title><link>https://example.com/${prefix}-one</link><guid>${prefix}-one</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate></item><item><title>${prefix} two</title><link>https://example.com/${prefix}-two</link><guid>${prefix}-two</guid><pubDate>Tue, 25 Aug 2026 12:01:00 GMT</pubDate></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        );
      }),
    );

    const provider = new RssProvider(DEFAULT_RSS_FEEDS.slice(0, 2));
    const result = await provider.fetchLatest({ limit: 3 });

    expect(result.articles.map((article) => article.providerArticleId)).toEqual([
      "bbc-one",
      "guardian-one",
      "bbc-two",
    ]);
  });

  it("prefers a short publisher summary over content:encoded article text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>World</title><item><title>Full feed report</title><link>https://www.bbc.com/news/articles/full-feed</link><guid>full-feed</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate><description>Short summary.</description><content:encoded><![CDATA[<p>First full paragraph.</p><p>Second full paragraph.</p>]]></content:encoded></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
      ),
    );

    const result = await new RssProvider([DEFAULT_RSS_FEEDS[0]]).fetchLatest();
    expect(result.articles[0].description).toBe("Short summary.");
    expect(result.articles[0].description).not.toContain("First full paragraph");
  });

  it("sanitizes and truncates content:encoded when no summary exists", async () => {
    const longBody = `<script>ignore()</script><p>${"日本語のニュース本文です。".repeat(100)}</p>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>World</title><item><title>Metadata fallback</title><link>https://www.bbc.com/news/articles/fallback</link><guid>fallback</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate><content:encoded><![CDATA[${longBody}]]></content:encoded></item></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } },
      )),
    );

    const result = await new RssProvider([DEFAULT_RSS_FEEDS[0]]).fetchLatest();
    expect(result.articles[0].description?.length).toBeLessThanOrEqual(801);
    expect(result.articles[0].description).not.toContain("<script>");
    expect(result.articles[0].description).toMatch(/…$/);
  });

  it("fetches only matching configured feeds for a selected publisher", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(
        `<?xml version="1.0"?><rss version="2.0"><channel><title>World</title></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await new RssProvider(DEFAULT_RSS_FEEDS.slice(0, 2)).fetchLatest({
      sourceTargets: [{
        id: "guardian",
        name: "The Guardian",
        domains: ["theguardian.com"],
        providerIdentifiers: {},
      }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("theguardian.com");
  });

  it("fetches each finite feed snapshot once across bounded continuation stages", async () => {
    const fetchMock = vi.fn(async () => new Response(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>World</title></channel></rss>`,
      { status: 200, headers: { "Content-Type": "application/rss+xml" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new RssProvider(DEFAULT_RSS_FEEDS.slice(0, 5));

    const first = await provider.fetchLatest();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(first).toMatchObject({ continuation: { offset: 4 }, exhausted: false });

    const second = await provider.fetchLatest({ continuation: first.continuation ?? undefined });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(second).toMatchObject({ continuation: null, exhausted: true });
  });

  it("includes the reviewed Japanese NHK metadata feed", () => {
    expect(DEFAULT_RSS_FEEDS).toContainEqual(expect.objectContaining({
      sourceId: "nhk",
      countryCode: "JP",
      language: "ja",
      feedUrl: "https://news.web.nhk/n-data/conf/na/rss/cat0.xml",
    }));
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
