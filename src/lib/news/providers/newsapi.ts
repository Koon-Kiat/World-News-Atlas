import { z } from "zod";
import { logNews } from "../logger";
import { publicationDateInRange, trustedPublicationDate } from "../publication-date";
import type { ProviderArticle, ProviderFetchRequest, ProviderFetchResult } from "../types";
import { historicalDiscoveryWindows } from "./historical-windows";
import { fetchWithTimeout, type NewsProvider, ProviderError } from "./provider";

const newsApiResponseSchema = z.object({
  status: z.string(),
  message: z.string().optional(),
  totalResults: z.number().int().nonnegative().optional(),
  articles: z
    .array(
      z.object({
        source: z.object({ id: z.string().nullable().optional(), name: z.string() }),
        title: z.string(),
        description: z.string().nullable().optional(),
        url: z.string(),
        urlToImage: z.string().nullable().optional(),
        publishedAt: z.string(),
      }),
    )
    .optional(),
});

const newsApiSourcesSchema = z.object({
  status: z.string(),
  sources: z
    .array(
      z.object({
        id: z.string(),
        country: z.string().regex(/^[a-z]{2}$/).optional(),
      }),
    )
    .default([]),
});

const NEWSAPI_LANGUAGES = new Set(["ar", "de", "en", "es", "fr", "he", "it", "nl", "no", "pt", "ru", "sv", "ud", "zh"]);
const NEWSAPI_RESULT_LIMIT = 100;
const NEWSAPI_BRANCHES_PER_STAGE = 3;

