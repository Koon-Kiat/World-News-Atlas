import { afterEach, expect, it, vi } from "vitest";
import { getInitialNews } from "@/lib/news/initial-news.server";
import { DEFAULT_NEWS_QUERY, buildNewsResponse } from "@/lib/news/query";
import { getFixtureStories } from "@/data/fixture-news";
import { relativeTime } from "@/lib/relative-time";
import type { NewsStore } from "@/lib/news/store";
import { setNewsStoreFactoryForTesting } from "@/lib/news/data-store";
import { getNews } from "@/lib/news/news-service.server";

afterEach(() => { setNewsStoreFactoryForTesting(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("returns a bounded stored first page without calling any provider", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const response = buildNewsResponse(getFixtureStories(), DEFAULT_NEWS_QUERY, "database");
  const loadStoryPage = vi.fn(async () => response);
  const store = { loadStoryPage, loadCoverage: async () => ({ complete: true, archiveComplete: true, reasons: [] }) } as unknown as NewsStore;
  const result = await getInitialNews(DEFAULT_NEWS_QUERY, async () => store);
  expect(result?.stories.length).toBeGreaterThan(0);
  expect(result?.stories.length).toBeLessThanOrEqual(12);
  expect(fetcher).not.toHaveBeenCalled();
  expect(loadStoryPage).toHaveBeenCalledOnce();
});
it("returns the shell fallback on missing, failed or slow D1 access", async () => {
  expect(await getInitialNews(DEFAULT_NEWS_QUERY, async () => null)).toBeNull();
  expect(await getInitialNews(DEFAULT_NEWS_QUERY, async () => { throw new Error("D1 failed"); })).toBeNull();
  vi.useFakeTimers();
  const pending = getInitialNews(DEFAULT_NEWS_QUERY, () => new Promise(() => {}), 1200);
  await vi.advanceTimersByTimeAsync(1200);
  expect(await pending).toBeNull();
});
it("uses a stable reference time even across server/client clock boundaries", () => {
  const published = "2026-09-07T12:00:00.000Z";
  const reference = "2026-09-07T12:29:59.999Z";
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-08"));
  expect(relativeTime(published, reference)).toBe("Just now");
  vi.setSystemTime(new Date("2027-01-01"));
  expect(relativeTime(published, reference)).toBe("Just now");
  expect(relativeTime("bad", reference)).toBe("Date unavailable");
});

it("uses the bounded D1 page for complete API coverage without re-ranking its sliced stories", async () => {
  const response = buildNewsResponse(getFixtureStories(), DEFAULT_NEWS_QUERY, "database");
  response.meta.total = 1000; response.meta.articleCount = 2000;
  const loadStories = vi.fn(async () => { throw new Error("Unnecessary full display hydration"); });
  const loadStoryPage = vi.fn(async () => response);
  const store = { loadStoryPage, loadStories, loadCoverage: async () => ({ complete: true, archiveComplete: true, reasons: [] }) } as unknown as NewsStore;
  setNewsStoreFactoryForTesting(async () => store);
  const result = await getNews(DEFAULT_NEWS_QUERY);
  expect(result).toBe(response);
  expect(result.meta.total).toBe(1000);
  expect(result.meta.articleCount).toBe(2000);
  expect(loadStories).not.toHaveBeenCalled();
  expect(loadStoryPage).toHaveBeenCalledOnce();
});
