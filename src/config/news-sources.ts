import sourceRegistry from "@/data/source-registry.json";
import type { ProviderName, SourceScope } from "@/lib/news/types";

export interface SourceSeed {
  id: string;
  name: string;
  domain: string;
  alternateDomains: string[];
  countryCode: string | null;
  region: string | null;
  language: string | null;
  scope: SourceScope;
  qualityScore: number;
  providerIdentifiers: Partial<Record<ProviderName, string[]>>;
}

// Publisher identity data is kept in a structured registry so it can grow
// independently from provider and RSS configuration code.
export const KNOWN_SOURCE_SEEDS: SourceSeed[] = (sourceRegistry as Array<{
  id: string;
  name: string;
  domain: string;
  alternateDomains?: string[];
  countryCode: string | null;
  region: string | null;
  language: string | null;
  scope: SourceScope;
  qualityScore: number;
  providerIdentifiers?: Partial<Record<ProviderName, string[]>>;
}>).map((source) => ({
  ...source,
  alternateDomains: source.alternateDomains ?? [],
  providerIdentifiers: source.providerIdentifiers ?? {},
}));

export interface RssFeedConfig {
  sourceId: string;
  name: string;
  feedUrl: string;
  websiteUrl: string;
  countryCode: string | null;
  region: string | null;
  language: string;
  scope: SourceScope;
  coverageCountries?: string[];
}

// These publisher-operated feeds expose headlines, excerpts, links, and images
// for feed readers. Full article text is never stored or reproduced.
export const DEFAULT_RSS_FEEDS: RssFeedConfig[] = [
  {
    sourceId: "bbc",
    name: "BBC News",
    feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
    websiteUrl: "https://www.bbc.com/news/world",
    countryCode: "GB",
    region: null,
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    sourceId: "guardian",
    name: "The Guardian",
    feedUrl: "https://www.theguardian.com/world/rss",
    websiteUrl: "https://www.theguardian.com/world",
    countryCode: "GB",
    region: null,
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    sourceId: "al-jazeera",
    name: "Al Jazeera",
    feedUrl: "https://www.aljazeera.com/xml/rss/all.xml",
    websiteUrl: "https://www.aljazeera.com/",
    countryCode: "QA",
    region: "Middle East",
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    sourceId: "cna",
    name: "CNA",
    feedUrl: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml",
    websiteUrl: "https://www.channelnewsasia.com/",
    countryCode: "SG",
    region: "Asia",
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    sourceId: "cna",
    name: "CNA",
    feedUrl: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416",
    websiteUrl: "https://www.channelnewsasia.com/singapore",
    countryCode: "SG",
    region: "Asia",
    language: "en",
    scope: "NATIONAL",
    coverageCountries: ["SG"],
  },
  {
    sourceId: "cna",
    name: "CNA",
    feedUrl: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511",
    websiteUrl: "https://www.channelnewsasia.com/asia",
    countryCode: "SG",
    region: "Asia",
    language: "en",
    scope: "REGIONAL",
  },
  {
    sourceId: "straits-times",
    name: "The Straits Times",
    feedUrl: "https://www.straitstimes.com/news/singapore/rss.xml",
    websiteUrl: "https://www.straitstimes.com/singapore",
    countryCode: "SG",
    region: "Asia",
    language: "en",
    scope: "NATIONAL",
    coverageCountries: ["SG"],
  },
  {
    sourceId: "straits-times",
    name: "The Straits Times",
    feedUrl: "https://www.straitstimes.com/news/asia/rss.xml",
    websiteUrl: "https://www.straitstimes.com/asia",
    countryCode: "SG",
    region: "Asia",
    language: "en",
    scope: "REGIONAL",
  },
  {
    sourceId: "japan-times",
    name: "The Japan Times",
    feedUrl: "https://www.japantimes.co.jp/feed/",
    websiteUrl: "https://www.japantimes.co.jp/",
    countryCode: "JP",
    region: "Asia",
    language: "en",
    scope: "NATIONAL",
  },
  {
    sourceId: "nhk",
    name: "NHK",
    feedUrl: "https://news.web.nhk/n-data/conf/na/rss/cat0.xml",
    websiteUrl: "https://news.web.nhk/newsweb/",
    countryCode: "JP",
    region: "Asia",
    language: "ja",
    scope: "NATIONAL",
  },
  {
    sourceId: "dw",
    name: "DW",
    feedUrl: "https://rss.dw.com/rdf/rss-en-world",
    websiteUrl: "https://www.dw.com/en/",
    countryCode: "DE",
    region: "Europe",
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    sourceId: "euronews",
    name: "Euronews",
    feedUrl: "https://www.euronews.com/rss?level=theme&name=news",
    websiteUrl: "https://www.euronews.com/news/international",
    countryCode: "FR",
    region: "Europe",
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    sourceId: "france-24",
    name: "France 24",
    feedUrl: "https://www.france24.com/en/rss",
    websiteUrl: "https://www.france24.com/en/",
    countryCode: "FR",
    region: "Europe",
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    sourceId: "sky-news",
    name: "Sky News",
    feedUrl: "https://feeds.skynews.com/feeds/rss/world.xml",
    websiteUrl: "https://news.sky.com/world",
    countryCode: "GB",
    region: "Europe",
    language: "en",
    scope: "INTERNATIONAL",
  },
  {
    sourceId: "npr",
    name: "NPR",
    feedUrl: "https://feeds.npr.org/1004/rss.xml",
    websiteUrl: "https://www.npr.org/sections/world/",
    countryCode: "US",
    region: "North America",
    language: "en",
    scope: "INTERNATIONAL",
  },
];
