import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import Parser from "rss-parser";
import type { RssFeedConfig } from "@/config/news-sources";
import type { ProviderArticle, ProviderFetchRequest, ProviderFetchResult } from "../types";
import { type NewsProvider, ProviderError } from "./provider";

const MAX_FEED_BYTES = 2 * 1024 * 1024;
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
    const settled = await Promise.allSettled(
      this.feeds.map(async (feed) => {
        const xml = await fetchFeed(feed.feedUrl, this.timeoutMs);
        const parsed = await this.parser.parseString(xml);
        return parsed.items.map<ProviderArticle>((item, index) => ({
          provider: this.name,
          providerArticleId: item.guid ?? item.id ?? item.link ?? `${feed.feedUrl}#${index}`,
          title: item.title ?? "Untitled RSS item",
          description: item.contentSnippet ?? item.summary ?? null,
          url: item.link ?? feed.websiteUrl,
          imageUrl: feedImage(item),
          publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
          language: feed.language,
          sourceName: feed.name,
          sourceIdentifier: feed.feedUrl,
          sourceCountry: feed.countryCode,
          sourceScope: feed.scope,
          sourceRegion: feed.region,
          coverageCountries: feed.coverageCountries,
        }));
      }),
    );
    const articles = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    if (this.feeds.length > 0 && articles.length === 0 && settled.every((result) => result.status === "rejected")) {
      throw new ProviderError(this.name, "ALL_FEEDS_FAILED", "All configured RSS feeds failed");
    }
    return {
      provider: this.name,
      articles: articles.slice(0, request.limit ?? 250),
      receivedAt: new Date().toISOString(),
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
