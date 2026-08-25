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

// These publisher-operated feeds expose headlines, excerpts, links, and images
// for feed readers. Full article text is never stored or reproduced.
export const DEFAULT_RSS_FEEDS: RssFeedConfig[] = [
  {
    name: "BBC News",
    feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
    websiteUrl: "https://www.bbc.com/news/world",
    countryCode: "GB",
    region: null,
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    name: "The Guardian",
    feedUrl: "https://www.theguardian.com/world/rss",
    websiteUrl: "https://www.theguardian.com/world",
    countryCode: "GB",
    region: null,
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    name: "Al Jazeera",
    feedUrl: "https://www.aljazeera.com/xml/rss/all.xml",
    websiteUrl: "https://www.aljazeera.com/",
    countryCode: "QA",
    region: "Middle East",
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    name: "CNA",
    feedUrl: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml",
    websiteUrl: "https://www.channelnewsasia.com/",
    countryCode: "SG",
    region: "Asia",
    language: "en",
    scope: "INTERNATIONAL",
  },
];
