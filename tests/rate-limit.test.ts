import { expect, it } from "vitest";
import { checkRateLimit } from "@/lib/news/rate-limit";

it("limits repeated API calls within a fixed window", () => {
  const key = `test-${crypto.randomUUID()}`;
  expect(checkRateLimit(key, { limit: 2, windowMs: 1_000 }, 1_000).allowed).toBe(true);
  expect(checkRateLimit(key, { limit: 2, windowMs: 1_000 }, 1_100).allowed).toBe(true);
  expect(checkRateLimit(key, { limit: 2, windowMs: 1_000 }, 1_200).allowed).toBe(false);
  expect(checkRateLimit(key, { limit: 2, windowMs: 1_000 }, 2_001).allowed).toBe(true);
});
