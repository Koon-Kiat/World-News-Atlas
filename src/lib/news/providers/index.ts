import { z } from "zod";
import { DEFAULT_RSS_FEEDS, type RssFeedConfig } from "@/config/news-sources";
import { MemoryTtlCache } from "../bounded-cache";
import { logNews } from "../logger";
import type {
  ProviderArticle,
  ProviderFetchRequest,
  ProviderFetchResult,
  ProviderName,
} from "../types";
import { BingNewsProvider } from "./bing-news";
import { GdeltProvider } from "./gdelt";
import { NewsApiProvider } from "./newsapi";
import type { NewsProvider } from "./provider";
import { ProviderError } from "./provider";
import { RssProvider } from "./rss";

const rssFeedSchema = z.object({
  name: z.string().min(1).max(120),
  feedUrl: z.url(),
  websiteUrl: z.url(),
  countryCode: z.string().regex(/^[A-Za-z]{2}$/).nullable(),
  region: z.string().max(100).nullable(),
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/),
  scope: z.enum(["LOCAL", "REGIONAL", "NATIONAL", "INTERNATIONAL"]),
  coverageCountries: z.array(z.string().regex(/^[A-Za-z]{2}$/)).max(4).optional(),
});

export function providerTimeoutFromEnvironment(): number {
  const raw = Number(process.env.NEWS_PROVIDER_TIMEOUT_MS ?? 8_000);
  return Number.isFinite(raw) ? Math.max(2_000, Math.min(30_000, raw)) : 8_000;
}

export function rssFeedsFromEnvironment(): RssFeedConfig[] {
  const raw = process.env.RSS_FEEDS_JSON;
  if (!raw) return DEFAULT_RSS_FEEDS;
  try {
    const parsed = z.array(rssFeedSchema).max(100).parse(JSON.parse(raw));
    return parsed.map((feed) => ({
      ...feed,
      countryCode: feed.countryCode?.toUpperCase() ?? null,
      coverageCountries: feed.coverageCountries?.map((code) => code.toUpperCase()),
    }));
  } catch {
    logNews("warn", "rss_config_invalid", { configured: true });
    return DEFAULT_RSS_FEEDS;
  }
}

export function createConfiguredProviders(): NewsProvider[] {
  const providers: NewsProvider[] = [];
  const timeout = providerTimeoutFromEnvironment();
  providers.push(new BingNewsProvider(timeout));
  const newsApiKey = process.env.NEWSAPI_KEY?.trim();
  if (newsApiKey) providers.push(new NewsApiProvider(newsApiKey, timeout));
  else logNews("info", "provider_disabled", { provider: "NEWSAPI", reason: "missing_credential" });

  if (process.env.GDELT_ENABLED?.toLowerCase() === "true") {
    providers.push(new GdeltProvider(timeout));
  } else {
    logNews("info", "provider_disabled", { provider: "GDELT", reason: "configuration" });
  }

  const feeds = rssFeedsFromEnvironment();
  if (feeds.length > 0) providers.push(new RssProvider(feeds, timeout));
  else logNews("info", "provider_disabled", { provider: "RSS", reason: "no_approved_feeds" });
  return providers;
}

export interface ProviderBatchResult {
  articles: ProviderArticle[];
  failures: Array<{ provider: ProviderName; code: string }>;
  providerCounts: Partial<Record<ProviderName, number>>;
}

interface ProviderOutcome {
  result?: ProviderFetchResult;
  failure?: { provider: ProviderName; code: string };
}

const PROVIDER_RESULT_TTL_MS = 5 * 60_000;
const PROVIDER_EMPTY_TTL_MS = 45_000;
const PROVIDER_FAILURE_TTL_MS = 20_000;
const MAX_PROVIDER_CACHE_ENTRIES = 160;
const providerResultCache = new MemoryTtlCache<ProviderOutcome>(MAX_PROVIDER_CACHE_ENTRIES);
const providerRequestsInFlight = new Map<string, Promise<ProviderOutcome>>();

function requestTimeBucket(value?: Date): number | null {
  return value ? Math.floor(value.getTime() / (5 * 60_000)) : null;
}

function providerRequestKey(provider: NewsProvider, request: ProviderFetchRequest): string {
  return JSON.stringify({
    provider: provider.name,
    query: request.query?.trim() ?? null,
    from: requestTimeBucket(request.from),
    to: requestTimeBucket(request.to),
    countries: [...(request.countries ?? [])].sort(),
    limit: request.limit ?? null,
  });
}

async function fetchProviderOnce(
  provider: NewsProvider,
  request: ProviderFetchRequest,
): Promise<ProviderOutcome> {
  try {
    const result = request.query
      ? await provider.search(request.query, request)
      : await provider.fetchLatest(request);
    logNews("info", "provider_fetch_complete", {
      provider: provider.name,
      receivedCount: result.articles.length,
    });
    return { result };
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : "UNEXPECTED_FAILURE";
    logNews("warn", "provider_fetch_failed", { provider: provider.name, code });
    return { failure: { provider: provider.name, code } };
  }
}

async function fetchProviderCached(
  provider: NewsProvider,
  request: ProviderFetchRequest,
): Promise<ProviderOutcome> {
  const key = providerRequestKey(provider, request);
  const cached = providerResultCache.get(key);
  if (cached) return cached;

  const existing = providerRequestsInFlight.get(key);
  if (existing) return existing;

  while (providerRequestsInFlight.size >= MAX_PROVIDER_CACHE_ENTRIES) {
    const oldestKey = providerRequestsInFlight.keys().next().value;
    if (oldestKey === undefined) break;
    providerRequestsInFlight.delete(oldestKey);
  }

  const pending = fetchProviderOnce(provider, request).then((outcome) => {
    const ttlMs = outcome.failure
      ? PROVIDER_FAILURE_TTL_MS
      : outcome.result?.articles.length
        ? PROVIDER_RESULT_TTL_MS
        : PROVIDER_EMPTY_TTL_MS;
    providerResultCache.set(key, outcome, ttlMs);
    return outcome;
  });
  providerRequestsInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (providerRequestsInFlight.get(key) === pending) providerRequestsInFlight.delete(key);
  }
}

export function resetProviderRequestCacheForTesting(): void {
  providerResultCache.clear();
  providerRequestsInFlight.clear();
}

export async function fetchProviderArticlesGracefully(
  providers: NewsProvider[],
  request: ProviderFetchRequest = {},
): Promise<ProviderBatchResult> {
  const outcomes = await Promise.all(
    providers.map((provider) => fetchProviderCached(provider, request)),
  );
  const articles: ProviderArticle[] = [];
  const failures: ProviderBatchResult["failures"] = [];
  const providerCounts: ProviderBatchResult["providerCounts"] = {};

  outcomes.forEach((outcome, index) => {
    const provider = providers[index];
    if (outcome.result) {
      articles.push(...outcome.result.articles);
      providerCounts[provider.name] = outcome.result.articles.length;
    } else if (outcome.failure) {
      failures.push(outcome.failure);
    }
  });
  return { articles, failures, providerCounts };
}
