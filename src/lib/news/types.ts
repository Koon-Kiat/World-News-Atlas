export type ProviderName = "NEWSAPI" | "GDELT" | "RSS" | "FIXTURE" | "OTHER";

export type SourceScope =
  | "LOCAL"
  | "REGIONAL"
  | "NATIONAL"
  | "INTERNATIONAL";

export type SourcePerspective =
  | "all"
  | "local"
  | "international"
  | "first-country"
  | "second-country";

export type NewsPeriod = "latest" | "24h" | "7d" | "30d";

export type NewsSort = "newest" | "popular";

export type CoverageStatus = "complete" | "expanding" | "limited" | "degraded";
export type ProviderHealthStatus =
  | "active"
  | "disabled"
  | "missing_credential"
  | "timeout"
  | "rate_limited"
  | "terminal_error"
  | "exhausted"
  | "partial";

export type ProviderExhaustionReason =
  | "normal"
  | "empty"
  | "provider_limit"
  | "time_range_covered"
  | "plan_exhausted"
  | "feed_exhausted";

export interface ProviderCoverageProgress {
  archiveCapable: boolean;
  windowStart?: string;
  windowEnd?: string;
  coveredFrom?: string;
  coveredTo?: string;
  timeRangeCovered: boolean;
  exhaustionReason?: ProviderExhaustionReason;
}

export interface ProviderDiscoveryDiagnostics {
  provider: ProviderName;
  health: ProviderHealthStatus;
  received: number;
  normalized: number;
  accepted: number;
  outOfWindow: number;
  duplicates: number;
  countryIrrelevant: number;
  languageFiltered: number;
  topicFiltered: number;
  sourceFiltered: number;
  searchFiltered: number;
  plansAttempted: number;
  plansCompleted: number;
  markets: string[];
  languages: string[];
  countryQueries: string[];
  archiveWindowStart?: string;
  archiveWindowEnd?: string;
  archiveCoveredFrom?: string;
  exhaustionReason?: string;
}

export interface CoverageDiagnostics {
  rawArticleCount: number;
  normalizedArticleCount: number;
  relevantArticleCount: number;
  duplicateArticleCount: number;
  providerContributions: ProviderDiscoveryDiagnostics[];
}

export interface CountryReference {
  code: string;
  name: string;
  relevanceScore: number;
}

export interface SourceReference {
  id: string;
  name: string;
  domain: string | null;
  countryCode: string | null;
  region: string | null;
  language: string | null;
  scope: SourceScope;
  qualityScore: number;
}

export interface SourceFacet extends SourceReference {
  storyCount: number;
}

export interface LanguageFacet {
  code: string;
  label: string;
  storyCount: number;
}

export interface ProviderSourceTarget {
  id: string;
  name: string;
  domains: string[];
  providerIdentifiers: Partial<Record<ProviderName, string[]>>;
}

export interface ArticleView {
  id: string;
  provider: ProviderName;
  providerArticleId: string;
  title: string;
  description: string | null;
  url: string;
  canonicalUrl: string;
  imageUrl: string | null;
  publishedAt: string;
  language: string;
  source: SourceReference;
  countries: CountryReference[];
  topics: string[];
  importanceScore: number;
  relevanceScore: number;
  isFixture?: boolean;
}

export interface StoryView {
  id: string;
  title: string;
  summary: string | null;
  firstPublishedAt: string;
  lastUpdatedAt: string;
  countries: CountryReference[];
  topics: string[];
  importanceScore: number;
  articles: ArticleView[];
  rankScore?: number;
}

export interface NewsQuery {
  countries: string[];
  sourcePerspective: SourcePerspective;
  sources: string[];
  topic?: string;
  language?: string;
  period: NewsPeriod;
  sort: NewsSort;
  search?: string;
  page: number;
  pageSize: number;
  continuationId?: string;
}

