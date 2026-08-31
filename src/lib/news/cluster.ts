import { createHash } from "node:crypto";
import { MemoryTtlCache } from "./bounded-cache";
import { headlineTokens, tokenSimilarity } from "./deduplicate";
import { configuredTextEmbeddingProvider, type TextEmbeddingProvider } from "./embeddings";
import { logNews } from "./logger";
import type { CountryReference, NormalizedArticle, StoryCandidate } from "./types";

const CLUSTER_WINDOW_HOURS = 72;
const EMBEDDING_CACHE_TTL_MS = 24 * 60 * 60_000;
const embeddingCache = new MemoryTtlCache<number[]>(5_000);
const articleFeatureCache = new WeakMap<NormalizedArticle, {
  countries: Set<string>;
  entities: Set<string>;
  topics: Set<string>;
}>();

interface PairFeatures {
  semantic: number;
  entities: number;
  countries: number;
  lexical: number;
  topics: number;
  temporal: number;
  hybrid: number;
}

export interface HybridClusteringOptions {
  embeddingProvider?: TextEmbeddingProvider | null;
}

export interface IncrementalClusteringResult {
  clusters: StoryCandidate[];
  /** Pairs examined while attaching incoming articles; existing pairs are never revisited. */
  comparedPairCount: number;
}

function hoursBetween(first: NormalizedArticle, second: NormalizedArticle): number {
  return Math.abs(new Date(first.publishedAt).getTime() - new Date(second.publishedAt).getTime()) / 3_600_000;
}

function setSimilarity(first: Set<string>, second: Set<string>): number {
  if (first.size === 0 || second.size === 0) return 0;
  const intersection = [...first].filter((value) => second.has(value)).length;
  return intersection / new Set([...first, ...second]).size;
}

function articleCountries(article: NormalizedArticle): Set<string> {
  return new Set(article.countries.map(({ code }) => code));
}

function articleTopics(article: NormalizedArticle): Set<string> {
  return new Set(article.topics.filter((topic) => topic !== "world"));
}

function entityHints(article: NormalizedArticle): Set<string> {
  const text = `${article.title}\n${article.description ?? ""}`.normalize("NFKC");
  const countryNames = new Set(article.countries.map(({ name }) => name.toLocaleLowerCase("en")));
  const matches = [...text.matchAll(/(?:^|[^\p{L}\p{N}])([\p{Lu}][\p{L}\p{M}\p{N}'’-]{2,}(?:\s+[\p{Lu}][\p{L}\p{M}\p{N}'’-]{2,}){0,3})/gu)];
  return new Set(
    matches
      .map((match) => match[1].toLocaleLowerCase("en"))
      .filter((value) => !countryNames.has(value)),
  );
}

function articleFeatures(article: NormalizedArticle): {
  countries: Set<string>;
  entities: Set<string>;
  topics: Set<string>;
} {
  const cached = articleFeatureCache.get(article);
  if (cached) return cached;
  const features = {
    countries: articleCountries(article),
    entities: entityHints(article),
    topics: articleTopics(article),
  };
  articleFeatureCache.set(article, features);
  return features;
}

function candidateFeatures(first: NormalizedArticle, second: NormalizedArticle): Omit<PairFeatures, "semantic" | "hybrid"> {
  const hours = hoursBetween(first, second);
  const firstFeatures = articleFeatures(first);
  const secondFeatures = articleFeatures(second);
  return {
    entities: setSimilarity(firstFeatures.entities, secondFeatures.entities),
    countries: setSimilarity(firstFeatures.countries, secondFeatures.countries),
    lexical: tokenSimilarity(first.title, second.title),
    topics: setSimilarity(firstFeatures.topics, secondFeatures.topics),
    temporal: Math.max(0, 1 - hours / CLUSTER_WINDOW_HOURS),
  };
}

function isCheapCandidate(first: NormalizedArticle, second: NormalizedArticle): boolean {
  if (hoursBetween(first, second) > CLUSTER_WINDOW_HOURS) return false;
  const features = candidateFeatures(first, second);
  return features.countries > 0 || features.entities > 0 || features.topics > 0 || features.lexical >= 0.25;
}

