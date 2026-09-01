import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, ProviderName as DatabaseProviderName, SourceScope } from "@prisma/client";
import { getFixtureStories } from "@/data/fixture-news";
import { clusterArticlesHybridIncremental } from "./cluster";
import { queryRelevantArticles, type QueryRejectionReason } from "./acceptance";
import { deduplicateArticles } from "./deduplicate";
import { logNews } from "./logger";
import { normalizeProviderArticles } from "./normalize";
import { createConfiguredProviders, fetchProviderArticlesGracefully } from "./providers";
import type { NewsProvider } from "./providers/provider";
import { newsPeriodHours } from "./periods";
import { queryStories } from "./query";
import { rankStories } from "./ranking";
import { buildCountryDiscoveryQuery } from "./countries/discovery";
import { MemoryLiveStateStore, type LiveStateStore } from "./live-state-store";
import { registrableDomain } from "./sources/domain";
import {
  canonicalSourceId,
  parseDomainlessSourceId,
  sourceSeedForSelection,
  sourceTargetsFromSelections,
} from "./sources/registry";
import type {
  NewsQuery,
  NormalizedArticle,
  CoverageDiagnostics,
  CoverageStatus,
  ProviderCoverageProgress,
  ProviderContinuationState,
  ProviderDiscoveryDiagnostics,
  ProviderHealthStatus,
  ProviderName,
  StoryCandidate,
  StoryView,
} from "./types";
import { canonicalizeArticleUrl } from "./url";

const LIVE_CACHE_TTL_MS = 60 * 60_000;
const MAX_LIVE_CACHE_ENTRIES = 40;
const DEFAULT_LIVE_BATCH_SIZE = 96;
const DEFAULT_LIVE_CORPUS_LIMITS: Record<NewsQuery["period"], number> = {
  "24h": 360,
  latest: 500,
  "7d": 750,
  "30d": 1_000,
};
const DEFAULT_LIVE_CORPUS_ABSOLUTE_MAX = 1_000;
const DEFAULT_LIVE_LOW_WATER = 24;
const DEFAULT_DATABASE_CANDIDATE_LIMIT = 1_000;
interface LiveCorpusState {
  id: string;
  articles: NormalizedArticle[];
  clusters: StoryCandidate[];
  stories: StoryView[];
  seenCanonicalUrls: Set<string>;
  providerStates: Map<ProviderName, ProviderContinuationState>;
  exhaustedProviders: Set<ProviderName>;
  providerCoverage: Map<ProviderName, ProviderCoverageProgress>;
  providerHealth: Map<ProviderName, ProviderHealthStatus>;
  providerRetryAfter: Map<ProviderName, number>;
  diagnostics: Map<ProviderName, ProviderDiscoveryDiagnostics>;
  rawArticleCount: number;
  normalizedArticleCount: number;
  relevantArticleCount: number;
  duplicateArticleCount: number;
  providers: NewsProvider[];
  corpusLimit: number;
  snapshotFrom: Date;
  snapshotTo: Date;
  generatedAt: number;
  expiresAt: number;
  discoveryPromise?: Promise<void>;
}

export interface LoadedNewsDataset {
  stories: StoryView[];
  dataSource: "database" | "live" | "hybrid" | "fixtures";
  articleCount: number;
  corpusComplete: boolean;
  discoveryExhausted: boolean;
  archiveCoverageComplete: boolean;
  coverageComplete: boolean;
  coverageDegraded: boolean;
  coverageStatus: CoverageStatus;
  coverageReasons: string[];
  corpusLimitReached: boolean;
  diagnostics?: CoverageDiagnostics;
  continuationId?: string;
  continuationReset?: boolean;
  notice?: string;
}

export interface DatabaseCoverageState {
  complete: boolean;
  archiveComplete: boolean;
  reasons: string[];
  checkpointCount: number;
}

let liveStateStore: LiveStateStore<LiveCorpusState> = new MemoryLiveStateStore<LiveCorpusState>();
let liveProviderFactory: (query: NewsQuery) => NewsProvider[] = (query) => createConfiguredProviders({
  period: query.period,
  countries: query.countries,
});

function enumValue<T extends string>(value: T): T {
  return value;
}

