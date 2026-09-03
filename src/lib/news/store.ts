import type { IngestionStateStore } from "./ingestion-state";
import type { NewsQuery, StoryCandidate, StoryView } from "./types";

export interface DatabaseCoverageState {
  complete: boolean;
  archiveComplete: boolean;
  reasons: string[];
  checkpointCount: number;
}

export interface NewsStore extends IngestionStateStore {
  persistStoryCandidates(candidates: StoryCandidate[]): Promise<{ storedArticles: number; storiesUpdated: number }>;
  loadStories(query: NewsQuery, now?: Date): Promise<StoryView[]>;
  loadCoverage(query: NewsQuery, now?: Date): Promise<DatabaseCoverageState>;
  claimIngestionNonce(nonce: string, receivedAt: Date, expiresAt: Date): Promise<boolean>;
  deleteExpiredIngestionNonces(now: Date, limit?: number): Promise<number>;
}
