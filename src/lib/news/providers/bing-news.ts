import Parser from "rss-parser";
import {
  buildCountryDiscoveryQuery,
  discoveryProfilesForCountries,
  localPublisherTargetsForCountries,
  type ProviderLocale,
} from "../countries/discovery";
import { inferArticleLanguage } from "../language";
import { logNews } from "../logger";
import { publicationDateInRange, trustedPublicationDate } from "../publication-date";
import type { ProviderArticle, ProviderFetchRequest, ProviderFetchResult } from "../types";
import { fetchWithTimeout, type NewsProvider, ProviderError } from "./provider";

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_DISCOVERY_QUERIES = 18;
const DISCOVERY_PLANS_PER_STAGE = 2;

export interface BingDiscoveryPlan {
  id: string;
  stage: number;
  reason: "canonical" | "local-language" | "demonym" | "institution" | "location" | "topic" | "publisher" | "wire";
  query: string;
  market: string;
  language: string;
}

function uniqueLocales(locales: ProviderLocale[]): ProviderLocale[] {
  const unique = new Map<string, ProviderLocale>();
  for (const locale of locales) unique.set(`${locale.market}|${locale.language}`, locale);
  return [...unique.values()];
}

function bingLocales(request: ProviderFetchRequest): ProviderLocale[] {
  const profiles = discoveryProfilesForCountries(request.countries ?? []);
  const available = profiles.length > 0
    ? uniqueLocales(profiles.flatMap(({ discoveryLocales }) => discoveryLocales))
    : [{ market: "en-US", language: "en", role: "international" as const, fallback: true }];
  const requestedLanguage = request.language?.toLowerCase().split("-")[0];
  if (!requestedLanguage) return available.slice(0, 3);
  const matching = available.filter(({ language }) => language === requestedLanguage);
  return (matching.length > 0 ? matching : available.filter(({ language }) => language === "en")).slice(0, 2);
}

function topicTerms(language: string): string[] {
  const translated: Record<string, string[]> = {
    de: ["Politik Wirtschaft", "Technologie Gesellschaft", "Klima Verteidigung", "Verkehr Kultur Sport"],
    es: ["política negocios", "tecnología sociedad", "clima defensa", "transporte cultura deportes"],
    fr: ["politique économie", "technologie société", "climat défense", "transport culture sport"],
    it: ["politica economia", "tecnologia società", "clima difesa", "trasporti cultura sport"],
    ja: ["政治 経済", "技術 社会", "気候 防衛", "交通 文化 スポーツ"],
    ko: ["정치 경제", "기술 사회", "기후 국방", "교통 문화 스포츠"],
    pt: ["política negócios", "tecnologia sociedade", "clima defesa", "transporte cultura esportes"],
    zh: ["政治 经济", "科技 社会", "气候 国防", "交通 文化 体育"],
  };
  return translated[language] ?? [
    "politics business", "technology society", "climate defence", "transport culture sports",
  ];
}

