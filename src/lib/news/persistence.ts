import type { NewsStore } from "./store";
import type { StoryCandidate } from "./types";

export function persistStoryCandidates(
  candidates: StoryCandidate[],
  store: NewsStore,
): Promise<{ storedArticles: number; storiesUpdated: number }> {
  return store.persistStoryCandidates(candidates);
}
