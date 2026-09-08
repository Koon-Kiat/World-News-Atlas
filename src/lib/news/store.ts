import type { IngestionStateStore } from "./ingestion-state";
import type { IngestionRequestStore } from "./ingestion-requests";
import type { NewsQuery, NewsResponse, StoryCandidate, StoryView } from "./types";

export interface DatabaseCoverageState {
  complete: boolean;
  archiveComplete: boolean;
  reasons: string[];
  checkpointCount: number;
}

export interface NewsStore extends IngestionStateStore {
  persistStoryCandidates(candidates: StoryCandidate[], beforeWrite?: () => Promise<void>): Promise<{ storedArticles: number; storiesUpdated: number }>;
  ingestionRequests: IngestionRequestStore;
  loadStories(query: NewsQuery, now?: Date): Promise<StoryView[]>;
  loadStoryPage?(query: NewsQuery, now?: Date): Promise<NewsResponse>;
  loadCoverage(query: NewsQuery, now?: Date): Promise<DatabaseCoverageState>;
  claimIngestionNonce(nonce: string, receivedAt: Date, expiresAt: Date): Promise<boolean>;
  deleteExpiredIngestionNonces(now: Date, limit?: number): Promise<number>;
}
