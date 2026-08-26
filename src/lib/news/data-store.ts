import type { ProviderName, SourceScope } from "@prisma/client";
import { getFixtureStories } from "@/data/fixture-news";
import { clusterArticles } from "./cluster";
import { deduplicateArticles } from "./deduplicate";
import { logNews } from "./logger";
import { normalizeProviderArticles } from "./normalize";
import { createConfiguredProviders, fetchProviderArticlesGracefully } from "./providers";
import { newsPeriodHours } from "./periods";
import { getCountryName } from "./countries/metadata";
import type { NewsPeriod, NewsQuery, StoryView } from "./types";

const LIVE_CACHE_TTL_MS = 60 * 60_000;
const MAX_LIVE_CACHE_ENTRIES = 40;
const liveCaches = new Map<string, { expiresAt: number; stories: StoryView[] }>();

function enumValue<T extends string>(value: T): T {
  return value;
}

async function loadDatabaseStories(period: NewsPeriod): Promise<StoryView[]> {
  const { prisma } = await import("@/lib/db/prisma");
  const records = await prisma.story.findMany({
    where: { lastUpdatedAt: { gte: new Date(Date.now() - newsPeriodHours(period) * 3_600_000) } },
    orderBy: [{ importanceScore: "desc" }, { lastUpdatedAt: "desc" }],
    take: 250,
    include: {
      countries: { include: { country: true } },
      topics: { include: { topic: true } },
      articles: {
        include: {
          article: {
            include: {
              source: true,
              countries: { include: { country: true } },
              topics: { include: { topic: true } },
            },
          },
        },
      },
    },
  });

  return records.map((story) => ({
    id: story.id,
    title: story.title,
    summary: story.summary,
    firstPublishedAt: story.firstPublishedAt.toISOString(),
    lastUpdatedAt: story.lastUpdatedAt.toISOString(),
    importanceScore: story.importanceScore,
    countries: story.countries.map((entry) => ({
      code: entry.countryCode,
      name: entry.country.name,
      relevanceScore: entry.relevanceScore,
    })),
    topics: story.topics.map((entry) => entry.topic.slug),
    articles: story.articles.map(({ article }) => ({
      id: article.id,
      provider: enumValue<ProviderName>(article.provider),
      providerArticleId: article.providerArticleId,
      title: article.title,
      description: article.description,
      url: article.url,
      canonicalUrl: article.canonicalUrl,
      imageUrl: article.imageUrl,
      publishedAt: article.publishedAt.toISOString(),
      language: article.language,
      source: {
        id: article.source.id,
        name: article.source.name,
        domain: article.source.domain,
        countryCode: article.source.countryCode,
        region: article.source.region,
        language: article.source.language,
        scope: enumValue<SourceScope>(article.source.scope),
        qualityScore: article.source.qualityScore,
      },
      countries: article.countries.map((entry) => ({
        code: entry.countryCode,
        name: entry.country.name,
        relevanceScore: entry.relevanceScore,
      })),
      topics: article.topics.map((entry) => entry.topic.slug),
      importanceScore: article.importanceScore,
      relevanceScore: article.relevanceScore,
      isFixture: article.provider === "FIXTURE",
    })),
  })) as StoryView[];
}

function providerSearchQuery(query: NewsQuery): string | undefined {
  const terms = [
    ...query.countries.map(getCountryName),
    ...(query.search ? [query.search] : []),
  ]
    .map((term) => term.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (terms.length === 0) return undefined;
  // Fetch a broad candidate pool and let queryStories enforce the final
  // country/search intersection. This also finds reporting from one selected
  // country about the other when the publisher's own country is not repeated
  // in the headline.
  return terms.map((term) => `"${term}"`).join(" OR ");
}

async function loadLiveStories(query: NewsQuery): Promise<StoryView[]> {
  const searchQuery = providerSearchQuery(query);
  const cacheKey = `${query.period}|${searchQuery ?? "latest"}`;
  const liveCache = liveCaches.get(cacheKey);
  if (liveCache && liveCache.expiresAt > Date.now()) return liveCache.stories;

  try {
    const providers = createConfiguredProviders();
    if (providers.length === 0) return [];
    const request = {
      from: new Date(Date.now() - newsPeriodHours(query.period) * 3_600_000),
      limit: 250,
    };
    const results = searchQuery
      ? await Promise.all([
          fetchProviderArticlesGracefully(
            providers.filter((provider) => provider.name !== "RSS"),
            { ...request, query: searchQuery },
          ),
          // Publisher feeds are already a bounded, reviewed candidate set.
          // Keep the complete feed pool so local/national publishers can
          // establish one side of a country connection through source metadata.
          fetchProviderArticlesGracefully(
            providers.filter((provider) => provider.name === "RSS"),
            request,
          ),
        ])
      : [await fetchProviderArticlesGracefully(providers, request)];
    const normalized = normalizeProviderArticles(results.flatMap((result) => result.articles));
    const deduplicated = deduplicateArticles(normalized);
    const stories = clusterArticles(deduplicated.articles).map<StoryView>((story) => ({
      id: story.fingerprint,
      title: story.title,
      summary: story.summary,
      firstPublishedAt: story.firstPublishedAt,
      lastUpdatedAt: story.lastUpdatedAt,
      countries: story.countries,
      topics: story.topics,
      importanceScore: story.importanceScore,
      articles: story.articles,
    }));
    if (stories.length > 0) {
      if (liveCaches.size >= MAX_LIVE_CACHE_ENTRIES) {
        const oldestKey = liveCaches.keys().next().value;
        if (oldestKey) liveCaches.delete(oldestKey);
      }
      liveCaches.set(cacheKey, { stories, expiresAt: Date.now() + LIVE_CACHE_TTL_MS });
    }
    return stories;
  } catch (error) {
    logNews("warn", "live_news_fetch_failed", {
      code: error instanceof Error ? error.name : "UNEXPECTED_FAILURE",
    });
    return [];
  }
}

async function liveDatasetOrFixtures(query: NewsQuery, notice: string): Promise<{
  stories: StoryView[];
  dataSource: "live" | "fixtures";
  notice?: string;
}> {
  const stories = await loadLiveStories(query);
  if (stories.length > 0) return { stories, dataSource: "live" };
  return { stories: getFixtureStories(), dataSource: "fixtures", notice };
}

export async function loadNewsDataset(query: NewsQuery): Promise<{
  stories: StoryView[];
  dataSource: "database" | "live" | "fixtures";
  notice?: string;
}> {
  if (!process.env.DATABASE_URL) {
    return liveDatasetOrFixtures(
      query,
      "No live provider returned usable coverage, so the sample briefing is shown temporarily.",
    );
  }
  try {
    const stories = await loadDatabaseStories(query.period);
    if (stories.length > 0) return { stories, dataSource: "database" };
    return liveDatasetOrFixtures(query, "The news database is empty, so sample coverage is shown.");
  } catch {
    logNews("error", "database_query_failed", { operation: "load_news_dataset" });
    return liveDatasetOrFixtures(
      query,
      "Live stored coverage is temporarily unavailable; sample coverage is shown.",
    );
  }
}
