// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as health } from "@/app/api/health/route";
import { GET as news } from "@/app/api/news/route";
import { contentSecurityPolicy } from "@/lib/security-headers";
import { proxy } from "@/proxy";
import { buildNewsResponse, DEFAULT_NEWS_QUERY } from "@/lib/news/query";

const mocked = vi.hoisted(() => ({ limit: vi.fn(), getNews: vi.fn() }));
vi.mock("@/lib/news/distributed-rate-limit", () => ({ limitNewsRequest: mocked.limit }));
vi.mock("@/lib/news/news-service.server", () => ({ getNews: mocked.getNews }));
beforeEach(() => {
  mocked.limit.mockReset().mockResolvedValue({ allowed: true, remaining: 89, retryAfterSeconds: 60 });
  mocked.getNews.mockReset().mockResolvedValue(buildNewsResponse([], DEFAULT_NEWS_QUERY, "database"));
});
it("exposes only public liveness", async () => {
  const response = await health();
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("uses nonces and same-origin production connections without arbitrary inline scripts", () => {
  const request = new NextRequest("https://example.test/country", { headers: { "content-security-policy": "script-src 'nonce-attacker'" } });
  const first = proxy(request).headers.get("Content-Security-Policy")!;
  const second = proxy(request).headers.get("Content-Security-Policy")!;
  expect(first).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
  expect(first).not.toBe(second); expect(first).not.toContain("attacker");
  const production = contentSecurityPolicy("test-nonce");
  expect(production).toContain("connect-src 'self';");
  expect(production).toContain("img-src 'self' data:;");
  expect(production).not.toContain("https:");
  expect(production.split(";").find((part) => part.trim().startsWith("script-src "))).not.toContain("unsafe-inline");
});
it("emits shared-limit 429 and Retry-After without calling news providers", async () => {
  mocked.limit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 23 });
  const response = await news(new Request("https://example.test/api/news"));
  expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("23");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocked.getNews).not.toHaveBeenCalled();
});
it("fails closed when production shared enforcement is unavailable", async () => {
  mocked.limit.mockRejectedValue(new Error("storage unavailable"));
  const response = await news(new Request("https://example.test/api/news"));
  expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("10");
  expect(mocked.getNews).not.toHaveBeenCalled();
});
it("caches ordinary database pages but never live or explicit continuation responses", async () => {
  expect((await news(new Request("https://example.test/api/news"))).headers.get("cache-control")).toContain("public, max-age=20");
  expect((await news(new Request("https://example.test/api/news?continuation=0123456789abcdef"))).headers.get("cache-control")).toBe("no-store");
  mocked.getNews.mockResolvedValue(buildNewsResponse([], DEFAULT_NEWS_QUERY, "live"));
  expect((await news(new Request("https://example.test/api/news"))).headers.get("cache-control")).toBe("no-store");
});
