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

export interface CountryReference {
  code: string;
  name: string;
  relevanceScore: number;
}

export interface SourceReference {
  id?: string;
  name: string;
  domain: string | null;
  countryCode: string | null;
  region: string | null;
  language: string | null;
  scope: SourceScope;
  qualityScore: number;
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
  search?: string;
  page: number;
  pageSize: number;
}

export interface NewsResponse {
  stories: StoryView[];
  meta: {
    selectedCountries: Array<{ code: string; name: string }>;
    total: number;
    page: number;
    pageSize: number;
    dataSource: "database" | "live" | "fixtures";
    sourceFacets: Array<{ name: string; storyCount: number }>;
    generatedAt: string;
    notice?: string;
  };
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
}

export interface ProviderFetchRequest {
  from?: Date;
  to?: Date;
  query?: string;
  countries?: string[];
  limit?: number;
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
