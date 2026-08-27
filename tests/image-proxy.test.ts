import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/image/route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publisher image relay", () => {
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
});