function canClusterLexically(first: NormalizedArticle, second: NormalizedArticle): boolean {
  return (
    hoursBetween(first, second) <= CLUSTER_WINDOW_HOURS &&
    setSimilarity(articleCountries(first), articleCountries(second)) > 0 &&
    tokenSimilarity(first.title, second.title) >= 0.42
  );
}

function semanticInput(article: NormalizedArticle): string {
  return [
    article.title,
    article.description?.slice(0, 1_000) ?? "",
    `Countries: ${article.countries.map(({ code }) => code).sort().join(", ")}`,
    `Topics: ${[...article.topics].sort().join(", ")}`,
  ]
    .join("\n")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function semanticContentHash(article: NormalizedArticle): string {
  return createHash("sha256").update(semanticInput(article)).digest("hex");
}

function cosineSimilarity(first: number[], second: number[]): number {
  if (first.length === 0 || first.length !== second.length) return 0;
  let dot = 0;
  let firstMagnitude = 0;
  let secondMagnitude = 0;
  for (let index = 0; index < first.length; index += 1) {
    dot += first[index] * second[index];
    firstMagnitude += first[index] ** 2;
    secondMagnitude += second[index] ** 2;
  }
  if (firstMagnitude === 0 || secondMagnitude === 0) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(firstMagnitude * secondMagnitude)));
}

function hybridFeatures(
  first: NormalizedArticle,
  second: NormalizedArticle,
  firstEmbedding: number[],
  secondEmbedding: number[],
): PairFeatures {
  const cheap = candidateFeatures(first, second);
  const semantic = cosineSimilarity(firstEmbedding, secondEmbedding);
  const hybrid =
    semantic * 0.45 +
    cheap.entities * 0.18 +
    cheap.countries * 0.15 +
    cheap.lexical * 0.1 +
    cheap.topics * 0.05 +
    cheap.temporal * 0.07;
  return { semantic, ...cheap, hybrid };
}

function canClusterSemantically(features: PairFeatures): boolean {
  const support = Math.max(features.entities, features.countries, features.topics, features.lexical);
  return (
    (features.hybrid >= 0.58 && features.semantic >= 0.72 && support > 0) ||
    (features.lexical >= 0.62 && features.countries > 0 && features.semantic >= 0.45)
  );
}

async function embeddingsFor(
  articles: NormalizedArticle[],
  provider: TextEmbeddingProvider,
): Promise<{ vectors: Map<string, number[]>; cacheHits: number; computed: number }> {
  const vectors = new Map<string, number[]>();
  const missing: Array<{ article: NormalizedArticle; hash: string; text: string }> = [];
  let cacheHits = 0;
  for (const article of articles) {
    const hash = `${provider.id}:${semanticContentHash(article)}`;
    const cached = embeddingCache.get(hash);
    if (cached) {
      cacheHits += 1;
      vectors.set(article.canonicalUrl, cached);
    } else {
      missing.push({ article, hash, text: semanticInput(article) });
    }
  }
  if (missing.length > 0) {
    const embedded = await provider.embed(missing.map(({ text }) => text));
    if (embedded.length !== missing.length) throw new Error("Embedding count did not match the request");
    const dimension = embedded[0]?.length;
    if (!dimension || embedded.some((vector) => vector.length !== dimension || vector.some((value) => !Number.isFinite(value)))) {
      throw new Error("Embedding vectors were invalid");
    }
    embedded.forEach((vector, index) => {
      const item = missing[index];
      embeddingCache.set(item.hash, vector, EMBEDDING_CACHE_TTL_MS);
      vectors.set(item.article.canonicalUrl, vector);
    });
  }
  return { vectors, cacheHits, computed: missing.length };
}

