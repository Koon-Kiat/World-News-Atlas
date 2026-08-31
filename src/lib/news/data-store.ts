import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, ProviderName as DatabaseProviderName, SourceScope } from "@prisma/client";
import { getFixtureStories } from "@/data/fixture-news";
import { clusterArticlesHybrid } from "./cluster";
import { deduplicateArticles } from "./deduplicate";
import { logNews } from "./logger";
import { normalizeProviderArticles } from "./normalize";
import { createConfiguredProviders, fetchProviderArticlesGracefully } from "./providers";
import type { NewsProvider } from "./providers/provider";
import { newsPeriodHours } from "./periods";
import { queryStories } from "./query";
import { rankStories } from "./ranking";
import { getCountryName } from "./countries/metadata";
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
  ProviderContinuationState,
  ProviderName,
  StoryCandidate,
  StoryView,
} from "./types";
import { canonicalizeArticleUrl } from "./url";

const LIVE_CACHE_TTL_MS = 60 * 60_000;
const MAX_LIVE_CACHE_ENTRIES = 40;
const DEFAULT_LIVE_BATCH_SIZE = 96;
const DEFAULT_LIVE_CORPUS_LIMIT = 400;
const DEFAULT_LIVE_LOW_WATER = 24;
const DEFAULT_DATABASE_CANDIDATE_LIMIT = 1_000;
interface LiveCorpusState {
  articles: NormalizedArticle[];
  stories: StoryView[];
  seenCanonicalUrls: Set<string>;
  providerStates: Map<ProviderName, ProviderContinuationState>;
  exhaustedProviders: Set<ProviderName>;
  providers: NewsProvider[];
  generatedAt: number;
  expiresAt: number;
  discoveryPromise?: Promise<void>;
}

interface LoadedNewsDataset {
  stories: StoryView[];
  dataSource: "database" | "live" | "fixtures";
  articleCount: number;
  corpusComplete: boolean;
  notice?: string;
}

const liveCaches = new Map<string, LiveCorpusState>();
let liveProviderFactory: () => NewsProvider[] = createConfiguredProviders;
const PROVIDER_COUNTRY_NAMES: Record<string, string> = {
  CN: "China",
  GB: "United Kingdom",
  RU: "Russia",
  US: "US",
};
const PROVIDER_COUNTRY_ALIASES: Record<string, string[]> = {
  JP: ["Japan", "日本", "日本国"],
};

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
          name: { contains: domainless.name, mode: "insensitive" },
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

