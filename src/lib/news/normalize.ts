import { createHash } from "node:crypto";
import { detectCountries } from "./countries/detectCountries";
import { resolveSource } from "./sources/registry";
import { detectTopics } from "./topics";
import type { NormalizedArticle, ProviderArticle } from "./types";
import { canonicalizeArticleUrl, isSafeHttpUrl } from "./url";

function normalizeLanguage(value: string | null | undefined): string {
  const language = value?.trim().toLowerCase() ?? "und";
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(language) ? language : "und";
}

export function normalizeProviderArticle(article: ProviderArticle): NormalizedArticle {
  const title = article.title.replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Provider article has no title");
  const publishedAt = new Date(article.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) throw new Error("Provider article has an invalid date");

  const canonicalUrl = canonicalizeArticleUrl(article.url);
  const language = normalizeLanguage(article.language);
  const source = resolveSource({
    provider: article.provider,
    sourceName: article.sourceName,
    sourceIdentifier: article.sourceIdentifier,
    articleUrl: article.url,
    sourceCountry: article.sourceCountry,
    sourceScope: article.sourceScope,
    sourceRegion: article.sourceRegion,
    language,
  });
  const countries = detectCountries(title, article.description);
  const topics = detectTopics(title, article.description);

  return {
    id: createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 24),
    provider: article.provider,
    providerArticleId: article.providerArticleId,
    title,
    description: article.description?.replace(/\s+/g, " ").trim() || null,
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
