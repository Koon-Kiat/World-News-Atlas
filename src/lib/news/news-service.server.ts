import "server-only";
import { buildNewsResponse } from "./query";
import type { NewsQuery, NewsResponse } from "./types";
import { loadNewsDataset } from "./data-store";

export async function getNews(query: NewsQuery): Promise<NewsResponse> {
  const dataset = await loadNewsDataset(query);
  return buildNewsResponse(
    dataset.stories,
    query,
    dataset.dataSource,
    dataset.notice,
    {
      articleCount: dataset.articleCount,
      corpusComplete: dataset.corpusComplete,
    },
  );
}
