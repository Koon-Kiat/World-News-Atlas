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
  sort: "newest" | "popular" = "popular",
): { stories: StoryView[]; canFetchMore: boolean } {
  const knownIds = new Set(currentStories.map((story) => story.id));
  const additions = response.stories.filter((story) => !knownIds.has(story.id));
  const stories = [...currentStories, ...additions];
  if (sort === "newest") {
    stories.sort((first, second) =>
      new Date(second.lastUpdatedAt).getTime() - new Date(first.lastUpdatedAt).getTime() ||
      first.id.localeCompare(second.id)
    );
  }
  return {
    stories,
    canFetchMore:
      response.meta.page === expectedPage &&
      responseHasNextPage(response),
  };
}

export function nextPageNumber(response: NewsResponse): number | null {
  if (!responseHasNextPage(response)) return null;
  return response.meta.nextPage;
}
