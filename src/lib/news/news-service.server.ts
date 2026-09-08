import "server-only";
import { buildNewsResponse } from "./query";
import type { NewsQuery, NewsResponse } from "./types";
import { loadNewsDataset } from "./data-store";

export async function getNews(query: NewsQuery): Promise<NewsResponse> {
  const dataset = await loadNewsDataset(query, true);
  if (dataset.response) return dataset.response;
  const responseQuery = dataset.continuationReset ? { ...query, page: 1 } : query;
  return buildNewsResponse(
    dataset.stories,
    responseQuery,
    dataset.dataSource,
    dataset.notice ?? (dataset.continuationReset
      ? "Live coverage restarted because the previous continuation expired."
      : undefined),
    {
      articleCount: dataset.articleCount,
      corpusComplete: dataset.corpusComplete,
      discoveryExhausted: dataset.discoveryExhausted,
      archiveCoverageComplete: dataset.archiveCoverageComplete,
      coverageComplete: dataset.coverageComplete,
      coverageDegraded: dataset.coverageDegraded,
      coverageStatus: dataset.coverageStatus,
      coverageReasons: dataset.coverageReasons,
      corpusLimitReached: dataset.corpusLimitReached,
      diagnostics: dataset.diagnostics,
      continuationId: dataset.continuationId,
      continuationReset: dataset.continuationReset,
    },
  );
}
