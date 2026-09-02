import { sourceMatchesSelection } from "./sources/registry";
import type { NewsQuery, NormalizedArticle } from "./types";

export type QueryRejectionReason =
  | "out_of_window"
  | "country_irrelevant"
  | "language_filtered"
  | "topic_filtered"
  | "source_filtered"
  | "search_filtered";

function perspectiveCountry(query: NewsQuery): string | null {
  if (query.sourcePerspective === "local" || query.sourcePerspective === "first-country") {
    return query.countries[0] ?? null;
  }
  if (query.sourcePerspective === "second-country") return query.countries[1] ?? null;
  return null;
}

function searchMatches(article: NormalizedArticle, search: string): boolean {
  const needle = search.toLocaleLowerCase("en");
  return [
    article.title,
    article.description ?? "",
    article.source.name,
    ...article.topics,
    ...article.countries.map(({ name }) => name),
  ].join(" ").toLocaleLowerCase("en").includes(needle);
}

export function articleRejectionReason(
  article: NormalizedArticle,
  query: NewsQuery,
  snapshotFrom: Date,
  snapshotTo: Date,
): QueryRejectionReason | null {
  const publishedAt = new Date(article.publishedAt).getTime();
  if (
    !Number.isFinite(publishedAt) ||
    publishedAt < snapshotFrom.getTime() ||
    publishedAt > snapshotTo.getTime()
  ) return "out_of_window";

  if (
    query.countries.length > 0 &&
    !query.countries.every((selectedCode) =>
      article.countries.some(({ code, relevanceScore }) =>
        code === selectedCode && relevanceScore >= 0.6
      )
    )
  ) return "country_irrelevant";

  if (query.language && article.language.toLocaleLowerCase() !== query.language.toLocaleLowerCase()) {
    return "language_filtered";
  }
  if (query.topic && !article.topics.includes(query.topic)) return "topic_filtered";
  if (
    query.sources.length > 0 &&
    !query.sources.some((selection) => sourceMatchesSelection(article.source, selection))
  ) return "source_filtered";

  const localCountry = perspectiveCountry(query);
  if (localCountry && article.source.countryCode !== localCountry) return "source_filtered";
  if (
    query.sourcePerspective === "international" &&
    query.countries.includes(article.source.countryCode ?? "")
  ) return "source_filtered";

  if (query.search && !searchMatches(article, query.search)) return "search_filtered";
  return null;
}

export function queryRelevantArticles(
  articles: NormalizedArticle[],
  query: NewsQuery,
  snapshotFrom: Date,
  snapshotTo: Date,
): {
  accepted: NormalizedArticle[];
  rejected: Record<QueryRejectionReason, number>;
} {
  const rejected: Record<QueryRejectionReason, number> = {
    out_of_window: 0,
    country_irrelevant: 0,
    language_filtered: 0,
    topic_filtered: 0,
    source_filtered: 0,
    search_filtered: 0,
  };
  const accepted = articles.filter((article) => {
    const reason = articleRejectionReason(article, query, snapshotFrom, snapshotTo);
    if (reason) rejected[reason] += 1;
    return reason === null;
  });
  return { accepted, rejected };
}