function databaseArticleAccessWhere(query: NewsQuery): Prisma.ArticleWhereInput | undefined {
  const filters: Prisma.ArticleWhereInput[] = [];

  if (query.sources.length > 0) {
    const sourcePredicates: Prisma.SourceWhereInput[] = query.sources.flatMap((selection): Prisma.SourceWhereInput[] => {
      const seed = sourceSeedForSelection(selection);
      if (seed) {
        return [
          { name: seed.name },
          { domain: { in: [...new Set([seed.domain, ...seed.alternateDomains].map(registrableDomain))] } },
        ];
      }
      if (selection.startsWith("domain:")) {
        return [{ domain: registrableDomain(selection.slice("domain:".length)) }];
      }
      const domainless = parseDomainlessSourceId(selection);
      if (domainless) {
        return [{
          domain: null,
          name: { equals: domainless.name, mode: "insensitive" },
          ...(domainless.countryCode ? { countryCode: domainless.countryCode } : {}),
        }];
      }
      return [{ name: selection }];
    });
    filters.push({ source: { is: { OR: sourcePredicates } } });
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
  const publicationWindow = {
    gte: new Date(now.getTime() - newsPeriodHours(query.period) * 3_600_000),
    lte: now,
  };
  const filters: Prisma.StoryWhereInput[] = [{
    articles: { some: { article: { publishedAt: publicationWindow } } },
  }, ...query.countries.map((countryCode) => ({
    countries: { some: { countryCode } },
  }))];
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

  return { AND: filters };
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
    take: databaseCandidateLimit(),
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
      provider: enumValue<DatabaseProviderName>(article.provider),
      providerArticleId: article.providerArticleId,
      title: article.title,
      description: article.description,
      url: article.url,
      canonicalUrl: article.canonicalUrl,
      imageUrl: article.imageUrl,
      publishedAt: article.publishedAt.toISOString(),
      language: article.language,
      source: {
        id: canonicalSourceId({
          name: article.source.name,
          domain: article.source.domain,
          countryCode: article.source.countryCode,
        }),
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

export async function loadDatabaseCoverage(
  query: NewsQuery,
  client?: PrismaClient,
  now = new Date(),
): Promise<DatabaseCoverageState> {
  const database = client ?? (await import("@/lib/db/prisma")).prisma;
  const windowStart = new Date(now.getTime() - newsPeriodHours(query.period) * 3_600_000);
  const freshnessMs = Math.max(15, Math.min(360, Number(process.env.NEWS_DATABASE_FRESHNESS_MINUTES ?? 120))) * 60_000;
  const countryCodes = query.countries.length > 0 ? query.countries : [null];
  const checkpoints = await database.providerIngestionCheckpoint.findMany({
    where: {
      countryCode: query.countries.length > 0 ? { in: query.countries } : null,
      status: "SUCCEEDED",
      lastSuccessfulAt: { gte: new Date(now.getTime() - freshnessMs) },
      windowStart: { lte: windowStart },
      windowEnd: { gte: new Date(now.getTime() - freshnessMs) },
    },
  });
  const historical = query.period === "7d" || query.period === "30d";
  const enabledProviders = [...new Set(createConfiguredProviders({
    period: query.period,
    countries: query.countries,
  }).map(({ name }) => name))];
  const providerComplete = (countryCode: string | null, provider: ProviderName): boolean =>
    checkpoints.some((checkpoint) =>
      checkpoint.countryCode === countryCode &&
      checkpoint.provider === provider &&
      (["GDELT", "NEWSAPI"].includes(provider)
        ? checkpoint.coverageComplete &&
          checkpoint.coveredFrom !== null && checkpoint.coveredFrom <= windowStart &&
          checkpoint.coveredTo !== null && checkpoint.coveredTo >= new Date(now.getTime() - freshnessMs)
        : checkpoint.exhausted)
    );
  const complete = checkpoints.length > 0 && countryCodes.every((code) =>
    enabledProviders.every((provider) => providerComplete(code, provider))
  );
  const archiveComplete = complete && (!historical || countryCodes.every((code) =>
    checkpoints.some((checkpoint) =>
      checkpoint.countryCode === code &&
      ["GDELT", "NEWSAPI"].includes(checkpoint.provider) &&
      checkpoint.coveredFrom !== null && checkpoint.coveredFrom <= windowStart &&
      checkpoint.coveredTo !== null && checkpoint.coveredTo >= new Date(now.getTime() - freshnessMs)
    )
  ));
  const reasons: string[] = [];
  if (!complete) reasons.push(checkpoints.length === 0 ? "DATABASE_COVERAGE_UNKNOWN" : "DATABASE_WINDOW_PARTIAL");
  if (historical && !archiveComplete) reasons.push("DATABASE_ARCHIVE_PARTIAL");
  return { complete: complete && (!historical || archiveComplete), archiveComplete, reasons, checkpointCount: checkpoints.length };
}

export function providerSearchQuery(query: NewsQuery): string | undefined {
  const countryQuery = buildCountryDiscoveryQuery(query.countries);
  const terms = countryQuery ? [countryQuery] : [];
  if (query.search) {
    const search = query.search.replace(/["\\]/g, " ").replace(/\s+/gu, " ").trim();
    if (search) terms.push(`"${search}"`);
  }
  if (terms.length === 0) return undefined;
  // Fetch a focused candidate pool and let queryStories enforce the final
  // country/search intersection against normalized article signals.
  return terms.join(" AND ");
}

export function databaseCandidateLimit(): number {
  const configured = Number(process.env.NEWS_DATABASE_CANDIDATE_LIMIT ?? DEFAULT_DATABASE_CANDIDATE_LIMIT);
  return Number.isFinite(configured)
    ? Math.max(300, Math.min(5_000, Math.floor(configured)))
    : DEFAULT_DATABASE_CANDIDATE_LIMIT;
}

export function liveBatchSize(): number {
  const configured = Number(
    process.env.NEWS_LIVE_BATCH_SIZE?.trim() ||
    process.env.NEWS_LIVE_ARTICLE_LIMIT?.trim() ||
    DEFAULT_LIVE_BATCH_SIZE,
  );
  return Number.isFinite(configured)
    ? Math.max(24, Math.min(150, Math.floor(configured)))
    : DEFAULT_LIVE_BATCH_SIZE;
}

export function liveCorpusLimit(period: NewsQuery["period"] = "latest"): number {
  const periodVariable = period === "24h"
    ? "NEWS_LIVE_CORPUS_LIMIT_24H"
    : period === "latest"
      ? "NEWS_LIVE_CORPUS_LIMIT_3D"
      : period === "7d"
        ? "NEWS_LIVE_CORPUS_LIMIT_7D"
        : "NEWS_LIVE_CORPUS_LIMIT_30D";
  const configuredPeriod = Number(process.env[periodVariable] ?? DEFAULT_LIVE_CORPUS_LIMITS[period]);
  const configuredAbsolute = Number(
    process.env.NEWS_LIVE_CORPUS_LIMIT ?? DEFAULT_LIVE_CORPUS_ABSOLUTE_MAX,
  );
  const periodLimit = Number.isFinite(configuredPeriod)
    ? Math.max(200, Math.min(2_000, Math.floor(configuredPeriod)))
    : DEFAULT_LIVE_CORPUS_LIMITS[period];
  const absoluteLimit = Number.isFinite(configuredAbsolute)
    ? Math.max(200, Math.min(2_000, Math.floor(configuredAbsolute)))
    : DEFAULT_LIVE_CORPUS_ABSOLUTE_MAX;
  return Math.min(periodLimit, absoluteLimit);
}

export function liveLowWaterMark(): number {
  const configured = Number(process.env.NEWS_LIVE_LOW_WATER ?? DEFAULT_LIVE_LOW_WATER);
  return Number.isFinite(configured)
    ? Math.max(12, Math.min(60, Math.floor(configured)))
    : DEFAULT_LIVE_LOW_WATER;
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

function terminalProviderFailure(code: string): boolean {
  if (code === "PROVIDER_LIMIT") return true;
  const status = Number(code.match(/^HTTP_(\d{3})$/)?.[1]);
  return Number.isInteger(status) &&
    status >= 400 &&
    status < 500 &&
    ![408, 409, 425, 429].includes(status);
}

function providerConfigurationFingerprint(): string {
  return createHash("sha256").update(JSON.stringify({
    newsApi: Boolean(process.env.NEWSAPI_KEY?.trim()),
    gdeltMode: process.env.GDELT_MODE?.toLowerCase() ?? process.env.GDELT_ENABLED?.toLowerCase() ?? "auto",
    rss: process.env.RSS_FEEDS_JSON ?? "default",
  })).digest("hex").slice(0, 16);
}

function liveCacheKey(query: NewsQuery): string {
  return JSON.stringify({
    countries: [...query.countries],
    sourcePerspective: query.sourcePerspective,
    sources: [...query.sources].sort(),
    topic: query.topic ?? null,
    language: query.language ?? null,
    period: query.period,
    sort: query.sort,
    search: query.search ?? null,
    providerConfiguration: providerConfigurationFingerprint(),
  });
}

function pruneLiveCaches(now = Date.now()): void {
  for (const [key, state] of liveStateStore.entries()) {
    if (state.expiresAt <= now) liveStateStore.delete(key);
  }
  while (liveStateStore.size() > MAX_LIVE_CACHE_ENTRIES) {
    const oldestKey = liveStateStore.entries().next().value?.[0];
    if (oldestKey === undefined) break;
    liveStateStore.delete(oldestKey);
  }
}

function toStoryView(story: StoryCandidate): StoryView {
  return {
    id: story.fingerprint,
    title: story.title,
    summary: story.summary,
    firstPublishedAt: story.firstPublishedAt,
    lastUpdatedAt: story.lastUpdatedAt,
    countries: story.countries,
    topics: story.topics,
    importanceScore: story.importanceScore,
    articles: story.articles,
  };
}

function clusterArticleKey(articles: NormalizedArticle[]): string {
  return articles.map(({ canonicalUrl }) => canonicalUrl).sort().join("\n");
}

function rankClusterCandidates(
  candidates: StoryCandidate[],
  query: NewsQuery,
): { clusters: StoryCandidate[]; stories: StoryView[] } {
  const byArticleKey = new Map(candidates.map((candidate) => [
    clusterArticleKey(candidate.articles),
    candidate,
  ]));
  const stories = rankStories(candidates.map(toStoryView), query);
  return {
    clusters: stories.map((story) => {
      const candidate = byArticleKey.get(clusterArticleKey(story.articles));
      if (!candidate) throw new Error("Ranked story did not resolve to its cluster");
      return candidate;
    }),
    stories,
  };
}

async function appendLiveClusters(
  state: LiveCorpusState,
  incomingArticles: NormalizedArticle[],
  query: NewsQuery,
): Promise<number> {
  const previousClusterCount = state.clusters.length;
  const previousStoryIds = state.stories.map(({ id }) => id);
  const incremental = await clusterArticlesHybridIncremental(
    state.clusters,
    incomingArticles,
  );

  if (previousClusterCount === 0) {
    const ranked = rankClusterCandidates(incremental.clusters, query);
    state.clusters = ranked.clusters;
    state.stories = ranked.stories;
    return incremental.comparedPairCount;
  }

  const retainedClusters = incremental.clusters.slice(0, previousClusterCount);
  const retainedStories = retainedClusters.map((candidate, index) => ({
    ...toStoryView(candidate),
    id: previousStoryIds[index] ?? candidate.fingerprint,
  }));
  const rankedAdditions = rankClusterCandidates(
    incremental.clusters.slice(previousClusterCount),
    query,
  );
  state.clusters = [...retainedClusters, ...rankedAdditions.clusters];
  state.stories = [...retainedStories, ...rankedAdditions.stories];
  return incremental.comparedPairCount;
}

function providerDiagnostics(state: LiveCorpusState, provider: ProviderName): ProviderDiscoveryDiagnostics {
  const existing = state.diagnostics.get(provider);
  if (existing) return existing;
  const created: ProviderDiscoveryDiagnostics = {
    provider,
    health: "active",
    received: 0,
    normalized: 0,
    accepted: 0,
    outOfWindow: 0,
    duplicates: 0,
    countryIrrelevant: 0,
    languageFiltered: 0,
    topicFiltered: 0,
    sourceFiltered: 0,
    searchFiltered: 0,
    plansAttempted: 0,
    plansCompleted: 0,
    markets: [],
    languages: [],
    countryQueries: [],
  };
  state.diagnostics.set(provider, created);
  return created;
}

function corpusLimitReached(state: LiveCorpusState): boolean {
  return state.articles.length >= state.corpusLimit;
}

function discoveryExhausted(state: LiveCorpusState): boolean {
  return state.providers.every((provider) => state.exhaustedProviders.has(provider.name));
}

function coverageAssessment(state: LiveCorpusState, query: NewsQuery): {
  archiveCoverageComplete: boolean;
  coverageComplete: boolean;
  coverageDegraded: boolean;
  coverageStatus: CoverageStatus;
  coverageReasons: string[];
} {
  const reasons: string[] = [];
  const archiveProviders = state.providers.filter(({ name }) => name === "GDELT" || name === "NEWSAPI");
  const archiveCoverageComplete = archiveProviders.length > 0 && archiveProviders.some(({ name }) =>
    state.providerCoverage.get(name)?.timeRangeCovered === true
  );
  const historicalPeriod = query.period === "7d" || query.period === "30d";
  const exhausted = discoveryExhausted(state);
  const limitReached = corpusLimitReached(state);
  if (limitReached) reasons.push("CORPUS_LIMIT_REACHED");
  if (historicalPeriod && archiveProviders.length === 0) reasons.push("NO_ARCHIVE_PROVIDER");
  else if (historicalPeriod && !archiveCoverageComplete) reasons.push("ARCHIVE_RANGE_PARTIAL");
  for (const [provider, health] of state.providerHealth) {
    if (["timeout", "rate_limited", "terminal_error", "partial"].includes(health)) {
      reasons.push(`PROVIDER_${provider}_${health.toUpperCase()}`);
    }
  }
  const failure = reasons.some((reason) => reason.startsWith("PROVIDER_"));
  const coverageComplete = exhausted && !limitReached && !failure &&
    (!historicalPeriod || archiveCoverageComplete);
  const coverageDegraded = failure || (historicalPeriod && !archiveCoverageComplete);
  const coverageStatus: CoverageStatus = coverageComplete
    ? "complete"
    : !exhausted && !limitReached
      ? "expanding"
      : coverageDegraded
        ? "degraded"
        : "limited";
  return {
    archiveCoverageComplete,
    coverageComplete,
    coverageDegraded,
    coverageStatus,
    coverageReasons: [...new Set(reasons)],
  };
}

function corpusComplete(state: LiveCorpusState): boolean {
  return corpusLimitReached(state) || discoveryExhausted(state);
}

function coverageDiagnostics(state: LiveCorpusState): CoverageDiagnostics {
  return {
    rawArticleCount: state.rawArticleCount,
    normalizedArticleCount: state.normalizedArticleCount,
    relevantArticleCount: state.relevantArticleCount,
    duplicateArticleCount: state.duplicateArticleCount,
    providerContributions: [...state.diagnostics.values()].sort((first, second) =>
      first.provider.localeCompare(second.provider)
    ),
  };
}

function matchingStoryCount(state: LiveCorpusState, query: NewsQuery): number {
  return queryStories(state.stories, { ...query, page: 1, pageSize: state.corpusLimit }, undefined, {
    preserveOrder: true,
  }).total;
}

function shouldDiscover(state: LiveCorpusState, query: NewsQuery): boolean {
  if (corpusComplete(state)) return false;
  const requestedEnd = query.page * query.pageSize;
  return matchingStoryCount(state, query) - requestedEnd <= liveLowWaterMark();
}

async function discoverLiveStage(
  state: LiveCorpusState,
  query: NewsQuery,
  searchQuery: string | undefined,
  sourceTargets: ReturnType<typeof sourceTargetsFromSelections>,
): Promise<void> {
  if (state.discoveryPromise) return state.discoveryPromise;
  const pending = (async () => {
    const activeProviders = state.providers.filter(
      (provider) =>
        !state.exhaustedProviders.has(provider.name) &&
        (state.providerRetryAfter.get(provider.name) ?? 0) <= Date.now(),
    );
    if (activeProviders.length === 0) return;
    const stageLimit = Math.min(liveBatchSize(), state.corpusLimit - state.articles.length);
    if (stageLimit <= 0) return;
    const perProviderLimit = Math.max(1, Math.ceil(stageLimit / activeProviders.length));
    const requestBase = {
      from: state.snapshotFrom,
      to: state.snapshotTo,
      countries: query.countries,
      language: query.language,
      sourcePerspective: query.sourcePerspective,
      period: query.period,
      sourceTargets,
      limit: perProviderLimit,
    };
    const results = await Promise.all(activeProviders.map(async (provider) => ({
      provider,
      result: await fetchProviderArticlesGracefully(
        [provider],
        searchQuery && provider.name !== "RSS"
          ? { ...requestBase, query: searchQuery, continuation: state.providerStates.get(provider.name) }
          : { ...requestBase, continuation: state.providerStates.get(provider.name) },
      ),
    })));

    for (const { provider, result } of results) {
      const failure = result.failures.find(({ provider: failedProvider }) => failedProvider === provider.name);
      if (failure) {
        const health: ProviderHealthStatus = failure.code === "HTTP_429"
          ? "rate_limited"
          : failure.code === "MISSING_CREDENTIAL"
            ? "missing_credential"
            : terminalProviderFailure(failure.code)
              ? "terminal_error"
              : failure.code === "REQUEST_FAILED"
                ? "timeout"
                : "partial";
        state.providerHealth.set(provider.name, health);
        state.providerRetryAfter.set(provider.name, Date.now() + 20_000);
        const metric = providerDiagnostics(state, provider.name);
        metric.health = health;
        if (failure.code === "PROVIDER_LIMIT") metric.exhaustionReason = "provider_limit";
        if (terminalProviderFailure(failure.code)) {
          state.exhaustedProviders.add(provider.name);
          logNews("warn", "live_provider_unavailable", {
            provider: provider.name,
            code: failure.code,
          });
        }
        continue;
      }
      const continuation = result.continuations[provider.name];
      state.providerRetryAfter.delete(provider.name);
      if (continuation) state.providerStates.set(provider.name, continuation);
      else state.providerStates.delete(provider.name);
      if (result.exhaustedProviders.includes(provider.name)) state.exhaustedProviders.add(provider.name);
      const coverage = result.providerCoverage[provider.name];
      if (coverage) state.providerCoverage.set(provider.name, coverage);
      const diagnostics = result.providerDiagnostics[provider.name];
      const providerMetric = providerDiagnostics(state, provider.name);
      providerMetric.health = result.exhaustedProviders.includes(provider.name) ? "exhausted" : "active";
      state.providerHealth.set(provider.name, providerMetric.health);
      providerMetric.received += diagnostics?.received ?? result.providerCounts[provider.name] ?? 0;
      providerMetric.plansAttempted += diagnostics?.plansAttempted ?? 0;
      providerMetric.plansCompleted = Math.max(providerMetric.plansCompleted, diagnostics?.plansCompleted ?? 0);
      providerMetric.outOfWindow += diagnostics?.outOfWindow ?? 0;
      providerMetric.markets = [...new Set([...providerMetric.markets, ...(diagnostics?.markets ?? [])])];
      providerMetric.languages = [...new Set([...providerMetric.languages, ...(diagnostics?.languages ?? [])])];
      providerMetric.countryQueries = [...new Set([
        ...providerMetric.countryQueries,
        ...(diagnostics?.countryQueries ?? []),
      ])].slice(0, 24);
      if (coverage) {
        providerMetric.archiveWindowStart = coverage.windowStart;
        providerMetric.archiveWindowEnd = coverage.windowEnd;
        providerMetric.archiveCoveredFrom = coverage.coveredFrom;
        providerMetric.exhaustionReason = coverage.exhaustionReason;
      }
      if (continuation?.page) {
        logNews("info", "live_provider_next_page", {
          provider: provider.name,
          live_provider_next_page: continuation.page,
        });
      }
    }

    const sampled = takeDiverseArticles(results.map(({ result }) => result.articles), stageLimit);
    state.rawArticleCount += results.reduce((total, { provider, result }) =>
      total + (result.providerDiagnostics[provider.name]?.received ?? result.providerCounts[provider.name] ?? 0),
    0);
    const unseen = sampled.filter((article) => {
      try {
        return !state.seenCanonicalUrls.has(canonicalizeArticleUrl(article.url));
      } catch {
        return true;
      }
    });
    const normalized = normalizeProviderArticles(unseen);
    state.normalizedArticleCount += normalized.length;
    for (const article of normalized) providerDiagnostics(state, article.provider).normalized += 1;
    const relevance = queryRelevantArticles(normalized, query, state.snapshotFrom, state.snapshotTo);
    for (const article of normalized) {
      const single = queryRelevantArticles([article], query, state.snapshotFrom, state.snapshotTo);
      const reason = (Object.entries(single.rejected) as Array<[QueryRejectionReason, number]>)
        .find(([, count]) => count > 0)?.[0];
      if (reason) {
        const metric = providerDiagnostics(state, article.provider);
        if (reason === "out_of_window") metric.outOfWindow += 1;
        else if (reason === "country_irrelevant") metric.countryIrrelevant += 1;
        else if (reason === "language_filtered") metric.languageFiltered += 1;
        else if (reason === "topic_filtered") metric.topicFiltered += 1;
        else if (reason === "source_filtered") metric.sourceFiltered += 1;
        else metric.searchFiltered += 1;
      }
    }
    const deduplicatedBatch = deduplicateArticles(relevance.accepted);
    const newArticles = deduplicatedBatch.articles
      .filter(({ canonicalUrl }) => !state.seenCanonicalUrls.has(canonicalUrl))
      .slice(0, state.corpusLimit - state.articles.length);
    const duplicateCount = deduplicatedBatch.duplicateCount +
      deduplicatedBatch.articles.length - newArticles.length;
    state.duplicateArticleCount += duplicateCount;
    for (const article of relevance.accepted) {
      const metric = providerDiagnostics(state, article.provider);
      if (newArticles.some(({ canonicalUrl }) => canonicalUrl === article.canonicalUrl)) metric.accepted += 1;
      else metric.duplicates += 1;
    }
    let comparedPairCount = 0;
    if (newArticles.length > 0) {
      state.articles.push(...newArticles);
      newArticles.forEach(({ canonicalUrl }) => state.seenCanonicalUrls.add(canonicalUrl));
      comparedPairCount = await appendLiveClusters(state, newArticles, query);
    }
    state.relevantArticleCount = state.articles.length;
    state.generatedAt = Date.now();
    state.expiresAt = Date.now() + LIVE_CACHE_TTL_MS;

    const receivedByProvider = Object.fromEntries(results.map(({ provider, result }) => [
      provider.name,
      result.providerCounts[provider.name] ?? 0,
    ]));
    const acceptedByProvider = Object.fromEntries(activeProviders.map((provider) => [
      provider.name,
      newArticles.filter((article) => article.provider === provider.name).length,
    ]));
    const coverage = coverageAssessment(state, query);
    logNews("info", "live_discovery_stage", {
      live_batch_size: sampled.length,
      live_corpus_article_count: state.articles.length,
      live_corpus_story_count: state.stories.length,
      live_corpus_complete: corpusComplete(state),
      discovery_exhausted: discoveryExhausted(state),
      coverage_complete: coverage.coverageComplete,
      coverage_status: coverage.coverageStatus,
      coverage_degraded_reason: coverage.coverageReasons,
      corpus_limit_reached: corpusLimitReached(state),
      live_provider_exhausted: [...state.exhaustedProviders].sort(),
      articles_received_by_provider: receivedByProvider,
      articles_accepted_by_provider: acceptedByProvider,
      articles_deduplicated: duplicateCount,
      provider_country_irrelevant: Object.fromEntries(
        [...state.diagnostics].map(([provider, metric]) => [provider, metric.countryIrrelevant]),
      ),
      clustering_pairs_compared: comparedPairCount,
      stories_clustered: state.stories.length,
    });
  })();
  state.discoveryPromise = pending;
  try {
    await pending;
  } finally {
    if (state.discoveryPromise === pending) state.discoveryPromise = undefined;
  }
}

async function loadLiveStories(query: NewsQuery): Promise<{
  stories: StoryView[];
  articleCount: number;
  corpusComplete: boolean;
  discoveryExhausted: boolean;
  archiveCoverageComplete: boolean;
  coverageComplete: boolean;
  coverageDegraded: boolean;
  coverageStatus: CoverageStatus;
  coverageReasons: string[];
  corpusLimitReached: boolean;
  diagnostics: CoverageDiagnostics;
  continuationId: string;
  continuationReset: boolean;
}> {
  const searchQuery = providerSearchQuery(query);
  const sourceTargets = sourceTargetsFromSelections(query.sources);
  const cacheKey = liveCacheKey(query);
  pruneLiveCaches();
  let state = liveStateStore.get(cacheKey);
  let continuationReset = false;
  if (state?.expiresAt && state.expiresAt <= Date.now()) {
    liveStateStore.delete(cacheKey);
    state = undefined;
  }

  try {
    if (!state) {
      if (liveStateStore.size() >= MAX_LIVE_CACHE_ENTRIES) {
        const oldestKey = liveStateStore.entries().next().value?.[0];
        if (oldestKey !== undefined) liveStateStore.delete(oldestKey);
      }
      const snapshotTo = new Date();
      const providers = liveProviderFactory(query);
      state = {
        id: createHash("sha256").update(`${cacheKey}|${snapshotTo.toISOString()}`).digest("hex").slice(0, 24),
        articles: [],
        clusters: [],
        stories: [],
        seenCanonicalUrls: new Set(),
        providerStates: new Map(),
        exhaustedProviders: new Set(),
        providerCoverage: new Map(),
        providerHealth: new Map(providers.map(({ name }) => [name, "active" as const])),
        providerRetryAfter: new Map(),
        diagnostics: new Map(),
        rawArticleCount: 0,
        normalizedArticleCount: 0,
        relevantArticleCount: 0,
        duplicateArticleCount: 0,
        providers,
        corpusLimit: liveCorpusLimit(query.period),
        snapshotFrom: new Date(snapshotTo.getTime() - newsPeriodHours(query.period) * 3_600_000),
        snapshotTo,
        generatedAt: snapshotTo.getTime(),
        expiresAt: snapshotTo.getTime() + LIVE_CACHE_TTL_MS,
      };
      liveStateStore.set(cacheKey, state);
      continuationReset = Boolean(query.continuationId || query.page > 1);
      logNews("info", "live_cache_miss", { live_cache_miss: true });
    } else {
      continuationReset = Boolean(query.continuationId && query.continuationId !== state.id);
      logNews("info", "live_cache_hit", { live_cache_hit: true });
    }
    if (state.stories.length === 0 || shouldDiscover(state, query)) {
      logNews("info", "live_prefetch_triggered", {
        live_prefetch_triggered: state.stories.length > 0,
        live_buffer_remaining: Math.max(0, matchingStoryCount(state, query) - query.page * query.pageSize),
      });
      await discoverLiveStage(state, query, searchQuery, sourceTargets);
    }
    const coverage = coverageAssessment(state, query);
    return {
      stories: state.stories,
      articleCount: state.articles.length,
      corpusComplete: corpusComplete(state),
      discoveryExhausted: discoveryExhausted(state),
      archiveCoverageComplete: coverage.archiveCoverageComplete,
      coverageComplete: coverage.coverageComplete,
      coverageDegraded: coverage.coverageDegraded,
      coverageStatus: coverage.coverageStatus,
      coverageReasons: coverage.coverageReasons,
      corpusLimitReached: corpusLimitReached(state),
      diagnostics: coverageDiagnostics(state),
      continuationId: state.id,
      continuationReset,
    };
  } catch (error) {
    logNews("warn", "live_news_fetch_failed", {
      code: error instanceof Error ? error.name : "UNEXPECTED_FAILURE",
    });
    const fallbackCoverage = state
      ? coverageAssessment(state, query)
      : {
          archiveCoverageComplete: false,
          coverageComplete: false,
          coverageDegraded: true,
          coverageStatus: "degraded" as const,
          coverageReasons: ["LIVE_DISCOVERY_FAILED"],
        };
    return {
      stories: state?.stories ?? [],
      articleCount: state?.articles.length ?? 0,
      corpusComplete: state ? corpusComplete(state) : false,
      discoveryExhausted: state ? discoveryExhausted(state) : false,
      archiveCoverageComplete: fallbackCoverage.archiveCoverageComplete,
      coverageComplete: fallbackCoverage.coverageComplete,
      coverageDegraded: fallbackCoverage.coverageDegraded,
      coverageStatus: fallbackCoverage.coverageStatus,
      coverageReasons: fallbackCoverage.coverageReasons,
      corpusLimitReached: state ? corpusLimitReached(state) : false,
      diagnostics: state ? coverageDiagnostics(state) : {
        rawArticleCount: 0,
        normalizedArticleCount: 0,
        relevantArticleCount: 0,
        duplicateArticleCount: 0,
        providerContributions: [],
      },
      continuationId: state?.id ?? "unavailable",
      continuationReset: Boolean(query.continuationId || query.page > 1),
    };
  }
}

async function liveDatasetOrFixtures(query: NewsQuery, notice: string): Promise<LoadedNewsDataset> {
  const live = await loadLiveStories(query);
  if (live.stories.length > 0) return { ...live, dataSource: "live" };
  if (process.env.NEWS_FIXTURES_ENABLED?.toLowerCase() === "true") {
    const stories = getFixtureStories();
    return {
      stories,
      dataSource: "fixtures",
      articleCount: new Set(stories.flatMap((story) => story.articles.map(({ id }) => id))).size,
      corpusComplete: true,
      discoveryExhausted: true,
      archiveCoverageComplete: false,
      coverageComplete: false,
      coverageDegraded: false,
      coverageStatus: "limited",
      coverageReasons: ["FIXTURE_DATA"],
      corpusLimitReached: false,
      notice,
    };
  }
  return {
    ...live,
    dataSource: "live",
    notice: "Live providers did not return usable coverage for this request.",
  };
}

function storedStoryCandidate(story: StoryView): StoryCandidate {
  return {
    fingerprint: story.id,
    title: story.title,
    summary: story.summary,
    firstPublishedAt: story.firstPublishedAt,
    lastUpdatedAt: story.lastUpdatedAt,
    countries: story.countries,
    topics: story.topics,
    importanceScore: story.importanceScore,
    clusterScore: 1,
    articles: story.articles as NormalizedArticle[],
  };
}

async function mergeDatabaseAndLiveStories(
  storedStories: StoryView[],
  liveStories: StoryView[],
): Promise<{ stories: StoryView[]; articleCount: number; duplicateCount: number }> {
  const storedCanonicalUrls = new Set(storedStories.flatMap(({ articles }) => articles.map(({ canonicalUrl }) => canonicalUrl)));
  const allLiveArticles = liveStories.flatMap(({ articles }) => articles as NormalizedArticle[]);
  const liveArticles = allLiveArticles
    .filter(({ canonicalUrl }) => !storedCanonicalUrls.has(canonicalUrl));
  const deduplicated = deduplicateArticles(liveArticles);
  const merged = await clusterArticlesHybridIncremental(
    storedStories.map(storedStoryCandidate),
    deduplicated.articles,
  );
  return {
    stories: merged.clusters.map(toStoryView),
    articleCount: storedCanonicalUrls.size + deduplicated.articles.length,
    duplicateCount: allLiveArticles.length - liveArticles.length + liveArticles.length - deduplicated.articles.length + deduplicated.duplicateCount,
  };
}

export async function buildCoverageAwareDataset(
  query: NewsQuery,
  stories: StoryView[],
  databaseCoverage: DatabaseCoverageState,
  liveLoader: (query: NewsQuery) => Promise<Omit<LoadedNewsDataset, "dataSource">> = loadLiveStories,
): Promise<LoadedNewsDataset> {
  const storedArticleCount = new Set(stories.flatMap((story) => story.articles.map(({ canonicalUrl }) => canonicalUrl))).size;
  if (stories.length > 0 && databaseCoverage.complete) return {
    stories,
    dataSource: "database",
    articleCount: storedArticleCount,
    corpusComplete: true,
    discoveryExhausted: true,
    archiveCoverageComplete: databaseCoverage.archiveComplete,
    coverageComplete: true,
    coverageDegraded: false,
    coverageStatus: "complete",
    coverageReasons: [],
    corpusLimitReached: false,
  };

  const live = await liveLoader(query);
  if (stories.length === 0) return {
    ...live,
    dataSource: "live",
    notice: "Stored coverage is incomplete; results are being discovered live.",
  };
  const merged = await mergeDatabaseAndLiveStories(stories, live.stories);
  const coverageComplete = databaseCoverage.complete || live.coverageComplete;
  const diagnostics = live.diagnostics ? {
    ...live.diagnostics,
    relevantArticleCount: merged.articleCount,
    duplicateArticleCount: live.diagnostics.duplicateArticleCount + merged.duplicateCount,
  } : undefined;
  return {
    ...live,
    stories: merged.stories,
    dataSource: "hybrid",
    articleCount: merged.articleCount,
    archiveCoverageComplete: databaseCoverage.archiveComplete || live.archiveCoverageComplete,
    coverageComplete,
    coverageDegraded: !coverageComplete && (live.coverageDegraded || databaseCoverage.reasons.length > 0),
    coverageStatus: coverageComplete ? "complete" : live.coverageStatus,
    coverageReasons: coverageComplete ? [] : [...new Set([...databaseCoverage.reasons, ...live.coverageReasons])],
    diagnostics,
    notice: "Stored coverage is incomplete, so live discovery is supplementing it.",
  };
}

export async function loadNewsDataset(query: NewsQuery): Promise<LoadedNewsDataset> {
  if (!process.env.DATABASE_URL) {
    return liveDatasetOrFixtures(
      query,
      "No live provider returned usable coverage.",
    );
  }
  try {
    const database = (await import("@/lib/db/prisma")).prisma;
    const [stories, databaseCoverage] = await Promise.all([
      loadDatabaseStories(query, database),
      loadDatabaseCoverage(query, database),
    ]);
    const dataset = await buildCoverageAwareDataset(query, stories, databaseCoverage);
    if (dataset.stories.length === 0) {
      return liveDatasetOrFixtures(query, "The news database and live providers returned no usable coverage.");
    }
    return dataset;
  } catch {
    logNews("error", "database_query_failed", { operation: "load_news_dataset" });
    return liveDatasetOrFixtures(
      query,
      "Live stored coverage is temporarily unavailable.",
    );
  }
}

export function resetLiveCorpusForTesting(): void {
  liveStateStore.clear();
}

export function setLiveProviderFactoryForTesting(factory?: (query: NewsQuery) => NewsProvider[]): void {
  liveProviderFactory = factory ?? ((query) => createConfiguredProviders({
    period: query.period,
    countries: query.countries,
  }));
  resetLiveCorpusForTesting();
}

export function setLiveStateStoreForTesting(store?: LiveStateStore<LiveCorpusState>): void {
  liveStateStore = store ?? new MemoryLiveStateStore<LiveCorpusState>();
  resetLiveCorpusForTesting();
}
