import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import Parser from "rss-parser";
import type { RssFeedConfig } from "@/config/news-sources";
import { logNews } from "../logger";
import { publicationDateInRange, trustedPublicationDate } from "../publication-date";
import { registrableDomain } from "../sources/domain";
import { metadataExcerpt } from "../text";
import type { ProviderArticle, ProviderFetchRequest, ProviderFetchResult } from "../types";
import { branchFailures, rejectProviderResponse, throwBranchFailure, type NewsProvider, ProviderError } from "./provider";
import { boundedText } from "@/lib/bounded-stream";

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

async function fetchFeed(feedUrl: string, timeoutMs: number, parentSignal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
  let current: URL;
  try { current = await assertTrustedFeedUrl(feedUrl); }
  catch { throw new ProviderError("RSS", "INVALID_CONFIGURATION", "RSS feed URL is not trusted"); }
  for (let redirect = 0; redirect <= 2; redirect += 1) {
      const response = await fetch(current, {
        redirect: "manual",
        signal,
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
          "User-Agent": "WorldNewsAtlas/1.0",
        },
      });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirect === 2) throw new ProviderError("RSS", "INVALID_RESPONSE", "RSS redirect limit exceeded");
      try { current = await assertTrustedFeedUrl(new URL(location, current).toString()); }
      catch { throw new ProviderError("RSS", "INVALID_RESPONSE", "RSS redirect is not trusted"); }
      continue;
    }
    if (!response.ok) await rejectProviderResponse("RSS", response);
    try { return await boundedText(response.body, MAX_FEED_BYTES, signal); }
    catch { throw new ProviderError("RSS", signal.aborted ? "STAGE_TIMEOUT" : "RESPONSE_TOO_LARGE", "RSS feed body could not be accepted"); }
  }
  throw new ProviderError("RSS", "INVALID_RESPONSE", "RSS redirect limit exceeded");
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("RSS", signal.aborted ? "STAGE_TIMEOUT" : "REQUEST_FAILED", "RSS request failed");
  } finally { clearTimeout(timer); }
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
    const perspectiveIndex = request.sourcePerspective === "second-country" ? 1 : 0;
    const perspectiveCountry = ["local", "first-country", "second-country"].includes(request.sourcePerspective ?? "all")
      ? request.countries?.[perspectiveIndex]
      : null;
    const perspectiveFeeds = perspectiveCountry
      ? matchingFeeds.filter(({ countryCode }) => countryCode === perspectiveCountry)
      : request.sourcePerspective === "international" && request.countries?.length
        ? matchingFeeds.filter(({ countryCode }) => !countryCode || !request.countries?.includes(countryCode))
        : [...matchingFeeds].sort((first, second) => {
            const firstLocal = request.countries?.includes(first.countryCode ?? "") ? 1 : 0;
            const secondLocal = request.countries?.includes(second.countryCode ?? "") ? 1 : 0;
            return secondLocal - firstLocal;
          });
    const completedPlanIds = new Set(request.continuation?.completedPlanIds ?? []);
    const offset = Math.max(0, request.continuation?.offset ?? 0);
    if (completedPlanIds.size === 0 && offset > 0) {
      perspectiveFeeds.slice(0, offset).forEach(({ feedUrl }) => completedPlanIds.add(feedUrl));
    }
    const pendingFeeds = completedPlanIds.size > 0
      ? perspectiveFeeds.filter(({ feedUrl }) => !completedPlanIds.has(feedUrl))
      : perspectiveFeeds.slice(offset);
    const feeds = pendingFeeds.slice(0, FEEDS_PER_STAGE);
    logNews("info", "rss_source_targeting", {
      provider_source_targeted_query_count: targets.length > 0 ? feeds.length : 0,
      feedOffset: offset,
      feedCount: feeds.length,
    });
    const settled = await Promise.allSettled(
      feeds.map(async (feed) => {
        const xml = await fetchFeed(feed.feedUrl, this.timeoutMs, request.signal);
        let parsed;
        try { parsed = await this.parser.parseString(xml); }
        catch { throw new ProviderError(this.name, "INVALID_RESPONSE", "RSS response was not usable"); }
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
        return { feed, articles, rawCount: parsed.items.length, truncatedDescriptionCount };
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
      throwBranchFailure(this.name, settled);
    }
    successful.forEach(({ feed: { feedUrl } }) => completedPlanIds.add(feedUrl));
    const nextOffset = completedPlanIds.size;
    const exhausted = perspectiveFeeds.every(({ feedUrl }) => completedPlanIds.has(feedUrl));
    return {
      provider: this.name,
      articles,
      failures: branchFailures(this.name, settled),
      receivedAt: new Date().toISOString(),
      continuation: exhausted ? null : { offset: nextOffset, completedPlanIds: [...completedPlanIds] },
      exhausted,
      coverage: {
        archiveCapable: false,
        windowStart: request.from?.toISOString(),
        windowEnd: request.to?.toISOString(),
        timeRangeCovered: false,
        exhaustionReason: exhausted ? "feed_exhausted" : undefined,
      },
      diagnostics: {
        received: successful.reduce((total, { rawCount }) => total + rawCount, 0),
        plansAttempted: feeds.length,
        plansCompleted: completedPlanIds.size,
        languages: [...new Set(feeds.map(({ language }) => language))],
        countryQueries: [],
      },
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
