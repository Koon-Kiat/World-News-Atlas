import type { NewsResponse, StoryView } from "./types";

export function responseHasNextPage(response: NewsResponse): boolean {
  return response.meta.hasMore &&
    response.meta.nextPage !== null &&
    response.meta.nextPage >= 1 &&
    response.meta.nextPage <= 100;
}

export function mergeNextPage(
  currentStories: StoryView[],
  response: NewsResponse,
  expectedPage: number,
): { stories: StoryView[]; canFetchMore: boolean } {
  const knownIds = new Set(currentStories.map((story) => story.id));
  const additions = response.stories.filter((story) => !knownIds.has(story.id));
  return {
    stories: [...currentStories, ...additions],
    canFetchMore:
      response.meta.page === expectedPage &&
      responseHasNextPage(response),
  };
}

export function nextPageNumber(response: NewsResponse): number | null {
  if (!responseHasNextPage(response)) return null;
  return response.meta.nextPage;
}
