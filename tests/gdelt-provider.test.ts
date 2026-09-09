import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGdeltDiscoveryQueries, GdeltProvider, resetGdeltRequestPacingForTesting } from "@/lib/news/providers/gdelt";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); resetGdeltRequestPacingForTesting(); });

describe("GDELT discovery planning", () => {
  it("preserves permanent HTTP failures across the discovery branches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    await expect(new GdeltProvider(30_000, 0).search("Japan", {
      countries: ["JP"], from: new Date("2026-09-07"), to: new Date("2026-09-08"),
    })).rejects.toMatchObject({ provider: "GDELT", code: "HTTP_403" });
  });
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

  it("adds one bounded domestic-publisher branch for all-perspective discovery", () => {
    const queries = buildGdeltDiscoveryQueries("Japan", {
      countries: ["JP"],
      sourcePerspective: "all",
    });
    expect(queries).toHaveLength(3);
    expect(queries).toContainEqual(expect.stringMatching(/domainis:(?:nhk\.or\.jp|japantimes\.co\.jp)/));
  });

  it("can discover local-perspective headlines through publisher origin without assigning article subject", () => {
    const queries = buildGdeltDiscoveryQueries("Japan", {
      countries: ["JP"],
      sourcePerspective: "local",
    });
    expect(queries).toHaveLength(3);
    expect(queries).toContainEqual(expect.stringMatching(/^sourcecountry:japan sourcelang:japanese$/));
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

    const provider = new GdeltProvider(30_000, 0);
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

  it("samples recent, middle, and oldest portions of a 30-day window in the first stage", async () => {
    const requestedUrls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      const start = url.searchParams.get("startdatetime") ?? "";
      const year = start.slice(0, 4);
      const month = start.slice(4, 6);
      const day = String(Number(start.slice(6, 8)) + 1).padStart(2, "0");
      return new Response(JSON.stringify({ articles: [{
        url: `https://example.com/window-${requestedUrls.length}`,
        title: `World report ${requestedUrls.length}`,
        seendate: `${year}${month}${day}T000000Z`,
        domain: "example.com",
        language: "English",
      }] }), { status: 200 });
    }));

    const provider = new GdeltProvider(30_000, 0);
    const result = await provider.search("world", {
      language: "en",
      period: "30d",
      from: new Date("2026-08-02T00:00:00Z"),
      to: new Date("2026-09-01T00:00:00Z"),
      limit: 9,
    });

    expect(result.articles).toHaveLength(3);
    expect(requestedUrls.map((url) => url.searchParams.get("startdatetime"))).toEqual([
      "20260827000000",
      "20260812000000",
      "20260802000000",
    ]);
    expect(result.continuation?.discoveryCursors).toBeDefined();
  });

  it("tracks and exhausts each language discovery cursor independently", async () => {
    const requestedUrls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      const query = url.searchParams.get("query") ?? "";
      if (query.includes("sourcelang:english")) {
        return new Response(JSON.stringify({ articles: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ articles: [{
        url: `https://example.jp/${requestedUrls.length}`,
        title: "日本の最新ニュース",
        seendate: "20260830T060000Z",
        domain: "example.jp",
        language: "Japanese",
      }] }), { status: 200 });
    }));

    const provider = new GdeltProvider(30_000, 0);
    const request = {
      countries: ["JP"],
      from: new Date("2026-08-28T00:00:00Z"),
      to: new Date("2026-08-31T00:00:00Z"),
      limit: 1,
    };
    const first = await provider.search("Japan", request);
    const cursors = first.continuation?.discoveryCursors ?? {};
    const englishQuery = Object.keys(cursors).find((value) => value.includes("sourcelang:english"));
    const japaneseQuery = Object.keys(cursors).find((value) => value.includes("sourcelang:japanese"));

    expect(englishQuery && cursors[englishQuery]).toBeNull();
    expect(japaneseQuery && cursors[japaneseQuery]).toBe("2026-08-30T05:59:59.999Z");

    await provider.search("Japan", {
      ...request,
      continuation: first.continuation ?? undefined,
    });

    expect(requestedUrls).toHaveLength(3);
    expect(requestedUrls[2].searchParams.get("query")).toContain("sourcelang:japanese");
    expect(requestedUrls[2].searchParams.get("enddatetime")).toBe("20260830055959");
  });
});

describe("GDELT request pacing", () => {
  const request = {
    language: "en", period: "30d" as const,
    from: new Date("2026-08-02T00:00:00Z"), to: new Date("2026-09-01T00:00:00Z"), limit: 9,
  };

  it("spaces discovery branches instead of sending a throttled burst", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      starts.push(Date.now() - started);
      return Response.json({ articles: [] });
    }));
    const pending = new GdeltProvider().search("world", request);
    await vi.advanceTimersByTimeAsync(11_000);
    await pending;
    expect(starts).toEqual([0, 5_500, 11_000]);
  });

  it("keeps completed branches and resumes timed-out work within one stage budget", async () => {
    vi.useFakeTimers();
    const urls: URL[] = [];
    let slow = true;
    vi.stubGlobal("fetch", vi.fn((input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      urls.push(url);
      const respond = () => Response.json({ articles: [{
        url: `https://example.com/${url.searchParams.get("startdatetime")}`,
        title: "World report", seendate: `${url.searchParams.get("startdatetime")!.slice(0, 8)}T120000Z`,
      }] });
      if (!slow) return Promise.resolve(respond());
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(respond()), 21_000);
        init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
      });
    }));
    const provider = new GdeltProvider();
    const pending = provider.search("world", request);
    await vi.advanceTimersByTimeAsync(31_000);
    const first = await pending;
    expect(first.articles).toHaveLength(2);
    expect(first.exhausted).toBe(false);
    expect(Object.values(first.continuation!.discoveryCursors!)).toEqual([null, null]);

    slow = false;
    const resumed = provider.search("world", { ...request, continuation: first.continuation! });
    await vi.advanceTimersByTimeAsync(11_000);
    await resumed;
    const firstStarts = urls.slice(0, 3).map((url) => url.searchParams.get("startdatetime"));
    const resumedStarts = urls.slice(3).map((url) => url.searchParams.get("startdatetime"));
    expect(resumedStarts[0]).toBe(firstStarts[2]);
    expect(resumedStarts).not.toContain(firstStarts[0]);
    expect(resumedStarts).not.toContain(firstStarts[1]);
  });
});
