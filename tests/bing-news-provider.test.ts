import { afterEach, describe, expect, it, vi } from "vitest";
import { BingNewsProvider } from "@/lib/news/providers/bing-news";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Bing News RSS provider", () => {
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

  it("fans out country discovery topics and deduplicates publisher URLs", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        `<?xml version="1.0"?><rss version="2.0" xmlns:News="https://www.bing.com/news"><channel><title>News</title><item><title>Japan expands a current programme</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.com%2Fjapan-story</link><pubDate>Thu, 27 Aug 2026 08:40:00 GMT</pubDate><News:Source>Example News</News:Source></item></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new BingNewsProvider().search('"Japan"', {
      countries: ["JP"],
      from: new Date("2026-08-01T00:00:00Z"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(result.articles).toHaveLength(1);
  });
});