function sourceFilter(targets: NonNullable<ProviderFetchRequest["sourceTargets"]>): string {
  const domains = [...new Set(targets.flatMap(({ domains }) => domains))].slice(0, 12);
  const names = [...new Set(targets.filter(({ domains }) => domains.length === 0).map(({ name }) => name))].slice(0, 6);
  const parts = [
    ...domains.map((domain) => `site:${domain}`),
    ...names.map((name) => `"${name.replace(/["\\]/g, " ")}"`),
  ];
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

export function buildBingDiscoveryPlans(
  query: string,
  request: ProviderFetchRequest = {},
): BingDiscoveryPlan[] {
  const locales = bingLocales(request);
  const plans: Omit<BingDiscoveryPlan, "id">[] = [];
  const targets = request.sourceTargets ?? [];
  if (targets.length > 0) {
    for (const locale of locales) {
      plans.push({
        stage: 1,
        reason: "publisher",
        market: locale.market,
        language: locale.language,
        query: `${query} ${sourceFilter(targets)}`,
      });
    }
  } else {
    const countryCodes = request.countries ?? [];
    const localQuery = buildCountryDiscoveryQuery(countryCodes, "local");
    const demonymQuery = buildCountryDiscoveryQuery(countryCodes, "demonym");
    const institutionQuery = buildCountryDiscoveryQuery(countryCodes, "institution");
    const locationQuery = buildCountryDiscoveryQuery(countryCodes, "location");
    const primaryLocale = locales.find(({ role }) => role === "international") ??
      locales.find(({ language }) => language === "en") ??
      locales[0] ?? { market: "en-US", language: "en" };
    plans.push({
      stage: 1,
      reason: "canonical",
      market: primaryLocale.market,
      language: primaryLocale.language,
      query,
    });
    const localLocale = locales.find((locale) =>
      locale.role === "local" && (locale.market !== primaryLocale.market || locale.language !== primaryLocale.language)
    ) ?? locales.find(({ role }) => role === "local");
    if (localQuery && localLocale) {
      plans.push({
        stage: 1,
        reason: "local-language",
        market: localLocale.market,
        language: localLocale.language,
        query: localQuery,
      });
    }
    if (demonymQuery) plans.push({ ...primaryLocale, stage: 2, reason: "demonym", query: demonymQuery });
    if (institutionQuery) plans.push({ ...primaryLocale, stage: 2, reason: "institution", query: institutionQuery });

    const localTargets = localPublisherTargetsForCountries(countryCodes);
    if (localTargets.length > 0 && request.sourcePerspective !== "international") {
      for (let offset = 0; offset < Math.min(localTargets.length, 8); offset += 3) {
        plans.push({
          ...primaryLocale,
          stage: 3,
          reason: "publisher",
          query: `${query} ${sourceFilter(localTargets.slice(offset, offset + 3))}`,
        });
      }
    }
    if (countryCodes.length > 0 && request.sourcePerspective !== "local") {
      plans.push(
        { market: "en-US", language: "en", stage: 3, reason: "wire", query: `${query} site:reuters.com` },
        { market: "en-US", language: "en", stage: 3, reason: "wire", query: `${query} site:apnews.com` },
      );
    }
    if (locationQuery) plans.push({ ...primaryLocale, stage: 4, reason: "location", query: locationQuery });
    locales.forEach((locale) => {
      topicTerms(locale.language).forEach((topics, index) => plans.push({
        stage: 4 + index,
        reason: "topic",
        market: locale.market,
        language: locale.language,
        query: `${locale.role === "local" && localQuery ? localQuery : query} ${topics}`,
      }));
    });
  }
  const unique = new Map<string, Omit<BingDiscoveryPlan, "id">>();
  for (const plan of plans) unique.set(`${plan.market}|${plan.query}`, plan);
  return [...unique.values()]
    .sort((first, second) => first.stage - second.stage)
    .slice(0, MAX_DISCOVERY_QUERIES)
    .map((plan, index) => ({ ...plan, id: `bing-${index}` }));
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
      diagnostics: { received: parsed.items.length },
    };
  }

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.search(
      request.query ?? buildCountryDiscoveryQuery(request.countries ?? []) ?? "world OR international",
      request,
    );
  }

  async search(query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    const discoveryPlans = buildBingDiscoveryPlans(query, request);
    const completedPlanIds = new Set(request.continuation?.completedPlanIds ?? []);
    const offset = Math.max(0, request.continuation?.offset ?? 0);
    if (completedPlanIds.size === 0 && offset > 0) {
      discoveryPlans.slice(0, offset).forEach(({ id }) => completedPlanIds.add(id));
    }
    const stagePlans = completedPlanIds.size > 0
      ? discoveryPlans.filter(({ id }) => !completedPlanIds.has(id)).slice(0, DISCOVERY_PLANS_PER_STAGE)
      : discoveryPlans.slice(offset, offset + DISCOVERY_PLANS_PER_STAGE);
    logNews("info", "bing_discovery_planned", {
      provider_source_targeted_query_count: request.sourceTargets?.length
        ? stagePlans.length
        : 0,
      discoveryQueryCount: stagePlans.length,
      discoveryPlanOffset: offset,
      markets: [...new Set(stagePlans.map(({ market }) => market))],
      languages: [...new Set(stagePlans.map(({ language }) => language))],
      reasons: [...new Set(stagePlans.map(({ reason }) => reason))],
    });
    if (stagePlans.length === 0) {
      return {
        provider: this.name,
        articles: [],
        receivedAt: new Date().toISOString(),
        continuation: null,
        exhausted: true,
        coverage: {
          archiveCapable: false,
          timeRangeCovered: false,
          exhaustionReason: "plan_exhausted",
        },
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
    stagePlans.forEach(({ id }) => completedPlanIds.add(id));
    const nextOffset = offset + stagePlans.length;
    const exhausted = discoveryPlans.every(({ id }) => completedPlanIds.has(id));
    return {
      provider: this.name,
      articles: [...unique.values()].slice(0, request.limit ?? 250),
      receivedAt: new Date().toISOString(),
      continuation: exhausted ? null : {
        offset: nextOffset,
        completedPlanIds: [...completedPlanIds],
      },
      exhausted,
      coverage: {
        archiveCapable: false,
        windowStart: request.from?.toISOString(),
        windowEnd: request.to?.toISOString(),
        timeRangeCovered: false,
        exhaustionReason: exhausted ? "plan_exhausted" : undefined,
      },
      diagnostics: {
        received: settled.reduce((total, result) =>
          total + (result.status === "fulfilled" ? result.value.diagnostics?.received ?? result.value.articles.length : 0),
        0),
        plansAttempted: stagePlans.length,
        plansCompleted: completedPlanIds.size,
        markets: [...new Set(stagePlans.map(({ market }) => market))],
        languages: [...new Set(stagePlans.map(({ language }) => language))],
        countryQueries: stagePlans.map(({ query: planQuery }) => planQuery),
      },
    };
  }
}
