import type { ProviderName, SourceScope } from "@prisma/client";
import { getFixtureStories } from "@/data/fixture-news";
import { prisma } from "@/lib/db/prisma";
import { logNews } from "./logger";
import type { StoryView } from "./types";

function enumValue<T extends string>(value: T): T {
  return value;
}

async function loadDatabaseStories(): Promise<StoryView[]> {
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

export async function loadNewsDataset(): Promise<{
  stories: StoryView[];
  dataSource: "database" | "fixtures";
  notice?: string;
}> {
  if (!process.env.DATABASE_URL) {
    return {
      stories: getFixtureStories(),
      dataSource: "fixtures",
      notice: "Sample coverage is shown until a database and news ingestion are configured.",
    };
  }
  try {
    const stories = await loadDatabaseStories();
    if (stories.length > 0) return { stories, dataSource: "database" };
    return {
      stories: getFixtureStories(),
      dataSource: "fixtures",
      notice: "The news database is empty, so sample coverage is shown.",
    };
  } catch {
    logNews("error", "database_query_failed", { operation: "load_news_dataset" });
    return {
      stories: getFixtureStories(),
      dataSource: "fixtures",
      notice: "Live stored coverage is temporarily unavailable; sample coverage is shown.",
    };
  }
}
