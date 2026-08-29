import { createHash } from "node:crypto";
import {
  detectCountrySignals,
  type CountryDetectionMethod,
} from "./countries/detectCountries";
import { logNews } from "./logger";
import { resolveSourceDetailed, type SourceResolutionMethod } from "./sources/registry";
import { detectTopics } from "./topics";
import type { NormalizedArticle, ProviderArticle } from "./types";
import { canonicalizeArticleUrl, isSafeHttpUrl } from "./url";

function normalizeLanguage(value: string | null | undefined): string {
  const language = value?.trim().toLowerCase() ?? "und";
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(language) ? language : "und";
}

function cleanProviderText(value: string): string {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

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
  const title = cleanProviderText(article.title);
  if (!title) throw new Error("Provider article has no title");
  const publishedAt = new Date(article.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) throw new Error("Provider article has an invalid date");

  const canonicalUrl = canonicalizeArticleUrl(article.url);
  const language = normalizeLanguage(article.language);
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
  const description = article.description ? cleanProviderText(article.description) || null : null;
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
  let missingCountryCount = 0;
  let unknownSourceCount = 0;
  for (const article of articles) {
    try {
      const result = normalizeProviderArticleWithTelemetry(article);
      normalized.push(result.article);
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
    sourceResolutionMethods: Object.fromEntries([...sourceMethodCounts].sort()),
    unknownSourceCount,
  });
  return normalized;
}
