// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/source-logo/route";

afterEach(() => vi.unstubAllGlobals());
const request = (domain: string) => new Request(`https://example.com/api/source-logo?domain=${encodeURIComponent(domain)}`);
describe("publisher logo proxy", () => {
  it("uses one fixed upstream and returns a cacheable bounded image", async () => {
    const fetchMock = vi.fn<(url: URL, options: RequestInit) => Promise<Response>>(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request("bbc.com"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("max-age=86400");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.origin).toBe("https://t2.gstatic.com");
    expect(url.searchParams.get("url")).toBe("https://bbc.com");
    expect(options.redirect).toBe("manual");
  });
  it.each(["127.0.0.1", "localhost", "https://bbc.com", "bbc.com/path", "bbc.com@localhost", "bbc.com?url=http://localhost"])("rejects non-hostname input %s", async (domain) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request(domain))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["text/html", "image/svg+xml"])("does not serve active upstream content %s", async (type) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unsafe", { headers: { "Content-Type": type } })));
    expect((await GET(request("bbc.com"))).status).toBe(404);
  });
  it("rejects oversized bodies even without a Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(65 * 1024), { headers: { "Content-Type": "image/png" } })));
    expect((await GET(request("bbc.com"))).status).toBe(404);
  });
  it("does not follow upstream redirects", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "http://localhost/" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request("bbc.com"))).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
