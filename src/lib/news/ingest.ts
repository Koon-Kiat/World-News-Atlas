import { clusterArticles } from "./cluster";
import { deduplicateArticles } from "./deduplicate";
import { logNews } from "./logger";
import { normalizeProviderArticles } from "./normalize";
import { persistStoryCandidates } from "./persistence";
import { FixtureProvider } from "./providers/fixture";
import {
  createConfiguredProviders,
  fetchProviderArticlesGracefully,
} from "./providers";
import type { NewsProvider } from "./providers/provider";

export interface IngestionSummary {
  providersAttempted: number;
  providersFailed: number;
  received: number;
  normalized: number;
  rejected: number;
  duplicatesRemoved: number;
  stored: number;
  storiesUpdated: number;
  usedFixtures: boolean;
  persisted: boolean;
}

export async function runNewsIngestion(options: {
  providers?: NewsProvider[];
  persist?: boolean;
} = {}): Promise<IngestionSummary> {
  const startedAt = Date.now();
  const providers = options.providers ?? createConfiguredProviders();
  logNews("info", "ingestion_started", { providersAttempted: providers.length });
  let batch = await fetchProviderArticlesGracefully(providers, {
    // NewsAPI's development plan delays articles, so keep enough overlap for
    // local ingestion while paid plans still receive the newest stories.
    from: new Date(Date.now() - 3 * 24 * 3_600_000),
    limit: 200,
  });
  let usedFixtures = false;

  if (
    batch.articles.length === 0 &&
    process.env.NEWS_FIXTURES_ENABLED?.toLowerCase() === "true"
  ) {
    const fixtureBatch = await fetchProviderArticlesGracefully([new FixtureProvider()], { limit: 200 });
    batch = {
      articles: fixtureBatch.articles,
      failures: [...batch.failures, ...fixtureBatch.failures],
      providerCounts: { ...batch.providerCounts, ...fixtureBatch.providerCounts },
    };
    usedFixtures = true;
  }

  let rejected = 0;
  const normalized = normalizeProviderArticles(batch.articles, (_error, article) => {
    rejected += 1;
    logNews("warn", "article_rejected", {
      provider: article.provider,
      providerArticleId: article.providerArticleId,
    });
  });
  const deduplicated = deduplicateArticles(normalized);
  const stories = clusterArticles(deduplicated.articles);
  const shouldPersist = options.persist ?? Boolean(process.env.DATABASE_URL);
  let stored = 0;
  let storiesUpdated = 0;

  if (shouldPersist) {
    const result = await persistStoryCandidates(stories);
    stored = result.storedArticles;
    storiesUpdated = result.storiesUpdated;
  } else {
    logNews("info", "ingestion_persistence_skipped", { reason: "database_not_configured" });
  }

  const summary: IngestionSummary = {
    providersAttempted: providers.length,
    providersFailed: batch.failures.length,
    received: batch.articles.length,
    normalized: normalized.length,
    rejected,
    duplicatesRemoved: deduplicated.duplicateCount,
    stored,
    storiesUpdated,
    usedFixtures,
    persisted: shouldPersist,
  };
  logNews("info", "ingestion_completed", {
    ...summary,
    durationMs: Date.now() - startedAt,
  });
  return summary;
}
