import { createHash } from "node:crypto";
import { headlineTokens, tokenSimilarity } from "./deduplicate";
import type { CountryReference, NormalizedArticle, StoryCandidate } from "./types";

function countriesOverlap(first: NormalizedArticle, second: NormalizedArticle): boolean {
  const codes = new Set(second.countries.map((country) => country.code));
  return first.countries.some((country) => codes.has(country.code));
}

function canCluster(first: NormalizedArticle, second: NormalizedArticle): boolean {
  const hoursApart =
    Math.abs(new Date(first.publishedAt).getTime() - new Date(second.publishedAt).getTime()) /
    3_600_000;
  return (
    hoursApart <= 72 &&
    countriesOverlap(first, second) &&
    tokenSimilarity(first.title, second.title) >= 0.42
  );
}

function aggregateCountries(articles: NormalizedArticle[]): CountryReference[] {
  const countries = new Map<string, CountryReference>();
  for (const article of articles) {
    for (const country of article.countries) {
      const current = countries.get(country.code);
      if (!current || country.relevanceScore > current.relevanceScore) countries.set(country.code, country);
    }
  }
  return [...countries.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
}

function fingerprintFor(article: NormalizedArticle, countries: CountryReference[]): string {
  const tokens = [...headlineTokens(article.title)].sort().slice(0, 10).join("-");
  const codes = countries.map((country) => country.code).sort().join("-");
  return createHash("sha256").update(`${tokens}|${codes}`).digest("hex").slice(0, 32);
}

function toCandidate(articles: NormalizedArticle[]): StoryCandidate {
  const ordered = [...articles].sort(
    (a, b) =>
      b.importanceScore - a.importanceScore ||
      new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );
  const representative = ordered[0];
  const dates = articles.map((article) => new Date(article.publishedAt).getTime());
  const countries = aggregateCountries(articles);
  const pairScores = articles.slice(1).map((article) =>
    tokenSimilarity(representative.title, article.title),
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
    clusterScore:
      pairScores.length === 0
        ? 1
        : pairScores.reduce((sum, score) => sum + score, 0) / pairScores.length,
    articles,
  };
}

export function clusterArticles(articles: NormalizedArticle[]): StoryCandidate[] {
  const clusters: NormalizedArticle[][] = [];
  for (const article of articles) {
    const cluster = clusters.find((candidate) =>
      candidate.some((existing) => canCluster(existing, article)),
    );
    if (cluster) cluster.push(article);
    else clusters.push([article]);
  }
  return clusters.map(toCandidate);
}
