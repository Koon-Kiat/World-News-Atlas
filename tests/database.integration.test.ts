import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clusterArticles } from "@/lib/news/cluster";
import { loadDatabaseStories } from "@/lib/news/data-store";
import { persistStoryCandidates } from "@/lib/news/persistence";
import { buildNewsResponse } from "@/lib/news/query";
import type { NewsQuery, NormalizedArticle } from "@/lib/news/types";

const databaseTestsEnabled = process.env.NEWS_DB_TESTS === "true";
const prisma = new PrismaClient();

const baseQuery: NewsQuery = {
  countries: [],
  sourcePerspective: "all",
  sources: [],
  period: "30d",
  sort: "newest",
  page: 1,
  pageSize: 12,
};

function article(
  id: string,
  title: string,
  countries: Array<{ code: string; name: string; relevanceScore: number }>,
  topics = ["politics"],
): NormalizedArticle {
  const publishedAt = new Date(Date.now() - 60_000).toISOString();
  return {
    id,
    provider: "RSS",
    providerArticleId: id,
    title,
    description: `${title} reporting summary`,
    url: `https://example.com/${id}`,
    canonicalUrl: `https://example.com/${id}`,
    imageUrl: null,
    publishedAt,
    language: "en",
    source: {
      id: "integration-news",
      name: "Integration News",
      domain: "example.com",
      countryCode: "JP",
      region: "Asia",
      language: "en",
      scope: "NATIONAL",
      qualityScore: 0.9,
    },
    sourceIdentifier: "integration-news",
    countries,
    topics,
    importanceScore: 0.8,
    relevanceScore: 0.9,
  };
}

async function clearDatabase(): Promise<void> {
  await prisma.providerIngestionRun.deleteMany();
  await prisma.story.deleteMany();
  await prisma.article.deleteMany();
  await prisma.sourceProviderIdentifier.deleteMany();
  await prisma.topic.deleteMany();
  await prisma.source.deleteMany();
  await prisma.country.deleteMany();
}

