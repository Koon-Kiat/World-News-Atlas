import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfiguredProviders, gdeltModeFromEnvironment, gdeltTimeoutFromEnvironment, shouldEnableGdelt } from "@/lib/news/providers";
import { resetGdeltRequestPacingForTesting } from "@/lib/news/providers/gdelt";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); resetGdeltRequestPacingForTesting(); });

describe("archive provider configuration", () => {
  it("rejects invalid operator configuration instead of silently selecting defaults", () => {
    vi.stubEnv("RSS_FEEDS_JSON", "not JSON");
    expect(() => createConfiguredProviders()).toThrow("INVALID_CONFIGURATION");
    vi.stubEnv("RSS_FEEDS_JSON", "[]");
    vi.stubEnv("GDELT_MODE", "sometimes");
    expect(() => createConfiguredProviders()).toThrow("INVALID_CONFIGURATION");
  });
  it("does not configure NewsAPI when its credential is removed or explicitly cleared", () => {
    vi.stubEnv("NEWSAPI_KEY", undefined);
    expect(createConfiguredProviders().some(({ name }) => name === "NEWSAPI")).toBe(false);
    vi.stubEnv("NEWSAPI_KEY", "");
    expect(createConfiguredProviders().some(({ name }) => name === "NEWSAPI")).toBe(false);
  });
  it("allows a legitimate 21-second GDELT response independently of the eight-second general timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GDELT_MODE", "on"); vi.stubEnv("NEWS_PROVIDER_TIMEOUT_MS", "8000");
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({ articles: [] })), 21_000);
      init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
    })));
    const provider = createConfiguredProviders({ period: "30d", countries: ["US"] }).find(({ name }) => name === "GDELT")!;
    const checked = expect(provider.fetchLatest({ countries: [], from: new Date("2026-09-07"), to: new Date("2026-09-08") }))
      .resolves.toMatchObject({ provider: "GDELT", articles: [], exhausted: true });
    // Runtime binding discovery is asynchronous. Advance the response clock
    // only after the request actually starts, not while loading that binding.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(21_000);
    await checked;
  });

  it("bounds the separate GDELT timeout beneath the 32-second ingestion stage deadline", () => {
    vi.stubEnv("NEWS_GDELT_TIMEOUT_MS", "30000"); expect(gdeltTimeoutFromEnvironment()).toBe(30_000);
    vi.stubEnv("NEWS_GDELT_TIMEOUT_MS", "Infinity"); expect(gdeltTimeoutFromEnvironment()).toBe(30_000);
    vi.stubEnv("NEWS_GDELT_TIMEOUT_MS", "999999"); expect(gdeltTimeoutFromEnvironment()).toBe(30_000);
    vi.stubEnv("NEWS_GDELT_TIMEOUT_MS", "0"); expect(gdeltTimeoutFromEnvironment()).toBe(8_000);
  });
  it("enables GDELT automatically only for historical country discovery", () => {
    vi.stubEnv("GDELT_MODE", "auto");
    expect(shouldEnableGdelt({ period: "30d", countries: ["US"] })).toBe(true);
    expect(shouldEnableGdelt({ period: "7d", countries: ["DE"] })).toBe(true);
    expect(shouldEnableGdelt({ period: "latest", countries: ["US"] })).toBe(false);
    expect(shouldEnableGdelt({ period: "30d", countries: [] })).toBe(false);
  });

  it("retains the legacy switch while giving the explicit mode precedence", () => {
    vi.stubEnv("GDELT_MODE", "");
    vi.stubEnv("GDELT_ENABLED", "true");
    expect(gdeltModeFromEnvironment()).toBe("on");
    vi.stubEnv("GDELT_MODE", "off");
    expect(gdeltModeFromEnvironment()).toBe("off");
    expect(shouldEnableGdelt({ period: "30d", countries: ["US"] })).toBe(false);
  });
});
