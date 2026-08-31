import Parser from "rss-parser";
import { inferArticleLanguage } from "../language";
import { logNews } from "../logger";
import { publicationDateInRange, trustedPublicationDate } from "../publication-date";
import type { ProviderArticle, ProviderFetchRequest, ProviderFetchResult } from "../types";
import { fetchWithTimeout, type NewsProvider, ProviderError } from "./provider";

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_DISCOVERY_QUERIES = 10;
const DISCOVERY_PLANS_PER_STAGE = 2;

export interface BingDiscoveryPlan {
  query: string;
  market: string;
  language: string;
}

function bingLocales(request: ProviderFetchRequest): Array<{ market: string; language: string }> {
  const language = request.language?.toLowerCase();
  if (language?.startsWith("ja")) return [{ market: "ja-JP", language: "ja" }];
  if (language?.startsWith("en")) return [{ market: "en-SG", language: "en" }];
  return request.countries?.includes("JP")
    ? [
        { market: "en-SG", language: "en" },
        { market: "ja-JP", language: "ja" },
      ]
    : [{ market: "en-SG", language: "en" }];
}

function queryForLanguage(query: string, language: string, request: ProviderFetchRequest): string {
  return language === "ja" && request.countries?.includes("JP")
    ? `(${query}) AND ("日本" OR "日本国")`
    : query;
}

export function buildBingDiscoveryPlans(
  query: string,
  request: ProviderFetchRequest = {},
): BingDiscoveryPlan[] {
  const locales = bingLocales(request);
  const plans: BingDiscoveryPlan[] = [];
  const targets = request.sourceTargets ?? [];
  if (targets.length > 0) {
    const domains = [...new Set(targets.flatMap(({ domains: values }) => values))].slice(0, 20);
    const publisherNames = [...new Set(targets.filter(({ domains: values }) => values.length === 0).map(({ name }) => name))];
    const domainFilter = domains.length === 1
      ? `site:${domains[0]}`
      : domains.length > 1
        ? `(${domains.map((domain) => `site:${domain}`).join(" OR ")})`
        : "";
    const nameFilter = publisherNames.length > 0
      ? `(${publisherNames.map((name) => `"${name.replace(/["\\]/g, " ")}"`).join(" OR ")})`
      : "";
    const sourceFilter = [domainFilter, nameFilter].filter(Boolean).join(" OR ");
    for (const locale of locales) {
      plans.push({
        ...locale,
        query: `${queryForLanguage(query, locale.language, request)} (${sourceFilter})`,
      });
    }
  } else {
    for (const locale of locales) {
      const base = queryForLanguage(query, locale.language, request);
      plans.push({ ...locale, query: base });
    }
    if (request.countries?.length) {
      plans.push(
        { market: "en-SG", language: "en", query: `${query} site:reuters.com` },
        { market: "en-SG", language: "en", query: `${query} site:apnews.com` },
      );
    }
    const topicSets = locales.map((locale) => ({
      locale,
      base: queryForLanguage(query, locale.language, request),
      topics: locale.language === "ja"
        ? ["政治", "経済", "技術", "社会"]
        : ["politics", "business", "technology", "society"],
    }));
    for (let index = 0; index < 4; index += 1) {
      for (const { locale, base, topics } of topicSets) {
        plans.push({ ...locale, query: `${base} ${topics[index]}` });
      }
    }
  }
  const unique = new Map<string, BingDiscoveryPlan>();
  for (const plan of plans) unique.set(`${plan.market}|${plan.query}`, plan);
  return [...unique.values()].slice(0, MAX_DISCOVERY_QUERIES);
}

interface BingNewsFields {
  newsSource?: string;
  newsImage?: string;
}

function originalArticleUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const redirect = new URL(value);
    const target = redirect.searchParams.get("url");
    if (!target) return null;
    const article = new URL(target);
    if (
      !["http:", "https:"].includes(article.protocol) ||
      article.username ||
      article.password ||
      !article.hostname ||
      article.hostname === "localhost"
    ) {
      return null;
    }
    return article.toString();
  } catch {
    return null;
  }
}

function secureImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!url.hostname.toLowerCase().endsWith("bing.com")) return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

export class BingNewsProvider implements NewsProvider {
  readonly name = "OTHER" as const;
  readonly capabilities = {
    latest: true,
    search: true,
    languages: true,
    sourceMetadata: true,
    requiresCredentials: false,
  } as const;
  private readonly parser = new Parser<Record<string, never>, BingNewsFields>({
    customFields: {
      item: [
        ["News:Source", "newsSource"],
        ["News:Image", "newsImage"],
      ],
    },
  });

