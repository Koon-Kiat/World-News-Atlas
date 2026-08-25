import "server-only";
import { buildNewsResponse } from "./query";
import type { NewsQuery, NewsResponse } from "./types";
import { loadNewsDataset } from "./data-store";

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 100;
const responseCache = new Map<string, { expiresAt: number; value: NewsResponse }>();

function cacheKey(query: NewsQuery): string {
  return JSON.stringify(query);
}

export async function getNews(query: NewsQuery): Promise<NewsResponse> {
  const key = cacheKey(query);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const dataset = await loadNewsDataset();
  const response = buildNewsResponse(
    dataset.stories,
    query,
    dataset.dataSource,
    dataset.notice,
  );
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value: response });
  return response;
}
