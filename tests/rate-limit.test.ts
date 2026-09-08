import { describe, expect, it } from "vitest";
import { clientKey } from "@/lib/news/client-key";
import { checkRateLimit, MemoryRateLimitStore } from "@/lib/news/rate-limit";

it("limits repeated API calls within a fixed window", () => {
  const key = `test-${crypto.randomUUID()}`;
  expect(checkRateLimit(key, { limit: 2, windowMs: 1_000 }, 1_000).allowed).toBe(true);
  expect(checkRateLimit(key, { limit: 2, windowMs: 1_000 }, 1_100).allowed).toBe(true);
  expect(checkRateLimit(key, { limit: 2, windowMs: 1_000 }, 1_200).allowed).toBe(false);
  expect(checkRateLimit(key, { limit: 2, windowMs: 1_000 }, 2_001).allowed).toBe(true);
});

it("keeps the in-memory limiter strictly bounded", () => {
  const store = new MemoryRateLimitStore(2);
  checkRateLimit("first", { limit: 2, windowMs: 10_000 }, 1_000, store);
  checkRateLimit("second", { limit: 2, windowMs: 10_000 }, 1_001, store);
  checkRateLimit("third", { limit: 2, windowMs: 10_000 }, 1_002, store);

  expect(store.size).toBe(2);
  expect(checkRateLimit("third", { limit: 2, windowMs: 10_000 }, 1_003, store).remaining).toBe(0);
});

describe("client identity", () => {
  it("prefers the platform-provided Cloudflare address", () => {
    const request = new Request("https://example.test/api/news", {
      headers: {
        "cf-connecting-ip": "203.0.113.7",
        "x-real-ip": "198.51.100.9",
        "x-forwarded-for": "192.0.2.5, 198.51.100.1",
      },
    });
    expect(clientKey(request, true)).toBe("203.0.113.7");
    expect(clientKey(request, false)).toBe("anonymous");
  });

  it("rejects malformed spoofed address values", () => {
    const request = new Request("https://example.test/api/news", {
      headers: { "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "also-invalid" },
    });
    expect(clientKey(request)).toBe("anonymous");
  });

  it("never uses attacker-controlled conventional forwarding headers", () => {
    expect(clientKey(new Request("https://example.test/api/news", {
      headers: { "x-real-ip": "198.51.100.9", "x-forwarded-for": "192.0.2.5" },
    }), true)).toBe("anonymous");
    expect(clientKey(new Request("https://example.test/api/news", {
      headers: { "x-forwarded-for": "192.0.2.5, 198.51.100.1" },
    }), true)).toBe("anonymous");
  });

  it("normalizes equivalent IPv6 identities", () => {
    const first = new Request("https://example.test", { headers: { "cf-connecting-ip": "2001:db8::1" } });
    const second = new Request("https://example.test", { headers: { "cf-connecting-ip": "2001:0db8:0:0:0:0:0:1" } });
    expect(clientKey(first, true)).toBe(clientKey(second, true));
  });
});