  constructor(private readonly timeoutMs = 8_000) {}

  private async requestOnce(
    plan: BingDiscoveryPlan,
    request: ProviderFetchRequest = {},
  ): Promise<ProviderFetchResult> {
    const url = new URL("https://www.bing.com/news/search");
    url.searchParams.set("q", plan.query);
    url.searchParams.set("format", "rss");
    url.searchParams.set("mkt", plan.market);

    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          headers: {
            Accept: "application/rss+xml, application/xml, text/xml",
            "User-Agent": "WorldNewsAtlas/1.0",
          },
        },
        this.timeoutMs,
      );
    } catch {
      throw new ProviderError(this.name, "REQUEST_FAILED", "Bing News RSS request failed");
    }
    if (!response.ok) {
      throw new ProviderError(this.name, `HTTP_${response.status}`, "Bing News RSS returned an error");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_FEED_BYTES) {
      throw new ProviderError(this.name, "RESPONSE_TOO_LARGE", "Bing News RSS response was too large");
    }
    const xml = await response.text();
    if (new TextEncoder().encode(xml).byteLength > MAX_FEED_BYTES) {
      throw new ProviderError(this.name, "RESPONSE_TOO_LARGE", "Bing News RSS response was too large");
    }

    const parsed = await this.parser.parseString(xml);
    const articles = parsed.items.flatMap<ProviderArticle>((item, index) => {
      const articleUrl = originalArticleUrl(item.link);
      if (!articleUrl || !item.title) return [];
      const publishedAt = trustedPublicationDate([item.isoDate, item.pubDate]);
      if (!publishedAt || !publicationDateInRange(publishedAt, request.from, request.to)) return [];
      const inferredLanguage = inferArticleLanguage(null, item.title, item.contentSnippet);
      return [{
        provider: this.name,
        providerArticleId: item.guid ?? `${url}#${index}`,
        title: item.title,
        description: item.contentSnippet ?? null,
        url: articleUrl,
        imageUrl: secureImageUrl(item.newsImage),
        publishedAt,
        language: inferredLanguage === "und" ? plan.language : inferredLanguage,
        sourceName: item.newsSource?.trim() || new URL(articleUrl).hostname,
        sourceIdentifier: new URL(articleUrl).hostname,
      }];
    });

    return {
      provider: this.name,
      articles: articles.slice(0, request.limit ?? 100),
      receivedAt: new Date().toISOString(),
    };
  }

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.search(
      request.query ?? (request.countries?.includes("JP")
        ? '"Japan" OR "日本" OR "日本国"'
        : "world OR international"),
      request,
    );
  }

  async search(query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    const discoveryPlans = buildBingDiscoveryPlans(query, request);
    const offset = Math.max(0, request.continuation?.offset ?? 0);
    const stagePlans = discoveryPlans.slice(offset, offset + DISCOVERY_PLANS_PER_STAGE);
    logNews("info", "bing_discovery_planned", {
      provider_source_targeted_query_count: request.sourceTargets?.length
        ? stagePlans.length
        : 0,
      discoveryQueryCount: stagePlans.length,
      discoveryPlanOffset: offset,
      markets: [...new Set(stagePlans.map(({ market }) => market))],
    });
    if (stagePlans.length === 0) {
      return {
        provider: this.name,
        articles: [],
        receivedAt: new Date().toISOString(),
        continuation: null,
        exhausted: true,
      };
    }
    const settled = await Promise.allSettled(
      stagePlans.map((plan) => this.requestOnce(plan, request)),
    );
    const successful = settled.flatMap((result) => result.status === "fulfilled" ? result.value.articles : []);
    if (successful.length === 0 && settled.every((result) => result.status === "rejected")) {
      throw new ProviderError(this.name, "REQUEST_FAILED", "Bing News RSS discovery failed");
    }
    const unique = new Map<string, ProviderArticle>();
    for (const article of successful) unique.set(article.url, article);
    const nextOffset = offset + stagePlans.length;
    const exhausted = nextOffset >= discoveryPlans.length;
    return {
      provider: this.name,
      articles: [...unique.values()].slice(0, request.limit ?? 250),
      receivedAt: new Date().toISOString(),
      continuation: exhausted ? null : { offset: nextOffset },
      exhausted,
    };
  }
}
