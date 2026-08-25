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
          `<?xml version="1.0"?><rss version="2.0"><channel><title>World</title><item><title>Live world update</title><link>https://www.bbc.com/news/articles/example</link><guid>example</guid><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate><description>Current international coverage.</description></item></channel></rss>`,
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
    });
  });
});
