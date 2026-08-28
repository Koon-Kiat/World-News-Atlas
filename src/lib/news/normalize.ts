import { createHash } from "node:crypto";
import { detectCountries } from "./countries/detectCountries";
import { getCountryName, normalizeCountryCode } from "./countries/metadata";
import { resolveSource } from "./sources/registry";
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
  const description = article.description ? cleanProviderText(article.description) || null : null;
  const countries = detectCountries(title, description, articleUrlLocationText(article.url));
  for (const rawCode of article.coverageCountries ?? []) {
    const code = normalizeCountryCode(rawCode);
    if (!code) continue;
    const existing = countries.find((country) => country.code === code);
    if (existing) {
      existing.relevanceScore = Math.max(existing.relevanceScore, 0.9);
    } else {
      countries.push({ code, name: getCountryName(code), relevanceScore: 0.9 });
    }
  }
  countries.sort((first, second) => second.relevanceScore - first.relevanceScore);
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
