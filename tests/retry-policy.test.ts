import { describe, expect, it } from "vitest";
import { MAX_RETRY_AFTER_MS, parseRetryAfter, retryDelayMs } from "@/lib/news/retry-policy.mjs";

const now = Date.parse("2026-10-03T00:00:00Z");
describe("shared Retry-After policy", () => {
  it.each([["60", 60_000], ["0", 0], [" 120 ", 120_000], ["999999999999999999999999999", MAX_RETRY_AFTER_MS],
    ["Sat, 03 Oct 2026 00:01:00 GMT", 60_000], ["Fri, 02 Oct 2026 23:00:00 GMT", 0],
    ["Sunday, 04-Oct-26 00:00:00 GMT", MAX_RETRY_AFTER_MS], ["Sat Oct  3 00:01:00 2026", 60_000]])("parses and bounds %s", (raw, expected) => {
    expect(parseRetryAfter(raw, now)).toBe(expected);
  });
  it.each([undefined, null, "", "-60", "1.5", "+1", "1e3", "Infinity", "nonsense", "2026-10-03", "60 seconds", "Mon, 99 Oct 2026 25:00:00 GMT", "Mon, 31 Feb 2026 00:00:00 GMT", "Sunday, 31-Feb-26 00:00:00 GMT", "Mon Feb 31 00:00:00 2026"])("rejects malformed input %s", (raw) => {
    expect(parseRetryAfter(raw, now)).toBeNull();
  });
  it("backs off with bounded positive jitter when absent or invalid", () => {
    expect(retryDelayMs(undefined, { now, random: () => 0 })).toBe(30_000);
    expect(retryDelayMs("invalid", { now, attempt: 2, random: () => 0.5 })).toBe(60_500);
    expect(retryDelayMs("60", { now, random: () => 0.5 })).toBe(60_500);
    expect(retryDelayMs(undefined, { now, attempt: 1000, random: () => 1 })).toBe(MAX_RETRY_AFTER_MS);
  });
});
