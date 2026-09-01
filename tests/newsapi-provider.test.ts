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

  it("locally rejects out-of-window articles after the hosted date fallback", async () => {
    let everythingCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("top-headlines/sources")) {
        return new Response(JSON.stringify({ status: "ok", sources: [] }), { status: 200 });
      }
      everythingCalls += 1;
      if (everythingCalls === 1) return new Response(JSON.stringify({ status: "error" }), { status: 400 });
      return new Response(JSON.stringify({
        status: "ok",
        totalResults: 1,
        articles: [{
          source: { id: null, name: "Old News" },
          title: "An old report outside the requested window",
          description: null,
          url: "https://example.com/old-report",
          urlToImage: null,
          publishedAt: "2026-07-01T00:00:00Z",
        }],
      }), { status: 200 });
    }));

    const result = await new NewsApiProvider("test-key").search("Japan", {
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-31T00:00:00Z"),
    });
    expect(result.articles).toHaveLength(0);
    expect(result.diagnostics?.outOfWindow).toBe(1);
  });

  it("targets selected source IDs and domains without forcing Japanese requests to English", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("top-headlines/sources")) {
        return new Response(JSON.stringify({ status: "ok", sources: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "ok", articles: [] }), { status: 200 });
    }));

    await new NewsApiProvider("test-key").search("Japan", {
      language: "ja",
      sourceTargets: [{
        id: "bbc",
        name: "BBC",
        domains: ["bbc.com", "bbc.co.uk"],
        providerIdentifiers: { NEWSAPI: ["bbc-news"] },
      }],
    });

    const request = new URL(requestedUrls.find((url) => url.includes("/everything"))!);
    expect(request.searchParams.get("sources")).toBe("bbc-news");
    expect(request.searchParams.get("domains")).toBe("bbc.com,bbc.co.uk");
    expect(request.searchParams.has("language")).toBe(false);
  });

  it("caches source metadata and pushes a local publisher country upstream", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("top-headlines/sources")) {
        return new Response(JSON.stringify({
          status: "ok",
          sources: [
            { id: "bbc-news", country: "gb" },
            { id: "channel-news-asia", country: "sg" },
            { id: "straits-times", country: "sg" },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "ok", totalResults: 200, articles: [] }), { status: 200 });
    }));

    const provider = new NewsApiProvider("test-key");
    await provider.search("Singapore", {
      countries: ["SG"],
      sourcePerspective: "local",
    });
    await provider.search("Singapore", {
      countries: ["SG"],
      sourcePerspective: "local",
      continuation: { page: 2 },
    });

    expect(requestedUrls.filter((url) => url.includes("top-headlines/sources"))).toHaveLength(1);
    const everything = requestedUrls
      .filter((url) => url.includes("/everything"))
      .map((url) => new URL(url));
    expect(everything).toHaveLength(2);
    expect(everything.every((url) =>
      url.searchParams.get("sources") === "channel-news-asia,straits-times"
    )).toBe(true);
  });

  it("advances supported result pages without requesting page 1 again", async () => {
    const pages: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/sources")) {
        return new Response(JSON.stringify({ status: "ok", sources: [] }), { status: 200 });
      }
      pages.push(url.searchParams.get("page") ?? "");
      const page = Number(url.searchParams.get("page"));
      return new Response(JSON.stringify({
        status: "ok",
        totalResults: 5,
        articles: Array.from({ length: page === 3 ? 1 : 2 }, (_, index) => ({
          source: { id: null, name: "Example News" },
          title: `Report ${page}-${index}`,
          description: null,
          url: `https://example.com/${page}-${index}`,
          urlToImage: null,
          publishedAt: "2026-08-30T12:00:00Z",
        })),
      }), { status: 200 });
    }));

    const provider = new NewsApiProvider("test-key");
    const first = await provider.search("world", { limit: 2 });
    const second = await provider.search("world", { limit: 2, continuation: first.continuation ?? undefined });
    const third = await provider.search("world", { limit: 2, continuation: second.continuation ?? undefined });

    expect(pages).toEqual(["1", "2", "3"]);
    expect(first.continuation).toEqual({ page: 2 });
    expect(second.continuation).toEqual({ page: 3 });
    expect(third).toMatchObject({ continuation: null, exhausted: true });
  });

  it("reports the subscription result ceiling separately from normal time-range exhaustion", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) =>
      String(input).includes("top-headlines/sources")
        ? new Response(JSON.stringify({ status: "ok", sources: [] }), { status: 200 })
        : new Response(JSON.stringify({ status: "error" }), { status: 426 })
    ));

    await expect(new NewsApiProvider("test-key").search("Singapore", {
      continuation: { page: 4 },
    })).rejects.toMatchObject({ code: "PROVIDER_LIMIT" });
  });
});
