import "server-only";
import { getConfiguredNewsStore } from "./configured-store";
import { buildNewsResponse } from "./query";
import type { NewsStore } from "./store";
import type { NewsQuery, NewsResponse } from "./types";

/** Stored data only: external discovery is never on the HTML critical path. */
export async function getInitialNews(
  query: NewsQuery,
  storeFactory: () => Promise<NewsStore | null> = getConfiguredNewsStore,
  timeoutMs = 1_200,
): Promise<NewsResponse | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stored = async () => {
    const store = await storeFactory();
    if (!store) return null;
    const now = new Date();
    const [response, coverage] = await Promise.all([
      store.loadStoryPage ? store.loadStoryPage(query, now)
        : store.loadStories(query, now).then((stories) => buildNewsResponse(stories, query, "database", undefined, {}, now)),
      store.loadCoverage(query, now),
    ]);
    if (!response.stories.length) return null;
    response.meta.coverageComplete = coverage.complete;
    response.meta.archiveCoverageComplete = coverage.archiveComplete;
    response.meta.coverageStatus = coverage.complete ? "complete" : "expanding";
    response.meta.coverageReasons = coverage.reasons;
    response.meta.corpusComplete = coverage.complete;
    response.meta.discoveryExhausted = coverage.complete;
    response.meta.hasMore ||= !coverage.complete;
    response.meta.nextPage ??= coverage.complete ? null : 1;
    return response;
  };
  try {
    return await Promise.race([
      stored(),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}
