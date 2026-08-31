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
    /** True only after provider discovery is exhausted or the corpus limit is reached. */
    corpusComplete: boolean;
    /** Internal continuation page used by the infinite-scroll client. */
    nextPage: number | null;
    page: number;
    pageSize: number;
    dataSource: "database" | "live" | "fixtures";
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
  from?: Date;
  to?: Date;
  query?: string;
  countries?: string[];
  language?: string;
  sourceTargets?: ProviderSourceTarget[];
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
  receivedAt: string;
  continuation?: ProviderContinuationState | null;
  exhausted?: boolean;
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
