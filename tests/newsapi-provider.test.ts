import { afterEach, describe, expect, it, vi } from "vitest";
import { NewsApiProvider } from "@/lib/news/providers/newsapi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NewsAPI provider", () => {
  it("retries without a date range when NewsAPI rejects hosted date parameters", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("top-headlines/sources")) {
        return new Response(JSON.stringify({ status: "ok", sources: [] }), { status: 200 });
      }
      if (requestedUrls.filter((item) => item.includes("/everything")).length === 1) {
        return new Response(JSON.stringify({ status: "error" }), { status: 400 });
      }
      return new Response(
        JSON.stringify({
          status: "ok",
          articles: [
            {
              source: { id: null, name: "Example News" },
              title: "A live world report",
              description: "Current reporting from the provider.",
              url: "https://example.com/live-report",
              urlToImage: null,
              publishedAt: "2026-08-25T12:00:00Z",
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new NewsApiProvider("test-key");
    const result = await provider.fetchLatest({ from: new Date("2026-08-22T00:00:00Z") });

    const everythingRequests = requestedUrls.filter((url) => url.includes("/everything"));
    expect(everythingRequests).toHaveLength(2);
    expect(everythingRequests[0]).toContain("from=");
    expect(everythingRequests[1]).not.toContain("from=");
    expect(result.articles).toHaveLength(1);
  });
});
