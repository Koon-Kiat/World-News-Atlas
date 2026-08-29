import type { Prisma, PrismaClient, ProviderName, SourceScope } from "@prisma/client";
import { getFixtureStories } from "@/data/fixture-news";
import { clusterArticlesHybrid } from "./cluster";
import { deduplicateArticles } from "./deduplicate";
import { logNews } from "./logger";
import { normalizeProviderArticles } from "./normalize";
import { createConfiguredProviders, fetchProviderArticlesGracefully } from "./providers";
import { newsPeriodHours } from "./periods";
import { getCountryName } from "./countries/metadata";
import type { NewsQuery, StoryView } from "./types";

const LIVE_CACHE_TTL_MS = 60 * 60_000;
const MAX_LIVE_CACHE_ENTRIES = 40;
const DEFAULT_LIVE_ARTICLE_LIMIT = 96;
const liveCaches = new Map<string, { expiresAt: number; stories: StoryView[] }>();
const PROVIDER_COUNTRY_NAMES: Record<string, string> = {
  CN: "China",
  GB: "United Kingdom",
  RU: "Russia",
  US: "US",
};

function enumValue<T extends string>(value: T): T {
  return value;
}

function databaseArticleAccessWhere(query: NewsQuery): Prisma.ArticleWhereInput | undefined {
  const filters: Prisma.ArticleWhereInput[] = [];

  if (query.sources.length > 0) {
    filters.push({ source: { name: { in: query.sources } } });
  }

  const perspectiveCountry = query.sourcePerspective === "local" || query.sourcePerspective === "first-country"
    ? query.countries[0]
    : query.sourcePerspective === "second-country"
      ? query.countries[1]
      : undefined;
  if (perspectiveCountry) {
    filters.push({ source: { countryCode: perspectiveCountry } });
  } else if (query.sourcePerspective === "international") {
    filters.push({
      source: {
        is: {
          OR: [
            { countryCode: null },
            { countryCode: { notIn: query.countries } },
          ],
        },
      },
    });
  }

  return filters.length > 0 ? { AND: filters } : undefined;
}

function databaseStoryWhere(query: NewsQuery, now = new Date()): Prisma.StoryWhereInput {
  const filters: Prisma.StoryWhereInput[] = query.countries.map((countryCode) => ({
    countries: { some: { countryCode } },
  }));
  const articleAccessWhere = databaseArticleAccessWhere(query);

  if (query.topic) {
    filters.push({ topics: { some: { topic: { slug: query.topic } } } });
  }
  if (query.language) {
    filters.push({ articles: { some: { article: { language: query.language } } } });
  }
  if (articleAccessWhere) {
    filters.push({ articles: { some: { article: articleAccessWhere } } });
  }
  if (query.search) {
    const contains = { contains: query.search, mode: "insensitive" as const };
    filters.push({
      OR: [
        { title: contains },
        { summary: contains },
        { countries: { some: { country: { name: contains } } } },
        { topics: { some: { topic: { slug: contains } } } },
        { articles: { some: { article: { title: contains } } } },
        { articles: { some: { article: { description: contains } } } },
        { articles: { some: { article: { source: { name: contains } } } } },
      ],
    });
  }

  return {
    lastUpdatedAt: {
      gte: new Date(now.getTime() - newsPeriodHours(query.period) * 3_600_000),
    },
    ...(filters.length > 0 ? { AND: filters } : {}),
  };
}

export async function loadDatabaseStories(
  query: NewsQuery,
  client?: PrismaClient,
): Promise<StoryView[]> {
  const database = client ?? (await import("@/lib/db/prisma")).prisma;
  const records = await database.story.findMany({
    where: databaseStoryWhere(query),
    orderBy: query.sort === "newest"
      ? [{ lastUpdatedAt: "desc" }, { importanceScore: "desc" }]
      : [{ importanceScore: "desc" }, { lastUpdatedAt: "desc" }],
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
    ...query.countries.map((code) => PROVIDER_COUNTRY_NAMES[code] ?? getCountryName(code)),
    ...(query.search ? [query.search] : []),
  ]
    .map((term) => term.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (terms.length === 0) return undefined;
  // Fetch a focused candidate pool and let queryStories enforce the final
  // country/search intersection against normalized article signals.
  return terms.map((term) => `"${term}"`).join(" AND ");
}

function liveArticleLimit(): number {
  const configured = Number(process.env.NEWS_LIVE_ARTICLE_LIMIT ?? DEFAULT_LIVE_ARTICLE_LIMIT);
  return Number.isFinite(configured)
    ? Math.max(24, Math.min(150, Math.floor(configured)))
    : DEFAULT_LIVE_ARTICLE_LIMIT;
}

function takeDiverseArticles<T>(batches: T[][], limit: number): T[] {
  const selected: T[] = [];
  for (let index = 0; selected.length < limit; index += 1) {
    let added = false;
    for (const batch of batches) {
      if (index >= batch.length) continue;
      selected.push(batch[index]);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

async function loadLiveStories(query: NewsQuery): Promise<StoryView[]> {
  const searchQuery = providerSearchQuery(query);
  const cacheKey = `${query.period}|${searchQuery ?? "latest"}`;
  const liveCache = liveCaches.get(cacheKey);
  if (liveCache && liveCache.expiresAt > Date.now()) return liveCache.stories;

  try {
    const providers = createConfiguredProviders();
    if (providers.length === 0) return [];
    const limit = liveArticleLimit();
    const request = {
      from: new Date(Date.now() - newsPeriodHours(query.period) * 3_600_000),
      countries: query.countries,
      limit,
    };
    const results = await Promise.all(
      providers.map((provider) =>
        fetchProviderArticlesGracefully(
          [provider],
          searchQuery && provider.name !== "RSS" ? { ...request, query: searchQuery } : request,
        ),
      ),
    );
    // Keep cold requests within hosted worker budgets while sampling every
    // configured provider instead of letting the first large feed dominate.
    const providerArticles = takeDiverseArticles(
      results.map((result) => result.articles),
      limit,
    );
    const normalized = normalizeProviderArticles(providerArticles);
    const deduplicated = deduplicateArticles(normalized);
    const stories = (await clusterArticlesHybrid(deduplicated.articles)).map<StoryView>((story) => ({
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
  if (process.env.NEWS_FIXTURES_ENABLED?.toLowerCase() === "true") {
    return { stories: getFixtureStories(), dataSource: "fixtures", notice };
  }
  return {
    stories: [],
    dataSource: "live",
    notice: "Live providers did not return usable coverage for this request.",
  };
}

export async function loadNewsDataset(query: NewsQuery): Promise<{
  stories: StoryView[];
  dataSource: "database" | "live" | "fixtures";
  notice?: string;
}> {
  if (!process.env.DATABASE_URL) {
    return liveDatasetOrFixtures(
      query,
      "No live provider returned usable coverage.",
    );
  }
  try {
    const stories = await loadDatabaseStories(query);
    if (stories.length > 0) return { stories, dataSource: "database" };
    return liveDatasetOrFixtures(query, "The news database is empty.");
  } catch {
    logNews("error", "database_query_failed", { operation: "load_news_dataset" });
    return liveDatasetOrFixtures(
      query,
      "Live stored coverage is temporarily unavailable.",
    );
  }
}
