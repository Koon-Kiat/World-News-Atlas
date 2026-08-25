import type { ProviderName, SourceScope } from "@prisma/client";
import { getFixtureStories } from "@/data/fixture-news";
import { clusterArticles } from "./cluster";
import { deduplicateArticles } from "./deduplicate";
import { logNews } from "./logger";
import { normalizeProviderArticles } from "./normalize";
import { providerTimeoutFromEnvironment } from "./providers";
import { NewsApiProvider } from "./providers/newsapi";
import { ProviderError } from "./providers/provider";
import type { StoryView } from "./types";

const LIVE_CACHE_TTL_MS = 60 * 60_000;
let liveCache: { expiresAt: number; stories: StoryView[] } | null = null;

function enumValue<T extends string>(value: T): T {
  return value;
}

async function loadDatabaseStories(): Promise<StoryView[]> {
  const { prisma } = await import("@/lib/db/prisma");
  const records = await prisma.story.findMany({
    where: { lastUpdatedAt: { gte: new Date(Date.now() - 7 * 24 * 3_600_000) } },
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

async function loadLiveStories(): Promise<StoryView[]> {
  const apiKey = process.env.NEWSAPI_KEY?.trim();
  if (!apiKey) return [];
  if (liveCache && liveCache.expiresAt > Date.now()) return liveCache.stories;

  try {
    const provider = new NewsApiProvider(apiKey, providerTimeoutFromEnvironment());
    const result = await provider.fetchLatest({
      from: new Date(Date.now() - 3 * 24 * 3_600_000),
      limit: 100,
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
      liveCache = { stories, expiresAt: Date.now() + LIVE_CACHE_TTL_MS };
    }
    return stories;
  } catch (error) {
    logNews("warn", "live_news_fetch_failed", {
      provider: "NEWSAPI",
      code: error instanceof ProviderError ? error.code : "UNEXPECTED_FAILURE",
    });
    return [];
  }
}

async function liveDatasetOrFixtures(notice: string): Promise<{
  stories: StoryView[];
  dataSource: "live" | "fixtures";
  notice?: string;
}> {
  const stories = await loadLiveStories();
  if (stories.length > 0) return { stories, dataSource: "live" };
  return { stories: getFixtureStories(), dataSource: "fixtures", notice };
}

export async function loadNewsDataset(): Promise<{
  stories: StoryView[];
  dataSource: "database" | "live" | "fixtures";
  notice?: string;
}> {
  if (!process.env.DATABASE_URL) {
    return liveDatasetOrFixtures(
      "Sample coverage is shown until NewsAPI or stored ingestion is available.",
    );
  }
  try {
    const stories = await loadDatabaseStories();
    if (stories.length > 0) return { stories, dataSource: "database" };
    return liveDatasetOrFixtures("The news database is empty, so sample coverage is shown.");
  } catch {
    logNews("error", "database_query_failed", { operation: "load_news_dataset" });
    return liveDatasetOrFixtures(
      "Live stored coverage is temporarily unavailable; sample coverage is shown.",
    );
  }
}
