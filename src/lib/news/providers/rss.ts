import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import Parser from "rss-parser";
import type { RssFeedConfig } from "@/config/news-sources";
import { logNews } from "../logger";
import { publicationDateInRange, trustedPublicationDate } from "../publication-date";
import { registrableDomain } from "../sources/domain";
import { metadataExcerpt } from "../text";
import type { ProviderArticle, ProviderFetchRequest, ProviderFetchResult } from "../types";
import { type NewsProvider, ProviderError } from "./provider";

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const FEEDS_PER_STAGE = 4;
const REVIEWED_FEED_HOSTS = new Set([
  "feeds.bbci.co.uk",
  "www.theguardian.com",
  "www.aljazeera.com",
  "www.channelnewsasia.com",
  "www.japantimes.co.jp",
  "rss.dw.com",
  "www.euronews.com",
  "www.france24.com",
  "feeds.skynews.com",
  "feeds.npr.org",
  "news.web.nhk",
]);

interface RssMediaNode {
  $?: {
    url?: string;
    width?: string;
  };
}

interface RssMediaFields {
  contentEncoded?: string;
  id?: string;
  mediaContent?: RssMediaNode[];
  mediaThumbnail?: RssMediaNode[];
}

export function takeRoundRobin<T>(batches: T[][], limit: number): T[] {
  const selected: T[] = [];
  const maximum = Math.max(0, Math.floor(limit));
  for (let index = 0; selected.length < maximum; index += 1) {
    let added = false;
    for (const batch of batches) {
      if (index >= batch.length) continue;
      selected.push(batch[index]);
      added = true;
      if (selected.length >= maximum) break;
    }
    if (!added) break;
  }
  return selected;
}

function feedImage(item: Parser.Item & RssMediaFields): string | null {
  const mediaCandidates = [
    ...(item.mediaContent ?? []),
    ...(item.mediaThumbnail ?? []),
  ]
    .map((media) => ({
      url: media.$?.url,
      width: Number(media.$?.width ?? 0),
    }))
    .filter((candidate): candidate is { url: string; width: number } =>
      Boolean(candidate.url) && !/\/(?:no-image|placeholder)[^/]*\.(?:gif|jpe?g|png|webp)(?:\?|$)/i.test(candidate.url ?? ""),
    )
    .sort((first, second) => second.width - first.width);
  const encodedImage = item.contentEncoded?.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  const fallback = item.enclosure?.url ?? encodedImage ?? null;
  return mediaCandidates[0]?.url ?? (fallback && !/\/(?:no-image|placeholder)[^/]*\./i.test(fallback) ? fallback : null);
}

function rssDescription(item: Parser.Item & RssMediaFields): { value: string | null; truncated: boolean } {
  const preferred = item.contentSnippet ?? item.summary ?? item.content;
  if (preferred) return metadataExcerpt(preferred);
  return metadataExcerpt(item.contentEncoded);
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  );
}

export async function assertTrustedFeedUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("RSS feeds must use credential-free HTTPS URLs");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("RSS feed host is not public");
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("RSS feed IP is not public");
  } else if (REVIEWED_FEED_HOSTS.has(host)) {
    return url;
  } else {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new Error("RSS feed host did not resolve to public addresses");
    }
  }
  return url;
}