function aggregateCountries(articles: NormalizedArticle[]): CountryReference[] {
  const countries = new Map<string, CountryReference>();
  for (const article of articles) {
    for (const country of article.countries) {
      const current = countries.get(country.code);
      if (!current || country.relevanceScore > current.relevanceScore) countries.set(country.code, country);
    }
  }
  return [...countries.values()].sort((first, second) => second.relevanceScore - first.relevanceScore);
}

function fingerprintFor(article: NormalizedArticle, countries: CountryReference[]): string {
  const tokens = [...headlineTokens(article.title)].sort().slice(0, 10).join("-");
  const codes = countries.map((country) => country.code).sort().join("-");
  return createHash("sha256").update(`${tokens}|${codes}`).digest("hex").slice(0, 32);
}

function pairKey(first: NormalizedArticle, second: NormalizedArticle): string {
  return [first.canonicalUrl, second.canonicalUrl].sort().join("|");
}

function toCandidate(articles: NormalizedArticle[], pairScores = new Map<string, number>()): StoryCandidate {
  const ordered = [...articles].sort(
    (first, second) =>
      second.importanceScore - first.importanceScore ||
      new Date(first.publishedAt).getTime() - new Date(second.publishedAt).getTime(),
  );
  const representative = ordered[0];
  const dates = articles.map((article) => new Date(article.publishedAt).getTime());
  const countries = aggregateCountries(articles);
  const scores = articles.slice(1).map((article) =>
    pairScores.get(pairKey(representative, article)) ?? tokenSimilarity(representative.title, article.title),
  );
  return {
    fingerprint: fingerprintFor(representative, countries),
    title: representative.title,
    summary: representative.description,
    firstPublishedAt: new Date(Math.min(...dates)).toISOString(),
    lastUpdatedAt: new Date(Math.max(...dates)).toISOString(),
    countries,
    topics: [...new Set(articles.flatMap((article) => article.topics))],
    importanceScore: Math.min(1, Math.max(...articles.map((article) => article.importanceScore)) + Math.min(0.18, articles.length * 0.04)),
    clusterScore: scores.length === 0 ? 1 : scores.reduce((sum, score) => sum + score, 0) / scores.length,
    articles,
  };
}

function buildClusters(
  articles: NormalizedArticle[],
  canCluster: (first: NormalizedArticle, second: NormalizedArticle) => boolean,
  pairScores?: Map<string, number>,
): StoryCandidate[] {
  const clusters: NormalizedArticle[][] = [];
  for (const article of articles) {
    const cluster = clusters.find((candidate) => candidate.some((existing) => canCluster(existing, article)));
    if (cluster) cluster.push(article);
    else clusters.push([article]);
  }
  return clusters.map((cluster) => toCandidate(cluster, pairScores));
}

function buildClustersIncrementally(
  existingClusters: StoryCandidate[],
  incomingArticles: NormalizedArticle[],
  canCluster: (first: NormalizedArticle, second: NormalizedArticle) => boolean,
  pairScores?: Map<string, number>,
): IncrementalClusteringResult {
  const clusters = existingClusters.map((cluster) => [...cluster.articles]);
  const touchedClusters = new Set<number>();
  let comparedPairCount = 0;

  for (const article of incomingArticles) {
    let matchingCluster = -1;
    for (let clusterIndex = 0; clusterIndex < clusters.length && matchingCluster < 0; clusterIndex += 1) {
      for (const existing of clusters[clusterIndex]) {
        comparedPairCount += 1;
        if (canCluster(existing, article)) {
          matchingCluster = clusterIndex;
          break;
        }
      }
    }
    if (matchingCluster >= 0) {
      clusters[matchingCluster].push(article);
      touchedClusters.add(matchingCluster);
    } else {
      clusters.push([article]);
      touchedClusters.add(clusters.length - 1);
    }
  }

  return {
    clusters: clusters.map((articles, index) =>
      index < existingClusters.length && !touchedClusters.has(index)
        ? existingClusters[index]
        : toCandidate(articles, pairScores)
    ),
    comparedPairCount,
  };
}

export function clusterArticles(articles: NormalizedArticle[]): StoryCandidate[] {
  return buildClusters(articles, canClusterLexically);
}

