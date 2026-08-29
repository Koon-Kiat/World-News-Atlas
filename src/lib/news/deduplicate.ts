import type { NormalizedArticle } from "./types";

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "for", "from", "in", "of", "on", "the", "to", "with",
]);

export function headlineTokens(headline: string): Set<string> {
  return new Set(
    headline
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

export function tokenSimilarity(first: string, second: string): number {
  const a = headlineTokens(first);
  const b = headlineTokens(second);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function hasCountryOverlap(first: NormalizedArticle, second: NormalizedArticle): boolean {
  const secondCodes = new Set(second.countries.map((country) => country.code));
  return first.countries.some((country) => secondCodes.has(country.code));
}

export function deduplicateArticles(articles: NormalizedArticle[]): {
  articles: NormalizedArticle[];
  duplicateCount: number;
} {
  const unique: NormalizedArticle[] = [];
  const canonicalUrls = new Set<string>();

  for (const article of articles) {
    if (canonicalUrls.has(article.canonicalUrl)) continue;
    const duplicateHeadline = unique.some((candidate) => {
      const hoursApart =
        Math.abs(
          new Date(candidate.publishedAt).getTime() - new Date(article.publishedAt).getTime(),
        ) / 3_600_000;
      return (
        hoursApart <= 48 &&
        hasCountryOverlap(candidate, article) &&
        tokenSimilarity(candidate.title, article.title) >= 0.84
      );
    });
    if (duplicateHeadline) continue;
    canonicalUrls.add(article.canonicalUrl);
    unique.push(article);
  }

  return { articles: unique, duplicateCount: articles.length - unique.length };
}
