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
});
