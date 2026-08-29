import { createHash } from "node:crypto";
import { detectCountrySignals } from "./countries/detectCountries";
import { logNews } from "./logger";
import { resolveSourceDetailed } from "./sources/registry";
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
  const articleRef = createHash("sha256")
    .update(`${article.provider}:${article.providerArticleId}`)
    .digest("hex")
    .slice(0, 12);
  logNews("info", "source_country_resolved", {
    provider: article.provider,
    articleRef,
    method: resolvedSource.resolution.method,
    confidence: resolvedSource.resolution.confidence,
    countryCode: source.countryCode,
  });
  logNews("info", "country_detection_completed", {
    provider: article.provider,
    articleRef,
    countryCodes: countrySignals.map(({ code }) => code),
    methods: [...new Set(countrySignals.flatMap(({ methods }) => methods))],
  });
  const topics = detectTopics(title, description);

  return {
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
  };
}

export function normalizeProviderArticles(
  articles: ProviderArticle[],
  onRejected?: (error: Error, article: ProviderArticle) => void,
): NormalizedArticle[] {
  const normalized: NormalizedArticle[] = [];
  for (const article of articles) {
    try {
      normalized.push(normalizeProviderArticle(article));
    } catch (error) {
      onRejected?.(error instanceof Error ? error : new Error("Normalization failed"), article);
    }
  }
  return normalized;
}