export class NewsApiProvider implements NewsProvider {
  readonly name = "NEWSAPI" as const;
  readonly capabilities = {
    latest: true,
    search: true,
    languages: true,
    sourceMetadata: true,
    requiresCredentials: true,
  } as const;
  private sourceCountriesCache?: { expiresAt: number; value: Map<string, string> };
  private sourceCountriesInFlight?: Promise<Map<string, string>>;

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 8_000,
  ) {
    if (!apiKey.trim()) throw new ProviderError(this.name, "MISSING_CREDENTIAL", "NewsAPI is disabled");
  }

  private async fetchSourceCountries(): Promise<Map<string, string>> {
    if (this.sourceCountriesCache && this.sourceCountriesCache.expiresAt > Date.now()) {
      return this.sourceCountriesCache.value;
    }
    if (this.sourceCountriesInFlight) return this.sourceCountriesInFlight;
    const pending = (async () => {
      try {
        const response = await fetchWithTimeout(
          "https://newsapi.org/v2/top-headlines/sources",
          { headers: { "X-Api-Key": this.apiKey, Accept: "application/json" } },
          this.timeoutMs,
        );
        if (!response.ok) return new Map<string, string>();
        const parsed = newsApiSourcesSchema.safeParse(await response.json());
        if (!parsed.success || parsed.data.status !== "ok") return new Map<string, string>();
        return new Map(
          parsed.data.sources.flatMap((source) =>
            source.country ? [[source.id, source.country.toUpperCase()] as const] : [],
          ),
        );
      } catch {
        return new Map<string, string>();
      }
    })();
    this.sourceCountriesInFlight = pending;
    try {
      const value = await pending;
      this.sourceCountriesCache = { value, expiresAt: Date.now() + 30 * 60_000 };
      return value;
    } finally {
      if (this.sourceCountriesInFlight === pending) this.sourceCountriesInFlight = undefined;
    }
  }

  private async requestOnce(
    query: string,
    request: ProviderFetchRequest = {},
  ): Promise<ProviderFetchResult> {
    const sourceCountries = await this.fetchSourceCountries();
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", query);
    url.searchParams.set("sortBy", "publishedAt");
    const pageSize = Math.min(100, request.limit ?? 100);
    const page = Math.max(1, request.continuation?.page ?? 1);
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("page", String(page));
    const selectedSourceIdentifiers = [...new Set((request.sourceTargets ?? []).flatMap(
      (target) => target.providerIdentifiers.NEWSAPI ?? [],
    ))];
    const perspectiveIndex = request.sourcePerspective === "second-country" ? 1 : 0;
    const perspectiveCountry = ["local", "first-country", "second-country"].includes(request.sourcePerspective ?? "all")
      ? request.countries?.[perspectiveIndex]
      : undefined;
    const localSourceIdentifiers = perspectiveCountry
      ? [...sourceCountries].flatMap(([identifier, countryCode]) => countryCode === perspectiveCountry ? [identifier] : [])
      : [];
    const sourceIdentifiers = request.sourceTargets?.length
      ? selectedSourceIdentifiers
      : localSourceIdentifiers;
    const domains = [...new Set((request.sourceTargets ?? []).flatMap(({ domains: values }) => values))];
    if (sourceIdentifiers.length > 0) url.searchParams.set("sources", sourceIdentifiers.slice(0, 20).join(","));
    if (domains.length > 0) url.searchParams.set("domains", domains.slice(0, 20).join(","));
    const language = request.language?.toLowerCase().split("-")[0];
    if (language && NEWSAPI_LANGUAGES.has(language)) url.searchParams.set("language", language);
    if (request.from) url.searchParams.set("from", request.from.toISOString());
    if (request.to) url.searchParams.set("to", request.to.toISOString());

    logNews("info", "newsapi_discovery_planned", {
      provider_source_targeted_query_count: request.sourceTargets?.length ? 1 : 0,
      sourceIdentifierCount: sourceIdentifiers.length,
      domainCount: domains.length,
    });
    let response: Response;
    let retriedWithoutHostedDates = false;
    try {
      response = await fetchWithTimeout(
        url,
        { headers: { "X-Api-Key": this.apiKey, Accept: "application/json" } },
        this.timeoutMs,
      );
      if (response.status === 400 && (url.searchParams.has("from") || url.searchParams.has("to"))) {
        url.searchParams.delete("from");
        url.searchParams.delete("to");
        retriedWithoutHostedDates = true;
        response = await fetchWithTimeout(
          url,
          { headers: { "X-Api-Key": this.apiKey, Accept: "application/json" } },
          this.timeoutMs,
        );
      }
    } catch {
      throw new ProviderError(this.name, "REQUEST_FAILED", "NewsAPI request failed");
    }
    if (!response.ok) {
      if (response.status === 426) {
        throw new ProviderError(this.name, "PROVIDER_LIMIT", "NewsAPI plan result limit was reached");
      }
      throw new ProviderError(this.name, `HTTP_${response.status}`, "NewsAPI returned an error");
    }
    const parsed = newsApiResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.status !== "ok") {
      throw new ProviderError(this.name, "INVALID_RESPONSE", "NewsAPI response was not usable");
    }
    if (retriedWithoutHostedDates) {
      logNews("warn", "newsapi_hosted_date_filter_unavailable", {
        localPublicationWindowEnforced: true,
      });
    }

    const rawArticles = parsed.data.articles ?? [];
    let outOfWindow = 0;
    const datedArticles = rawArticles.map((article) => ({
      article,
      publishedAt: trustedPublicationDate([article.publishedAt]),
    }));
    const articles: ProviderArticle[] = datedArticles.flatMap(({ article, publishedAt }) => {
      if (!publishedAt || !publicationDateInRange(publishedAt, request.from, request.to)) {
        outOfWindow += 1;
        return [];
      }
      return [{
        provider: this.name,
        providerArticleId: article.url,
        title: article.title,
        description: article.description,
        url: article.url,
        imageUrl: article.urlToImage,
        publishedAt,
        sourceName: article.source.name,
        sourceIdentifier: article.source.id,
        sourceCountry: article.source.id ? sourceCountries.get(article.source.id) ?? null : null,
      }];
    });
    const oldestRaw = datedArticles.reduce<number | null>((current, { publishedAt }) => {
      if (!publishedAt) return current;
      const timestamp = new Date(publishedAt).getTime();
      return current === null || timestamp < current ? timestamp : current;
    }, null);
    const reachedWindowStart = Boolean(request.from && oldestRaw !== null && oldestRaw <= request.from.getTime());
    const totalResults = parsed.data.totalResults;
    const providerLimitReached = Boolean(
      totalResults !== undefined &&
      totalResults > NEWSAPI_RESULT_LIMIT &&
      (page + 1) * pageSize > NEWSAPI_RESULT_LIMIT
    );
    const exhausted = rawArticles.length < pageSize || reachedWindowStart || providerLimitReached || (
      totalResults !== undefined && page * pageSize >= totalResults
    );
    return {
      provider: this.name,
      articles,
      receivedAt: new Date().toISOString(),
      continuation: exhausted ? null : { page: page + 1 },
      exhausted,
      coverage: {
        archiveCapable: true,
        windowStart: request.from?.toISOString(),
        windowEnd: request.to?.toISOString(),
        coveredFrom: exhausted
          ? request.from?.toISOString()
          : oldestRaw === null
            ? undefined
            : new Date(oldestRaw).toISOString(),
        coveredTo: request.to?.toISOString(),
        timeRangeCovered: exhausted && !providerLimitReached,
        exhaustionReason: providerLimitReached
          ? "provider_limit"
          : exhausted
            ? "time_range_covered"
            : undefined,
      },
      diagnostics: {
        received: rawArticles.length,
        plansAttempted: 1,
        plansCompleted: exhausted ? page : Math.max(0, page - 1),
        languages: language ? [language] : [],
        countryQueries: [query],
        outOfWindow,
      },
    };
  }

  private async request(
    query: string,
    request: ProviderFetchRequest = {},
  ): Promise<ProviderFetchResult> {
    const windows = historicalDiscoveryWindows(request);
    if (windows.length === 1) return this.requestOnce(query, request);

    const branches = windows.map((window) => ({ id: `newsapi:${window.index}`, ...window }));
    const existingPages = request.continuation?.discoveryPages;
    const activeBranches = branches
      .filter(({ id }) => existingPages?.[id] !== null)
      .slice(0, NEWSAPI_BRANCHES_PER_STAGE);
    if (activeBranches.length === 0) {
      const providerLimited = request.continuation?.exhaustionReason === "provider_limit";
      return {
        provider: this.name,
        articles: [],
        receivedAt: new Date().toISOString(),
        continuation: null,
        exhausted: true,
        coverage: {
          archiveCapable: true,
          windowStart: request.from?.toISOString(),
          windowEnd: request.to?.toISOString(),
          coveredFrom: request.from?.toISOString(),
          coveredTo: request.to?.toISOString(),
          timeRangeCovered: !providerLimited,
          exhaustionReason: providerLimited ? "provider_limit" : "time_range_covered",
        },
      };
    }

    const perBranchLimit = Math.max(1, Math.ceil((request.limit ?? 100) / activeBranches.length));
    const settled = await Promise.allSettled(activeBranches.map((branch) => this.requestOnce(query, {
      ...request,
      from: branch.from,
      to: branch.to,
      limit: perBranchLimit,
      continuation: existingPages?.[branch.id]
        ? { page: existingPages[branch.id] ?? undefined }
        : undefined,
    })));
    const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (successful.length === 0) {
      const rejected = settled.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
      throw new ProviderError(this.name, "REQUEST_FAILED", "NewsAPI historical discovery failed");
    }

    const discoveryPages: Record<string, number | null> = { ...existingPages };
    activeBranches.forEach((branch, index) => {
      const result = settled[index];
      if (result.status === "fulfilled") discoveryPages[branch.id] = result.value.continuation?.page ?? null;
    });
    const providerLimited = request.continuation?.exhaustionReason === "provider_limit" ||
      successful.some(({ coverage }) => coverage?.exhaustionReason === "provider_limit");
    const exhausted = branches.every(({ id }) => discoveryPages[id] === null);
    const unique = new Map(successful.flatMap(({ articles }) => articles).map((article) => [article.url, article]));
    const dated = [...unique.values()];
    const oldest = dated.reduce<number | null>((current, article) => {
      const timestamp = new Date(article.publishedAt).getTime();
      return !Number.isFinite(timestamp) ? current : current === null || timestamp < current ? timestamp : current;
    }, null);
    return {
      provider: this.name,
      articles: dated.slice(0, request.limit ?? 100),
      receivedAt: new Date().toISOString(),
      continuation: exhausted ? null : {
        discoveryPages,
        exhaustionReason: providerLimited ? "provider_limit" : undefined,
      },
      exhausted,
      coverage: {
        archiveCapable: true,
        windowStart: request.from?.toISOString(),
        windowEnd: request.to?.toISOString(),
        coveredFrom: exhausted
          ? request.from?.toISOString()
          : oldest === null
            ? undefined
            : new Date(oldest).toISOString(),
        coveredTo: request.to?.toISOString(),
        timeRangeCovered: exhausted && !providerLimited,
        exhaustionReason: exhausted
          ? providerLimited ? "provider_limit" : "time_range_covered"
          : undefined,
      },
      diagnostics: {
        received: successful.reduce((total, result) => total + (result.diagnostics?.received ?? result.articles.length), 0),
        plansAttempted: activeBranches.length,
        plansCompleted: branches.filter(({ id }) => discoveryPages[id] === null).length,
        languages: [...new Set(successful.flatMap(({ diagnostics }) => diagnostics?.languages ?? []))],
        countryQueries: [query],
        outOfWindow: successful.reduce((total, result) => total + (result.diagnostics?.outOfWindow ?? 0), 0),
      },
    };
  }

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.request(request.query ?? "world OR international", request);
  }

  search(query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.request(query, request);
  }
}
