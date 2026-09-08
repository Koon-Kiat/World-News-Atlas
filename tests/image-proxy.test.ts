import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/image/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("publisher image relay", () => {
  it("cancels oversized streams even when Content-Length understates the body", async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      controller.enqueue(new Uint8Array(chunks++ === 0 ? 6 * 1024 * 1024 : 1));
    }, cancel });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Type": "image/jpeg", "Content-Length": "1" } })));
    const response = await GET(new Request("https://example.test/api/image?url=https://ichef.bbci.co.uk/photo.jpg"));
    await expect(response.arrayBuffer()).rejects.toThrow("byte limit");
    expect(cancel).toHaveBeenCalled();
  });
  it("applies the timeout to a stalled body, not only the response headers", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull() {}, cancel }), { headers: { "Content-Type": "image/jpeg" } })));
    const response = await GET(new Request("https://example.test/api/image?url=https://ichef.bbci.co.uk/photo.jpg"));
    const result = expect(response.arrayBuffer()).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(7000); await result; expect(cancel).toHaveBeenCalled();
  });
  it("revalidates redirects, rejects nonstandard ports and bad MIME, and retains safe fallbacks", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private" } }));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(new Request("https://example.test/api/image?url=https://ichef.bbci.co.uk/photo.jpg"));
    expect(response.headers.get("content-type")).toContain("image/svg+xml"); expect(fetcher).toHaveBeenCalledOnce();
    expect((await GET(new Request("https://example.test/api/image?url=https://ichef.bbci.co.uk:8443/photo.jpg"))).status).toBe(404);
    fetcher.mockResolvedValueOnce(new Response("<script>bad</script>", { headers: { "Content-Type": "image/svg+xml" } }));
    const badMime = await GET(new Request("https://example.test/api/image?url=https://ichef.bbci.co.uk/photo.jpg"));
    expect(await badMime.text()).not.toContain("<script>");
    expect(badMime.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("rejects URLs outside the reviewed publisher image path", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("https://example.test/api/image?url=https%3A%2F%2Fexample.com%2Fphoto.jpg"),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a verified image with a publisher referer", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const source = "https://www.japantimes.co.jp/japantimes/uploads/images/2026/08/26/example.jpg";

    const response = await GET(
      new Request(`https://example.test/api/image?url=${encodeURIComponent(source)}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(source),
      expect.objectContaining({
        headers: expect.objectContaining({ Referer: "https://www.japantimes.co.jp/" }),
      }),
    );
  });

  it("resolves a reviewed article og:image before relaying it", async () => {
    const article = "https://www.straitstimes.com/singapore/example-story";
    const image = "https://cassette.sphdigital.com.sg/image/straitstimes/example";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(`<html><head><meta property="og:image" content="${image}"></head></html>`, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([4, 5, 6]), {
          status: 200,
          headers: { "Content-Type": "image/webp", "Content-Length": "3" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(`https://example.test/api/image?article=${encodeURIComponent(article)}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(fetchMock).toHaveBeenNthCalledWith(1, new URL(article), expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL(image),
      expect.objectContaining({
        headers: expect.objectContaining({ Referer: "https://www.straitstimes.com/" }),
      }),
    );
  });

  it("returns an editorial fallback when a reviewed publisher supplies no usable image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html><head><title>No image</title></head></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ));
    const article = "https://www.japantimes.co.jp/commentary/example";

    const response = await GET(
      new Request(`https://example.test/api/image?article=${encodeURIComponent(article)}&topic=politics`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("Politics briefing");
  });

  it("relays an image from the reviewed official NHK news path", async () => {
    const nhkImage = "https://imgu.web.nhk/news/u/news/nd/kiji/example.jpg";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(
        `<html><head><meta property="og:image" content="${nhkImage}"></head></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      ))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const article = "https://news.web.nhk/newsweb/na/na-k1000000001";

    const response = await GET(
      new Request(`https://example.test/api/image?article=${encodeURIComponent(article)}&topic=world`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/jpeg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL(nhkImage),
      expect.objectContaining({
        headers: expect.objectContaining({ Referer: "https://news.web.nhk/" }),
      }),
    );
  });

  it("falls back from a failed supplied image to the article metadata image", async () => {
    const direct = "https://www.japantimes.co.jp/japantimes/uploads/images/2026/08/26/missing.jpg";
    const article = "https://www.japantimes.co.jp/news/2026/08/26/example";
    const recovered = "https://www.japantimes.co.jp/japantimes/uploads/images/2026/08/26/recovered.jpg";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404, headers: { "Content-Type": "text/plain" } }))
      .mockResolvedValueOnce(new Response(`<meta property="og:image" content="${recovered}">`, { status: 200, headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "image/webp", "Content-Length": "1" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(
      `https://example.test/api/image?url=${encodeURIComponent(direct)}&article=${encodeURIComponent(article)}`,
    ));

    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
