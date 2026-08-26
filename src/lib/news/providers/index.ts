import { z } from "zod";
import { DEFAULT_RSS_FEEDS, type RssFeedConfig } from "@/config/news-sources";
import { logNews } from "../logger";
import type { ProviderArticle, ProviderFetchRequest, ProviderName } from "../types";
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

export async function fetchProviderArticlesGracefully(
  providers: NewsProvider[],
  request: ProviderFetchRequest = {},
): Promise<ProviderBatchResult> {
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const result = request.query
        ? await provider.search(request.query, request)
        : await provider.fetchLatest(request);
      logNews("info", "provider_fetch_complete", {
        provider: provider.name,
        receivedCount: result.articles.length,
      });
      return result;
    }),
  );
  const articles: ProviderArticle[] = [];
  const failures: ProviderBatchResult["failures"] = [];
  const providerCounts: ProviderBatchResult["providerCounts"] = {};

  settled.forEach((result, index) => {
    const provider = providers[index];
    if (result.status === "fulfilled") {
      articles.push(...result.value.articles);
      providerCounts[provider.name] = result.value.articles.length;
    } else {
      const code = result.reason instanceof ProviderError ? result.reason.code : "UNEXPECTED_FAILURE";
      failures.push({ provider: provider.name, code });
      logNews("warn", "provider_fetch_failed", { provider: provider.name, code });
    }
  });
  return { articles, failures, providerCounts };
}