export function providerSearchQuery(query: NewsQuery): string | undefined {
  const countryGroups = query.countries.map((code) =>
    PROVIDER_COUNTRY_ALIASES[code] ?? [PROVIDER_COUNTRY_NAMES[code] ?? getCountryName(code)],
  );
  const terms = countryGroups.map((aliases) => `(${aliases
    .map((term) => term.replace(/["\\]/g, " ").replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(" OR ")})`);
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

export function liveCorpusLimit(): number {
  const configured = Number(process.env.NEWS_LIVE_CORPUS_LIMIT ?? DEFAULT_LIVE_CORPUS_LIMIT);
  return Number.isFinite(configured)
    ? Math.max(200, Math.min(1_000, Math.floor(configured)))
    : DEFAULT_LIVE_CORPUS_LIMIT;
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
  const status = Number(code.match(/^HTTP_(\d{3})$/)?.[1]);
  return Number.isInteger(status) &&
    status >= 400 &&
    status < 500 &&
    ![408, 409, 425, 429].includes(status);
}

function providerConfigurationFingerprint(): string {
  return createHash("sha256").update(JSON.stringify({
    newsApi: Boolean(process.env.NEWSAPI_KEY?.trim()),
    gdelt: process.env.GDELT_ENABLED?.toLowerCase() === "true",
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
  for (const [key, state] of liveCaches) {
    if (state.expiresAt <= now) liveCaches.delete(key);
  }
  while (liveCaches.size > MAX_LIVE_CACHE_ENTRIES) {
    const oldestKey = liveCaches.keys().next().value;
    if (oldestKey === undefined) break;
    liveCaches.delete(oldestKey);
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

function stableStoryExpansion(
  previous: StoryView[],
  candidates: StoryView[],
  query: NewsQuery,
): StoryView[] {
  if (previous.length === 0) return rankStories(candidates, query);
  const previousUrlSets = previous.map((story) => new Set(story.articles.map(({ canonicalUrl }) => canonicalUrl)));
  const matchedCandidates = new Set<number>();
  const matches = new Map<number, StoryView>();

  previous.forEach((oldStory, oldIndex) => {
    let bestIndex = -1;
    let bestOverlap = 0;
    candidates.forEach((candidate, candidateIndex) => {
      if (matchedCandidates.has(candidateIndex)) return;
      const overlap = candidate.articles.reduce(
        (count, article) => count + Number(previousUrlSets[oldIndex].has(article.canonicalUrl)),
        0,
      );
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = candidateIndex;
      }
    });
    if (bestIndex < 0) return;
    matchedCandidates.add(bestIndex);
    matches.set(oldIndex, { ...candidates[bestIndex], id: oldStory.id });
  });

  const retained = previous.flatMap((story, index) => matches.get(index) ?? [story]);
  const additions = rankStories(
    candidates.filter((_, index) => !matchedCandidates.has(index)),
    query,
  );
  return [...retained, ...additions];
}

function corpusComplete(state: LiveCorpusState): boolean {
  return state.articles.length >= liveCorpusLimit() ||
    state.providers.every((provider) => state.exhaustedProviders.has(provider.name));
}

function matchingStoryCount(state: LiveCorpusState, query: NewsQuery): number {
  return queryStories(state.stories, { ...query, page: 1, pageSize: liveCorpusLimit() }, undefined, {
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
      (provider) => !state.exhaustedProviders.has(provider.name),
    );
    if (activeProviders.length === 0) return;
    const stageLimit = Math.min(liveBatchSize(), liveCorpusLimit() - state.articles.length);
    if (stageLimit <= 0) return;
    const perProviderLimit = Math.max(1, Math.ceil(stageLimit / activeProviders.length));
    const requestBase = {
      from: new Date(Date.now() - newsPeriodHours(query.period) * 3_600_000),
      countries: query.countries,
      language: query.language,
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
      if (continuation) state.providerStates.set(provider.name, continuation);
      else state.providerStates.delete(provider.name);
      if (result.exhaustedProviders.includes(provider.name)) state.exhaustedProviders.add(provider.name);
      if (continuation?.page) {
        logNews("info", "live_provider_next_page", {
          provider: provider.name,
          live_provider_next_page: continuation.page,
        });
      }
    }

    const sampled = takeDiverseArticles(results.map(({ result }) => result.articles), stageLimit);
    const unseen = sampled.filter((article) => {
      try {
        return !state.seenCanonicalUrls.has(canonicalizeArticleUrl(article.url));
      } catch {
        return true;
      }
    });
    const normalized = normalizeProviderArticles(unseen);
    const beforeUrls = new Set(state.articles.map(({ canonicalUrl }) => canonicalUrl));
    let duplicateCount = 0;
    if (normalized.length > 0) {
      const deduplicated = deduplicateArticles([...state.articles, ...normalized]);
      duplicateCount = deduplicated.duplicateCount;
      state.articles = deduplicated.articles.slice(0, liveCorpusLimit());
      state.seenCanonicalUrls = new Set(state.articles.map(({ canonicalUrl }) => canonicalUrl));
      const clustered = (await clusterArticlesHybrid(state.articles)).map(toStoryView);
      state.stories = stableStoryExpansion(state.stories, clustered, query);
    }
    state.generatedAt = Date.now();
    state.expiresAt = Date.now() + LIVE_CACHE_TTL_MS;

    const receivedByProvider = Object.fromEntries(results.map(({ provider, result }) => [
      provider.name,
      result.providerCounts[provider.name] ?? 0,
    ]));
    const acceptedByProvider = Object.fromEntries(activeProviders.map((provider) => [
      provider.name,
      normalized.filter((article) =>
        article.provider === provider.name &&
        !beforeUrls.has(article.canonicalUrl) &&
        state.seenCanonicalUrls.has(article.canonicalUrl),
      ).length,
    ]));
    logNews("info", "live_discovery_stage", {
      live_batch_size: sampled.length,
      live_corpus_article_count: state.articles.length,
      live_corpus_story_count: state.stories.length,
      live_corpus_complete: corpusComplete(state),
      live_provider_exhausted: [...state.exhaustedProviders].sort(),
      articles_received_by_provider: receivedByProvider,
      articles_accepted_by_provider: acceptedByProvider,
      articles_deduplicated: duplicateCount,
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
}> {
  const searchQuery = providerSearchQuery(query);
  const sourceTargets = sourceTargetsFromSelections(query.sources);
  const cacheKey = liveCacheKey(query);
  pruneLiveCaches();
  let state = liveCaches.get(cacheKey);
  if (state?.expiresAt && state.expiresAt <= Date.now()) {
    liveCaches.delete(cacheKey);
    state = undefined;
  }

  try {
    if (!state) {
      if (liveCaches.size >= MAX_LIVE_CACHE_ENTRIES) {
        const oldestKey = liveCaches.keys().next().value;
        if (oldestKey !== undefined) liveCaches.delete(oldestKey);
      }
      state = {
        articles: [],
        stories: [],
        seenCanonicalUrls: new Set(),
        providerStates: new Map(),
        exhaustedProviders: new Set(),
        providers: liveProviderFactory(),
        generatedAt: Date.now(),
        expiresAt: Date.now() + LIVE_CACHE_TTL_MS,
      };
      liveCaches.set(cacheKey, state);
      logNews("info", "live_cache_miss", { live_cache_miss: true });
    } else {
      logNews("info", "live_cache_hit", { live_cache_hit: true });
    }
    if (state.stories.length === 0 || shouldDiscover(state, query)) {
      logNews("info", "live_prefetch_triggered", {
        live_prefetch_triggered: state.stories.length > 0,
        live_buffer_remaining: Math.max(0, matchingStoryCount(state, query) - query.page * query.pageSize),
      });
      await discoverLiveStage(state, query, searchQuery, sourceTargets);
    }
    return {
      stories: state.stories,
      articleCount: state.articles.length,
      corpusComplete: corpusComplete(state),
    };
  } catch (error) {
    logNews("warn", "live_news_fetch_failed", {
      code: error instanceof Error ? error.name : "UNEXPECTED_FAILURE",
    });
    return {
      stories: state?.stories ?? [],
      articleCount: state?.articles.length ?? 0,
      corpusComplete: state ? corpusComplete(state) : false,
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
      notice,
    };
  }
  return {
    stories: live.stories,
    dataSource: "live",
    articleCount: live.articleCount,
    corpusComplete: live.corpusComplete,
    notice: "Live providers did not return usable coverage for this request.",
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
    const stories = await loadDatabaseStories(query);
    if (stories.length > 0) return {
      stories,
      dataSource: "database",
      articleCount: new Set(stories.flatMap((story) => story.articles.map(({ id }) => id))).size,
      corpusComplete: true,
    };
    return liveDatasetOrFixtures(query, "The news database is empty.");
  } catch {
    logNews("error", "database_query_failed", { operation: "load_news_dataset" });
    return liveDatasetOrFixtures(
      query,
      "Live stored coverage is temporarily unavailable.",
    );
  }
}

export function resetLiveCorpusForTesting(): void {
  liveCaches.clear();
}

export function setLiveProviderFactoryForTesting(factory?: () => NewsProvider[]): void {
  liveProviderFactory = factory ?? createConfiguredProviders;
  resetLiveCorpusForTesting();
}