export async function clusterArticlesHybrid(
  articles: NormalizedArticle[],
  options: HybridClusteringOptions = {},
): Promise<StoryCandidate[]> {
  const provider = options.embeddingProvider === undefined
    ? configuredTextEmbeddingProvider()
    : options.embeddingProvider;
  if (!provider) {
    const fallback = clusterArticles(articles);
    logNews("info", "story_clustering_completed", {
      semanticEnabled: false,
      lexicalFallbackCount: articles.length,
      storyClusterCount: fallback.length,
    });
    return fallback;
  }

  const candidatePairs: Array<[NormalizedArticle, NormalizedArticle]> = [];
  const candidatesForEmbedding = new Map<string, NormalizedArticle>();
  for (let firstIndex = 0; firstIndex < articles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < articles.length; secondIndex += 1) {
      const first = articles[firstIndex];
      const second = articles[secondIndex];
      if (!isCheapCandidate(first, second)) continue;
      candidatePairs.push([first, second]);
      candidatesForEmbedding.set(first.canonicalUrl, first);
      candidatesForEmbedding.set(second.canonicalUrl, second);
    }
  }

  if (candidatePairs.length === 0) {
    const singles = articles.map((article) => toCandidate([article]));
    logNews("info", "story_clustering_completed", {
      semanticEnabled: true,
      embeddingProvider: provider.id,
      candidatePairCount: 0,
      lexicalFallbackCount: 0,
      storyClusterCount: singles.length,
    });
    return singles;
  }

  let embedded: Awaited<ReturnType<typeof embeddingsFor>>;
  try {
    embedded = await embeddingsFor([...candidatesForEmbedding.values()], provider);
  } catch (error) {
    const fallback = clusterArticles(articles);
    logNews("warn", "embedding_batch_failed", {
      embeddingProvider: provider.id,
      code: error instanceof Error ? error.name : "UNEXPECTED_FAILURE",
      lexicalFallbackCount: candidatePairs.length,
    });
    logNews("info", "story_clustering_completed", {
      semanticEnabled: false,
      lexicalFallbackCount: candidatePairs.length,
      storyClusterCount: fallback.length,
    });
    return fallback;
  }

  const pairScores = new Map<string, number>();
  const pairDecisions = new Map<string, boolean>();
  for (const [first, second] of candidatePairs) {
    const firstEmbedding = embedded.vectors.get(first.canonicalUrl);
    const secondEmbedding = embedded.vectors.get(second.canonicalUrl);
    if (!firstEmbedding || !secondEmbedding) continue;
    const features = hybridFeatures(first, second, firstEmbedding, secondEmbedding);
    const key = pairKey(first, second);
    pairScores.set(key, features.hybrid);
    pairDecisions.set(key, canClusterSemantically(features));
  }
  const clusters = buildClusters(
    articles,
    (first, second) => pairDecisions.get(pairKey(first, second)) ?? false,
    pairScores,
  );
  logNews("info", "story_clustering_completed", {
    semanticEnabled: true,
    embeddingProvider: provider.id,
    candidatePairCount: candidatePairs.length,
    embeddingCacheHits: embedded.cacheHits,
    embeddingsComputed: embedded.computed,
    lexicalFallbackCount: 0,
    storyClusterCount: clusters.length,
  });
  return clusters;
}