describe.skipIf(!databaseTestsEnabled)("PostgreSQL news integration", () => {
  beforeEach(clearDatabase);

  afterAll(async () => {
    await clearDatabase();
    await prisma.$disconnect();
  });

  it("persists, reclusters, and repeats ingestion without stale or duplicate stories", async () => {
    const initial = article(
      "cluster-a",
      "Japan launches a regional technology programme",
      [{ code: "JP", name: "Japan", relevanceScore: 1 }],
    );
    const firstCandidates = clusterArticles([initial]);
    await persistStoryCandidates(firstCandidates, prisma);

    const firstStory = await prisma.story.findFirstOrThrow({
      include: { articles: true, countries: true, topics: { include: { topic: true } } },
    });
    expect(firstStory.articles).toHaveLength(1);
    expect(firstStory.countries.map((country) => country.countryCode)).toEqual(["JP"]);
    const firstQuery = { ...baseQuery, countries: ["JP"] };
    const firstResponse = buildNewsResponse(
      await loadDatabaseStories(firstQuery, prisma),
      firstQuery,
      "database",
    );
    expect(firstResponse.meta.total).toBe(1);
    expect(firstResponse.stories[0].articles[0].canonicalUrl).toBe(initial.canonicalUrl);

    const reclusteredArticle = article(
      "cluster-a",
      "Japan and Singapore launch a technology programme",
      [
        { code: "JP", name: "Japan", relevanceScore: 1 },
        { code: "SG", name: "Singapore", relevanceScore: 1 },
      ],
      ["technology"],
    );
    const relatedArticle = article(
      "cluster-b",
      "Singapore and Japan launch technology programme",
      [
        { code: "JP", name: "Japan", relevanceScore: 1 },
        { code: "SG", name: "Singapore", relevanceScore: 1 },
      ],
      ["technology"],
    );
    const nextCandidates = clusterArticles([reclusteredArticle, relatedArticle]);
    expect(nextCandidates).toHaveLength(1);
    expect(nextCandidates[0].fingerprint).not.toBe(firstStory.fingerprint);

    await persistStoryCandidates(nextCandidates, prisma);
    await persistStoryCandidates(nextCandidates, prisma);

    const stories = await prisma.story.findMany({
      include: { articles: true, countries: true, topics: { include: { topic: true } } },
    });
    expect(stories).toHaveLength(1);
    expect(stories[0].articles).toHaveLength(2);
    expect(stories[0].countries.map((country) => country.countryCode).sort()).toEqual(["JP", "SG"]);
    expect(stories[0].topics.map((topic) => topic.topic.slug)).toEqual(["technology"]);

    const storedArticle = await prisma.article.findUniqueOrThrow({
      where: { canonicalUrl: reclusteredArticle.canonicalUrl },
      include: { storyLinks: true },
    });
    expect(storedArticle.storyLinks).toHaveLength(1);
    expect(storedArticle.storyLinks[0].storyId).toBe(stories[0].id);

    const bilateralQuery = { ...baseQuery, countries: ["JP", "SG"] };
    const bilateralResponse = buildNewsResponse(
      await loadDatabaseStories(bilateralQuery, prisma),
      bilateralQuery,
      "database",
    );
    expect(bilateralResponse.meta.total).toBe(1);
    expect(bilateralResponse.stories[0].articles).toHaveLength(2);
    expect(bilateralResponse.stories[0].id).toBe(stories[0].id);
  });

  it("queries, sorts, and paginates more than 250 stored stories", async () => {
    const now = Date.now();
    await prisma.country.createMany({
      data: [
        { code: "JP", name: "Japan" },
        { code: "SG", name: "Singapore" },
      ],
    });
    const source = await prisma.source.create({
      data: {
        name: "Scale Test News",
        domain: "scale.example.com",
        countryCode: "JP",
        language: "en",
        region: "Asia",
        scope: "NATIONAL",
        qualityScore: 0.9,
      },
    });
    const topic = await prisma.topic.create({ data: { slug: "technology", label: "Technology" } });
    const rows = Array.from({ length: 275 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      const publishedAt = new Date(now - index * 60_000);
      return {
        index,
        articleId: `article-${suffix}`,
        storyId: `story-${suffix}`,
        publishedAt,
      };
    });

    await prisma.article.createMany({
      data: rows.map((row) => ({
        id: row.articleId,
        provider: "RSS",
        providerArticleId: row.articleId,
        title: `Japan technology briefing ${row.index}`,
        description: `Stored scale-test story ${row.index}`,
        url: `https://scale.example.com/${row.index}`,
        canonicalUrl: `https://scale.example.com/${row.index}`,
        imageUrl: null,
        publishedAt: row.publishedAt,
        language: "en",
        sourceId: source.id,
        importanceScore: 0.7,
        relevanceScore: 1,
      })),
    });
    await prisma.story.createMany({
      data: rows.map((row) => ({
        id: row.storyId,
        fingerprint: `fingerprint-${row.index}`,
        title: `Japan technology briefing ${row.index}`,
        summary: `Stored scale-test story ${row.index}`,
        firstPublishedAt: row.publishedAt,
        lastUpdatedAt: row.publishedAt,
        importanceScore: 0.7,
        clusterScore: 1,
      })),
    });
    await prisma.articleCountry.createMany({
      data: rows.flatMap((row) => [
        { articleId: row.articleId, countryCode: "JP", relevanceScore: 1 },
        ...(row.index < 30
          ? [{ articleId: row.articleId, countryCode: "SG", relevanceScore: 1 }]
          : []),
      ]),
    });
    await prisma.articleTopic.createMany({
      data: rows.map((row) => ({ articleId: row.articleId, topicId: topic.id })),
    });
    await prisma.storyArticle.createMany({
      data: rows.map((row) => ({ storyId: row.storyId, articleId: row.articleId })),
    });
    await prisma.storyCountry.createMany({
      data: rows.flatMap((row) => [
        { storyId: row.storyId, countryCode: "JP", relevanceScore: 1 },
        ...(row.index < 30
          ? [{ storyId: row.storyId, countryCode: "SG", relevanceScore: 1 }]
          : []),
      ]),
    });
    await prisma.storyTopic.createMany({
      data: rows.map((row) => ({ storyId: row.storyId, topicId: topic.id })),
    });

    const allStories = await loadDatabaseStories(baseQuery, prisma);
    expect(allStories).toHaveLength(275);

    const page = buildNewsResponse(allStories, { ...baseQuery, page: 22 }, "database");
    expect(page.meta.total).toBe(275);
    expect(page.stories).toHaveLength(12);
    expect(page.stories[0].id).toBe("story-252");

    const newest = buildNewsResponse(allStories, baseQuery, "database");
    expect(newest.stories[0].id).toBe("story-000");

    const bilateralStories = await loadDatabaseStories(
      { ...baseQuery, countries: ["JP", "SG"] },
      prisma,
    );
    const bilateral = buildNewsResponse(
      bilateralStories,
      { ...baseQuery, countries: ["JP", "SG"], pageSize: 50 },
      "database",
    );
    expect(bilateral.meta.total).toBe(30);
    expect(
      bilateral.stories.every((story) =>
        ["JP", "SG"].every((countryCode) =>
          story.countries.some((country) => country.code === countryCode),
        ),
      ),
    ).toBe(true);

    const searched = await loadDatabaseStories(
      { ...baseQuery, search: "briefing 274" },
      prisma,
    );
    expect(searched.map((story) => story.id)).toEqual(["story-274"]);

    const bySource = await loadDatabaseStories(
      { ...baseQuery, sources: ["Scale Test News"] },
      prisma,
    );
    expect(bySource).toHaveLength(275);
    const withoutSource = await loadDatabaseStories(
      { ...baseQuery, sources: ["Missing News"] },
      prisma,
    );
    expect(withoutSource).toEqual([]);

    const localPerspective = await loadDatabaseStories(
      { ...baseQuery, countries: ["JP"], sourcePerspective: "local" },
      prisma,
    );
    expect(localPerspective).toHaveLength(275);
    const internationalPerspective = await loadDatabaseStories(
      { ...baseQuery, countries: ["JP"], sourcePerspective: "international" },
      prisma,
    );
    expect(internationalPerspective).toEqual([]);
  });

  it("persists Japanese Unicode and returns the stable publisher ID", async () => {
    const japanese = {
      ...article(
        "jp-unicode",
        "日本政府が半導体投資を発表",
        [{ code: "JP", name: "Japan", relevanceScore: 1 }],
        ["politics", "business", "technology"],
      ),
      description: "東京で新しい技術政策を説明しました。",
      language: "ja",
      url: "https://news.web.nhk/newsweb/na/na-k1000000002",
      canonicalUrl: "https://news.web.nhk/newsweb/na/na-k1000000002",
      source: {
        id: "nhk",
        name: "NHK",
        domain: "nhk.or.jp",
        countryCode: "JP",
        region: "Asia",
        language: "ja",
        scope: "NATIONAL" as const,
        qualityScore: 0.88,
      },
    };
    await persistStoryCandidates(clusterArticles([japanese]), prisma);

    const stored = await prisma.article.findUniqueOrThrow({ where: { canonicalUrl: japanese.canonicalUrl } });
    expect(stored.title).toBe("日本政府が半導体投資を発表");
    expect(stored.description).toBe("東京で新しい技術政策を説明しました。");
    const stories = await loadDatabaseStories({ ...baseQuery, countries: ["JP"], language: "ja" }, prisma);
    expect(stories[0].articles[0].source.id).toBe("nhk");
  });
});
