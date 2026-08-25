import type { Prisma, PrismaClient, ProviderName as PrismaProviderName } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getCountryName } from "./countries/metadata";
import { topicLabel } from "./topics";
import type { NormalizedArticle, StoryCandidate } from "./types";

type TransactionClient = Prisma.TransactionClient;

async function ensureCountry(tx: TransactionClient, code: string): Promise<void> {
  await tx.country.upsert({
    where: { code },
    update: { name: getCountryName(code) },
    create: { code, name: getCountryName(code) },
  });
}

async function upsertSource(tx: TransactionClient, article: NormalizedArticle): Promise<string> {
  const data = {
    name: article.source.name,
    domain: article.source.domain,
    countryCode: article.source.countryCode,
    region: article.source.region,
    language: article.source.language,
    scope: article.source.scope,
    qualityScore: article.source.qualityScore,
    isActive: true,
  };
  if (data.countryCode) await ensureCountry(tx, data.countryCode);

  let source;
  if (data.domain) {
    source = await tx.source.upsert({
      where: { domain: data.domain },
      update: data,
      create: data,
    });
  } else {
    source = await tx.source.findFirst({
      where: { name: data.name, countryCode: data.countryCode },
    });
    source ??= await tx.source.create({ data });
  }

  if (article.sourceIdentifier) {
    await tx.sourceProviderIdentifier.upsert({
      where: {
        provider_identifier: {
          provider: article.provider as PrismaProviderName,
          identifier: article.sourceIdentifier,
        },
      },
      update: { sourceId: source.id },
      create: {
        sourceId: source.id,
        provider: article.provider as PrismaProviderName,
        identifier: article.sourceIdentifier,
      },
    });
  }
  return source.id;
}

async function upsertArticle(tx: TransactionClient, article: NormalizedArticle): Promise<string> {
  const sourceId = await upsertSource(tx, article);
  for (const country of article.countries) await ensureCountry(tx, country.code);
  const stored = await tx.article.upsert({
    where: { canonicalUrl: article.canonicalUrl },
    update: {
      title: article.title,
      description: article.description,
      url: article.url,
      imageUrl: article.imageUrl,
      publishedAt: new Date(article.publishedAt),
      language: article.language,
      sourceId,
      importanceScore: article.importanceScore,
      relevanceScore: article.relevanceScore,
    },
    create: {
      provider: article.provider as PrismaProviderName,
      providerArticleId: article.providerArticleId,
      title: article.title,
      description: article.description,
      url: article.url,
      canonicalUrl: article.canonicalUrl,
      imageUrl: article.imageUrl,
      publishedAt: new Date(article.publishedAt),
      language: article.language,
      sourceId,
      importanceScore: article.importanceScore,
      relevanceScore: article.relevanceScore,
    },
  });
  await tx.articleProviderRef.upsert({
    where: {
      provider_providerArticleId: {
        provider: article.provider as PrismaProviderName,
        providerArticleId: article.providerArticleId,
      },
    },
    update: { articleId: stored.id },
    create: {
      articleId: stored.id,
      provider: article.provider as PrismaProviderName,
      providerArticleId: article.providerArticleId,
    },
  });
  await tx.articleCountry.deleteMany({ where: { articleId: stored.id } });
  if (article.countries.length > 0) {
    await tx.articleCountry.createMany({
      data: article.countries.map((country) => ({
        articleId: stored.id,
        countryCode: country.code,
        relevanceScore: country.relevanceScore,
      })),
    });
  }
  await tx.articleTopic.deleteMany({ where: { articleId: stored.id } });
  for (const slug of article.topics) {
    const topic = await tx.topic.upsert({
      where: { slug },
      update: { label: topicLabel(slug) },
      create: { slug, label: topicLabel(slug) },
    });
    await tx.articleTopic.create({ data: { articleId: stored.id, topicId: topic.id } });
  }
  return stored.id;
}

export async function persistStoryCandidates(
  candidates: StoryCandidate[],
  client: PrismaClient = prisma,
): Promise<{ storedArticles: number; storiesUpdated: number }> {
  const articleIds = new Set<string>();
  await client.$transaction(async (tx) => {
    for (const candidate of candidates) {
      const storedIds: string[] = [];
      for (const article of candidate.articles) {
        const id = await upsertArticle(tx, article);
        storedIds.push(id);
        articleIds.add(id);
      }
      for (const country of candidate.countries) await ensureCountry(tx, country.code);
      const story = await tx.story.upsert({
        where: { fingerprint: candidate.fingerprint },
        update: {
          title: candidate.title,
          summary: candidate.summary,
          firstPublishedAt: new Date(candidate.firstPublishedAt),
          lastUpdatedAt: new Date(candidate.lastUpdatedAt),
          importanceScore: candidate.importanceScore,
          clusterScore: candidate.clusterScore,
        },
        create: {
          fingerprint: candidate.fingerprint,
          title: candidate.title,
          summary: candidate.summary,
          firstPublishedAt: new Date(candidate.firstPublishedAt),
          lastUpdatedAt: new Date(candidate.lastUpdatedAt),
          importanceScore: candidate.importanceScore,
          clusterScore: candidate.clusterScore,
        },
      });
      await tx.storyArticle.deleteMany({ where: { storyId: story.id } });
      await tx.storyArticle.createMany({
        data: storedIds.map((articleId) => ({ storyId: story.id, articleId })),
      });
      await tx.storyCountry.deleteMany({ where: { storyId: story.id } });
      if (candidate.countries.length > 0) {
        await tx.storyCountry.createMany({
          data: candidate.countries.map((country) => ({
            storyId: story.id,
            countryCode: country.code,
            relevanceScore: country.relevanceScore,
          })),
        });
      }
      await tx.storyTopic.deleteMany({ where: { storyId: story.id } });
      for (const slug of candidate.topics) {
        const topic = await tx.topic.upsert({
          where: { slug },
          update: { label: topicLabel(slug) },
          create: { slug, label: topicLabel(slug) },
        });
        await tx.storyTopic.create({ data: { storyId: story.id, topicId: topic.id } });
      }
    }
  });
  return { storedArticles: articleIds.size, storiesUpdated: candidates.length };
}
