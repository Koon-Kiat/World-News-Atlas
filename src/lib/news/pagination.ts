import type { NewsResponse, StoryView } from "./types";

const MAX_NEWS_PAGE = 100;

function maximumPage(response: NewsResponse): number {
  return Math.min(
    MAX_NEWS_PAGE,
    Math.max(1, Math.ceil(response.meta.total / response.meta.pageSize)),
  );
}

export function responseHasNextPage(response: NewsResponse): boolean {
  return response.stories.length > 0 && response.meta.page < maximumPage(response);
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
      additions.length > 0 &&
      response.meta.page === expectedPage &&
      response.meta.page < maximumPage(response),
  };
}

export function nextPageNumber(response: NewsResponse): number | null {
  if (!responseHasNextPage(response)) return null;
  return response.meta.page + 1;
}