async function fetchFeed(feedUrl: string, timeoutMs: number): Promise<string> {
  let current = await assertTrustedFeedUrl(feedUrl);
  for (let redirect = 0; redirect <= 2; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
          "User-Agent": "WorldNewsAtlas/1.0",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 2) throw new Error("RSS redirect could not be followed safely");
      current = await assertTrustedFeedUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`RSS feed returned HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_FEED_BYTES) throw new Error("RSS feed exceeds the size limit");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_FEED_BYTES) throw new Error("RSS feed exceeds the size limit");
    return new TextDecoder().decode(bytes);
  }
  throw new Error("RSS redirect limit exceeded");
}

export class RssProvider implements NewsProvider {
  readonly name = "RSS" as const;
  readonly capabilities = {
    latest: true,
    search: true,
    languages: true,
    sourceMetadata: true,
    requiresCredentials: false,
  } as const;
  private readonly parser = new Parser<Record<string, never>, RssMediaFields>({
    customFields: {
      item: [
        ["media:content", "mediaContent", { keepArray: true }],
        ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
        ["content:encoded", "contentEncoded"],
      ],
    },
  });

  constructor(
    private readonly feeds: RssFeedConfig[],
    private readonly timeoutMs = 8_000,
  ) {}

  async fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    const targets = request.sourceTargets ?? [];
    const targetedFeedIds = new Set(targets.map(({ id }) => id));
    const targetedDomains = new Set(targets.flatMap(({ domains }) => domains.map(registrableDomain)));
    const matchingFeeds = targets.length === 0
      ? this.feeds
      : this.feeds.filter((feed) => {
          const websiteDomain = registrableDomain(new URL(feed.websiteUrl).hostname);
          return targetedFeedIds.has(feed.sourceId) || targetedDomains.has(websiteDomain);
        });
    const offset = Math.max(0, request.continuation?.offset ?? 0);
    const feeds = matchingFeeds.slice(offset, offset + FEEDS_PER_STAGE);
    logNews("info", "rss_source_targeting", {
      provider_source_targeted_query_count: targets.length > 0 ? feeds.length : 0,
      feedOffset: offset,
      feedCount: feeds.length,
    });
    const settled = await Promise.allSettled(
      feeds.map(async (feed) => {
        const xml = await fetchFeed(feed.feedUrl, this.timeoutMs);
        const parsed = await this.parser.parseString(xml);
        let truncatedDescriptionCount = 0;
        const articles = parsed.items.flatMap<ProviderArticle>((item, index) => {
          const publishedAt = trustedPublicationDate([item.isoDate, item.pubDate]);
          if (!publishedAt || !publicationDateInRange(publishedAt, request.from, request.to)) {
            return [];
          }
          const description = rssDescription(item);
          if (description.truncated) truncatedDescriptionCount += 1;
          return [{
            provider: this.name,
            providerArticleId: item.guid ?? item.id ?? item.link ?? `${feed.feedUrl}#${index}`,
            title: item.title ?? "Untitled RSS item",
            description: description.value,
            url: item.link ?? feed.websiteUrl,
            imageUrl: feedImage(item),
            publishedAt,
            language: feed.language,
            sourceName: feed.name,
            sourceIdentifier: feed.feedUrl,
            sourceCountry: feed.countryCode,
            sourceScope: feed.scope,
            sourceRegion: feed.region,
            sourceMetadataOrigin: "rss-config",
            coverageCountries: feed.coverageCountries,
          }];
        });
        return { feed, articles, truncatedDescriptionCount };
      }),
    );
    const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const articleBatches = successful.map(({ articles }) => articles);
    const articles = takeRoundRobin(articleBatches, request.limit ?? 250);
    const articlesPerSource = new Map<string, number>();
    for (const { feed, articles: feedArticles } of successful) {
      articlesPerSource.set(
        feed.sourceId,
        (articlesPerSource.get(feed.sourceId) ?? 0) + feedArticles.length,
      );
    }
    logNews("info", "rss_fetch_complete", {
      rss_articles_per_source: Object.fromEntries([...articlesPerSource].sort()),
      rss_truncated_description_count: successful.reduce(
        (total, { truncatedDescriptionCount }) => total + truncatedDescriptionCount,
        0,
      ),
    });
    if (feeds.length > 0 && articles.length === 0 && settled.every((result) => result.status === "rejected")) {
      throw new ProviderError(this.name, "ALL_FEEDS_FAILED", "All configured RSS feeds failed");
    }
    const nextOffset = offset + feeds.length;
    const exhausted = nextOffset >= matchingFeeds.length;
    return {
      provider: this.name,
      articles,
      receivedAt: new Date().toISOString(),
      continuation: exhausted ? null : { offset: nextOffset },
      exhausted,
    };
  }

  async search(query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    const result = await this.fetchLatest(request);
    const quotedTerms = [...query.matchAll(/"([^"]+)"/g)].map((match) => match[1].toLowerCase());
    const terms = quotedTerms.length > 0
      ? quotedTerms
      : query.split(/\s+(?:and|or)\s+|\s+/i).map((term) => term.trim().toLowerCase()).filter(Boolean);
    const matchAnyTerm = /\s+OR\s+/i.test(query) && !/\s+AND\s+/i.test(query);
    return {
      ...result,
      articles: result.articles.filter((article) => {
        const haystack = `${article.title} ${article.description ?? ""}`.toLowerCase();
        return matchAnyTerm
          ? terms.some((term) => haystack.includes(term))
          : terms.every((term) => haystack.includes(term));
      }),
    };
  }
}