export interface NewsResponse {
  stories: StoryView[];
  meta: {
    selectedCountries: Array<{ code: string; name: string }>;
    /** Currently materialized matching story clusters, not publisher articles. */
    total: number;
    /** Individual normalized publisher articles in the current corpus. */
    articleCount: number;
    /** Matching story clusters currently materialized before page slicing. */
    materializedStoryCount: number;
    /** Cached stories or provider discovery can still produce continuation. */
    hasMore: boolean;
    /** Compatibility field: provider discovery can no longer return another stage. */
    corpusComplete: boolean;
    /** All finite provider plans currently available to this corpus have ended. */
    discoveryExhausted: boolean;
    /** Configured archive discovery demonstrably covered the requested publication window. */
    archiveCoverageComplete: boolean;
    /** Requested coverage is fresh and complete according to provider/database watermarks. */
    coverageComplete: boolean;
    coverageDegraded: boolean;
    coverageStatus: CoverageStatus;
    coverageReasons: string[];
    corpusLimitReached: boolean;
    continuationId?: string;
    continuationReset?: boolean;
    diagnostics?: CoverageDiagnostics;
    /** Internal continuation page used by the infinite-scroll client. */
    nextPage: number | null;
    page: number;
    pageSize: number;
    dataSource: "database" | "live" | "hybrid" | "fixtures";
    sourceFacets: SourceFacet[];
    languageFacets: LanguageFacet[];
    generatedAt: string;
    notice?: string;
  };
}

export interface ProviderContinuationState {
  /** Page-based providers such as NewsAPI. */
  page?: number;
  /** Finite discovery-plan/feed offset used by Bing RSS and RSS. */
  offset?: number;
  /** Exclusive upper publication-time boundary used by GDELT windows. */
  before?: string;
  /**
   * Independent exclusive upper boundaries for providers that fan one logical
   * request out into multiple discovery queries. A null cursor marks only that
   * branch as exhausted; a missing branch remains retryable.
   */
  discoveryCursors?: Record<string, string | null>;
  /** Independent page positions for providers that fan out across time windows. */
  discoveryPages?: Record<string, number | null>;
  /** Deterministic Bing/RSS plan identifiers already attempted. */
  completedPlanIds?: string[];
  /** Provider-specific reason continuation ended before historical coverage completed. */
  exhaustionReason?: string;
}

export interface ProviderArticle {
  provider: ProviderName;
  providerArticleId: string;
  title: string;
  description?: string | null;
  url: string;
  imageUrl?: string | null;
  publishedAt: string;
  language?: string | null;
  sourceName: string;
  sourceIdentifier?: string | null;
  sourceCountry?: string | null;
  sourceScope?: SourceScope | null;
  sourceRegion?: string | null;
  sourceMetadataOrigin?: "provider" | "rss-config";
  coverageCountries?: string[];
  structuredCountryCodes?: string[];
  structuredLocations?: string[];
}

export interface ProviderFetchRequest {
  /** Cancels the whole stage, including pacing, metadata, redirects and bodies. */
  signal?: AbortSignal;
  from?: Date;
  to?: Date;
  query?: string;
  countries?: string[];
  language?: string;
  sourceTargets?: ProviderSourceTarget[];
  sourcePerspective?: SourcePerspective;
  period?: NewsPeriod;
  limit?: number;
  continuation?: ProviderContinuationState;
}

export interface ProviderCapabilities {
  latest: boolean;
  search: boolean;
  languages: boolean;
  sourceMetadata: boolean;
  requiresCredentials: boolean;
}

export interface ProviderFetchResult {
  provider: ProviderName;
  articles: ProviderArticle[];
  /** Partial branch failures remain visible alongside successful articles. */
  failures?: ProviderFailure[];
  receivedAt: string;
  continuation?: ProviderContinuationState | null;
  exhausted?: boolean;
  coverage?: ProviderCoverageProgress;
  diagnostics?: {
    received?: number;
    plansAttempted?: number;
    plansCompleted?: number;
    markets?: string[];
    languages?: string[];
    countryQueries?: string[];
    outOfWindow?: number;
  };
}

export interface ProviderFailure {
  provider: ProviderName;
  code: string;
  retryAfterMs?: number;
}

export interface NormalizedArticle extends ArticleView {
  sourceIdentifier?: string | null;
}

export interface StoryCandidate {
  fingerprint: string;
  title: string;
  summary: string | null;
  firstPublishedAt: string;
  lastUpdatedAt: string;
  countries: CountryReference[];
  topics: string[];
  importanceScore: number;
  clusterScore: number;
  articles: NormalizedArticle[];
}
