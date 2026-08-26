import type { ProviderName, SourceScope } from "@prisma/client";
import { getFixtureStories } from "@/data/fixture-news";
import { clusterArticles } from "./cluster";
import { deduplicateArticles } from "./deduplicate";
import { logNews } from "./logger";
import { normalizeProviderArticles } from "./normalize";
import { createConfiguredProviders, fetchProviderArticlesGracefully } from "./providers";
import { newsPeriodHours } from "./periods";
import type { NewsPeriod, StoryView } from "./types";

const LIVE_CACHE_TTL_MS = 60 * 60_000;
const liveCaches = new Map<NewsPeriod, { expiresAt: number; stories: StoryView[] }>();

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

async function loadLiveStories(period: NewsPeriod): Promise<StoryView[]> {
  const liveCache = liveCaches.get(period);
  if (liveCache && liveCache.expiresAt > Date.now()) return liveCache.stories;

  try {
    const providers = createConfiguredProviders();
    if (providers.length === 0) return [];
    const result = await fetchProviderArticlesGracefully(providers, {
      from: new Date(Date.now() - newsPeriodHours(period) * 3_600_000),
      limit: 250,
    });
    const normalized = normalizeProviderArticles(result.articles);
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
      liveCaches.set(period, { stories, expiresAt: Date.now() + LIVE_CACHE_TTL_MS });
    }
    return stories;
  } catch (error) {
    logNews("warn", "live_news_fetch_failed", {
      code: error instanceof Error ? error.name : "UNEXPECTED_FAILURE",
    });
    return [];
  }
}

async function liveDatasetOrFixtures(period: NewsPeriod, notice: string): Promise<{
  stories: StoryView[];
  dataSource: "live" | "fixtures";
  notice?: string;
}> {
  const stories = await loadLiveStories(period);
  if (stories.length > 0) return { stories, dataSource: "live" };
  return { stories: getFixtureStories(), dataSource: "fixtures", notice };
}

export async function loadNewsDataset(period: NewsPeriod = "latest"): Promise<{
  stories: StoryView[];
  dataSource: "database" | "live" | "fixtures";
  notice?: string;
}> {
  if (!process.env.DATABASE_URL) {
    return liveDatasetOrFixtures(
      period,
      "No live provider returned usable coverage, so the sample briefing is shown temporarily.",
    );
  }
  try {
    const stories = await loadDatabaseStories(period);
    if (stories.length > 0) return { stories, dataSource: "database" };
    return liveDatasetOrFixtures(period, "The news database is empty, so sample coverage is shown.");
  } catch {
    logNews("error", "database_query_failed", { operation: "load_news_dataset" });
    return liveDatasetOrFixtures(
      period,
      "Live stored coverage is temporarily unavailable; sample coverage is shown.",
    );
  }
}