export async function clusterArticlesHybridIncremental(
  existingClusters: StoryCandidate[],
  incomingArticles: NormalizedArticle[],
  options: HybridClusteringOptions = {},
): Promise<IncrementalClusteringResult> {
  if (incomingArticles.length === 0) {
    return { clusters: existingClusters, comparedPairCount: 0 };
  }

  const provider = options.embeddingProvider === undefined
    ? configuredTextEmbeddingProvider()
    : options.embeddingProvider;
  if (!provider) {
    const incremental = buildClustersIncrementally(
      existingClusters,
      incomingArticles,
      canClusterLexically,
    );
    logNews("info", "story_clustering_completed", {
      semanticEnabled: false,
      incremental: true,
      existingStoryClusterCount: existingClusters.length,
      incomingArticleCount: incomingArticles.length,
      comparedPairCount: incremental.comparedPairCount,
      lexicalFallbackCount: incomingArticles.length,
      storyClusterCount: incremental.clusters.length,
    });
    return incremental;
  }

  const candidatePairs: Array<[NormalizedArticle, NormalizedArticle]> = [];
  const candidatesForEmbedding = new Map<string, NormalizedArticle>();
  const priorArticles = existingClusters.flatMap(({ articles }) => articles);
  let comparedPairCount = 0;
  for (const incoming of incomingArticles) {
    for (const prior of priorArticles) {
      comparedPairCount += 1;
      if (!isCheapCandidate(prior, incoming)) continue;
      candidatePairs.push([prior, incoming]);
      candidatesForEmbedding.set(prior.canonicalUrl, prior);
      candidatesForEmbedding.set(incoming.canonicalUrl, incoming);
    }
    priorArticles.push(incoming);
  }

  if (candidatePairs.length === 0) {
    const incremental = buildClustersIncrementally(
      existingClusters,
      incomingArticles,
      () => false,
    );
    logNews("info", "story_clustering_completed", {
      semanticEnabled: true,
      embeddingProvider: provider.id,
      incremental: true,
      existingStoryClusterCount: existingClusters.length,
      incomingArticleCount: incomingArticles.length,
      comparedPairCount,
      candidatePairCount: 0,
      lexicalFallbackCount: 0,
      storyClusterCount: incremental.clusters.length,
    });
    return { clusters: incremental.clusters, comparedPairCount };
  }

  let embedded: Awaited<ReturnType<typeof embeddingsFor>>;
  try {
    embedded = await embeddingsFor([...candidatesForEmbedding.values()], provider);
  } catch (error) {
    const fallback = buildClustersIncrementally(
      existingClusters,
      incomingArticles,
      canClusterLexically,
    );
    logNews("warn", "embedding_batch_failed", {
      embeddingProvider: provider.id,
      code: error instanceof Error ? error.name : "UNEXPECTED_FAILURE",
      incremental: true,
      lexicalFallbackCount: candidatePairs.length,
    });
    logNews("info", "story_clustering_completed", {
      semanticEnabled: false,
      incremental: true,
      existingStoryClusterCount: existingClusters.length,
      incomingArticleCount: incomingArticles.length,
      comparedPairCount: fallback.comparedPairCount,
      lexicalFallbackCount: candidatePairs.length,
      storyClusterCount: fallback.clusters.length,
    });
    return fallback;
  }

  const pairScores = new Map<string, number>();
  const pairDecisions = new Map<string, boolean>();
  for (const [first, second] of candidatePairs) {
    const firstEmbedding = embedded.vectors.get(first.canonicalUrl);
    const secondEmbedding = embedded.vectors.get(second.canonicalUrl);
    if (!firstEmbedding || !secondEmbedding) continue;
    const features = hybridFeatures(first, second, firstEmbedding, secondEmbedding);
    const key = pairKey(first, second);
    pairScores.set(key, features.hybrid);
    pairDecisions.set(key, canClusterSemantically(features));
  }
  const incremental = buildClustersIncrementally(
    existingClusters,
    incomingArticles,
    (first, second) => pairDecisions.get(pairKey(first, second)) ?? false,
    pairScores,
  );
  logNews("info", "story_clustering_completed", {
    semanticEnabled: true,
    embeddingProvider: provider.id,
    incremental: true,
    existingStoryClusterCount: existingClusters.length,
    incomingArticleCount: incomingArticles.length,
    comparedPairCount,
    candidatePairCount: candidatePairs.length,
    embeddingCacheHits: embedded.cacheHits,
    embeddingsComputed: embedded.computed,
    lexicalFallbackCount: 0,
    storyClusterCount: incremental.clusters.length,
  });
  return { clusters: incremental.clusters, comparedPairCount };
}

export function resetEmbeddingCacheForTesting(): void {
  embeddingCache.clear();
}
