import type { ProviderName, SourceScope } from "@/lib/news/types";

export interface SourceSeed {
  name: string;
  domain: string;
  countryCode: string | null;
  region: string | null;
  language: string | null;
  scope: SourceScope;
  qualityScore: number;
  providerIdentifiers: Partial<Record<ProviderName, string[]>>;
}

// This is a provider-independent identity registry, not a promise that any
// provider currently distributes every listed publisher.
export const KNOWN_SOURCE_SEEDS: SourceSeed[] = [
  {
    name: "BBC",
    domain: "bbc.com",
    countryCode: "GB",
    region: null,
    language: "en",
    scope: "INTERNATIONAL",
    qualityScore: 0.9,
    providerIdentifiers: { NEWSAPI: ["bbc-news"], GDELT: ["bbc.com"] },
  },
  {
    name: "Reuters",
    domain: "reuters.com",
    countryCode: "GB",
    region: null,
    language: "en",
    scope: "INTERNATIONAL",
    qualityScore: 0.92,
    providerIdentifiers: { GDELT: ["reuters.com"] },
  },
  {
    name: "Associated Press",
    domain: "apnews.com",
    countryCode: "US",
    region: null,
    language: "en",
    scope: "INTERNATIONAL",
    qualityScore: 0.92,
    providerIdentifiers: { GDELT: ["apnews.com"] },
  },
  {
    name: "NHK",
    domain: "nhk.or.jp",
    countryCode: "JP",
    region: null,
    language: "ja",
    scope: "NATIONAL",
    qualityScore: 0.88,
    providerIdentifiers: { GDELT: ["nhk.or.jp"] },
  },
  {
    name: "CNA",
    domain: "channelnewsasia.com",
    countryCode: "SG",
    region: null,
    language: "en",
    scope: "NATIONAL",
    qualityScore: 0.88,
    providerIdentifiers: { GDELT: ["channelnewsasia.com"] },
  },
  {
    name: "The Straits Times",
    domain: "straitstimes.com",
    countryCode: "SG",
    region: null,
    language: "en",
    scope: "NATIONAL",
    qualityScore: 0.84,
    providerIdentifiers: { GDELT: ["straitstimes.com"] },
  },
  {
    name: "The Japan Times",
    domain: "japantimes.co.jp",
    countryCode: "JP",
    region: null,
    language: "en",
    scope: "NATIONAL",
    qualityScore: 0.84,
    providerIdentifiers: { GDELT: ["japantimes.co.jp"] },
  },
];

export interface RssFeedConfig {
  name: string;
  feedUrl: string;
  websiteUrl: string;
  countryCode: string | null;
  region: string | null;
  language: string;
  scope: SourceScope;
}

// RSS feeds are supplied through RSS_FEEDS_JSON after an operator has reviewed
// usage rights. There are deliberately no unreviewed feeds enabled by default.
export const DEFAULT_RSS_FEEDS: RssFeedConfig[] = [];
