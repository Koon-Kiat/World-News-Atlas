import { createHash } from "node:crypto";
import {
  detectCountrySignals,
  type CountryDetectionMethod,
} from "./countries/detectCountries";
import { logNews } from "./logger";
import { inferArticleLanguage } from "./language";
import { resolveSourceDetailed, type SourceResolutionMethod } from "./sources/registry";
import { cleanMetadataText, metadataExcerpt } from "./text";
import { detectTopics } from "./topics";
import type { NormalizedArticle, ProviderArticle } from "./types";
import { canonicalizeArticleUrl, isSafeHttpUrl } from "./url";

function articleUrlLocationText(value: string): string {
  try {
    const url = new URL(value);
    return decodeURIComponent(`${url.pathname} ${url.search}`)
      .replace(/[-_+/=&?]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

export function normalizeProviderArticle(article: ProviderArticle): NormalizedArticle {
  return normalizeProviderArticleWithTelemetry(article).article;
}

interface NormalizedArticleWithTelemetry {
  article: NormalizedArticle;
  countryDetectionMethods: CountryDetectionMethod[];
  sourceResolutionMethod: SourceResolutionMethod;
}

function normalizeProviderArticleWithTelemetry(article: ProviderArticle): NormalizedArticleWithTelemetry {
  const title = cleanMetadataText(article.title);
  if (!title) throw new Error("Provider article has no title");
  const publishedAt = new Date(article.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) throw new Error("Provider article has an invalid date");

  const canonicalUrl = canonicalizeArticleUrl(article.url);
  const description = metadataExcerpt(article.description).value;
  const language = inferArticleLanguage(article.language, title, description);
  const resolvedSource = resolveSourceDetailed({
    provider: article.provider,
    sourceName: article.sourceName,
    sourceIdentifier: article.sourceIdentifier,
    articleUrl: article.url,
    sourceCountry: article.sourceCountry,
    sourceScope: article.sourceScope,
    sourceRegion: article.sourceRegion,
    language,
    metadataOrigin: article.sourceMetadataOrigin,
  });
  const source = resolvedSource.source;
  const countrySignals = detectCountrySignals({
    title,
    description,
    supplementalText: articleUrlLocationText(article.url),
    coverageCountries: article.coverageCountries,
    structuredCountryCodes: article.structuredCountryCodes,
    structuredLocations: article.structuredLocations,
  });
  const countries = countrySignals.map(({ code, name, relevanceScore }) => ({ code, name, relevanceScore }));
  const topics = detectTopics(title, description);

  return {
    countryDetectionMethods: [...new Set(countrySignals.flatMap(({ methods }) => methods))],
    sourceResolutionMethod: resolvedSource.resolution.method,
    article: {
      id: createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 24),
      provider: article.provider,
      providerArticleId: article.providerArticleId,
      title,
      description,
      url: article.url,
      canonicalUrl,
      imageUrl: isSafeHttpUrl(article.imageUrl) ? article.imageUrl : null,
      publishedAt: publishedAt.toISOString(),
      language,
      source,
      sourceIdentifier: article.sourceIdentifier,
      countries,
      topics,
      importanceScore: 0.62,
      relevanceScore: countries[0]?.relevanceScore ?? 0.45,
    },
  };
}

export function normalizeProviderArticles(
  articles: ProviderArticle[],
  onRejected?: (error: Error, article: ProviderArticle) => void,
): NormalizedArticle[] {
  const normalized: NormalizedArticle[] = [];
  const countryMethodCounts = new Map<string, number>();
  const sourceMethodCounts = new Map<string, number>();
  const languageCounts = new Map<string, number>();
  const sourceCountryCounts = new Map<string, number>();
  let missingCountryCount = 0;
  let unknownSourceCount = 0;
  let jpLocalArticleCount = 0;
  for (const article of articles) {
    try {
      const result = normalizeProviderArticleWithTelemetry(article);
      normalized.push(result.article);
      languageCounts.set(
        result.article.language,
        (languageCounts.get(result.article.language) ?? 0) + 1,
      );
      const sourceCountry = result.article.source.countryCode ?? "unknown";
      sourceCountryCounts.set(sourceCountry, (sourceCountryCounts.get(sourceCountry) ?? 0) + 1);
      if (
        result.article.language === "ja" &&
        result.article.source.countryCode === "JP" &&
        result.article.countries.some(({ code }) => code === "JP")
      ) jpLocalArticleCount += 1;
      sourceMethodCounts.set(
        result.sourceResolutionMethod,
        (sourceMethodCounts.get(result.sourceResolutionMethod) ?? 0) + 1,
      );
      for (const method of result.countryDetectionMethods) {
        countryMethodCounts.set(method, (countryMethodCounts.get(method) ?? 0) + 1);
      }
      if (result.article.countries.length === 0) missingCountryCount += 1;
      if (!result.article.source.countryCode) unknownSourceCount += 1;
    } catch (error) {
      onRejected?.(error instanceof Error ? error : new Error("Normalization failed"), article);
    }
  }
  logNews("info", "article_normalization_completed", {
    articleCount: normalized.length,
    countryDetectionMethods: Object.fromEntries([...countryMethodCounts].sort()),
    countryDetectionFallbackCount: countryMethodCounts.get("english_fallback") ?? 0,
    missingCountryCount,
    articles_by_language: Object.fromEntries([...languageCounts].sort()),
    articles_by_source_country: Object.fromEntries([...sourceCountryCounts].sort()),
    jp_local_article_count: jpLocalArticleCount,
    source_resolution_method: Object.fromEntries([...sourceMethodCounts].sort()),
    unknownSourceCount,
  });
  return normalized;
}
