import { z } from "zod";
import { countryNameToCode } from "../countries/metadata";
import { logNews } from "../logger";
import { publicationDateInRange, trustedPublicationDate } from "../publication-date";
import type { ProviderArticle, ProviderFetchRequest, ProviderFetchResult } from "../types";
import { fetchWithTimeout, type NewsProvider, ProviderError } from "./provider";

const gdeltResponseSchema = z.object({
  articles: z
    .array(
      z.object({
        url: z.string(),
        title: z.string(),
        seendate: z.string().optional(),
        socialimage: z.string().optional(),
        domain: z.string().optional(),
        language: z.string().optional(),
        sourcecountry: z.string().optional(),
      }),
    )
    .default([]),
});

const LANGUAGE_CODES: Record<string, string> = {
  english: "en",
  japanese: "ja",
  chinese: "zh",
  french: "fr",
  german: "de",
  spanish: "es",
};

function gdeltDate(value?: string): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return trustedPublicationDate([value]);
  const [, year, month, day, hour, minute, second] = match;
  return trustedPublicationDate([`${year}-${month}-${day}T${hour}:${minute}:${second}Z`]);
}

function gdeltLanguage(value?: string): string | null {
  if (!value) return null;
  return LANGUAGE_CODES[value.toLowerCase()] ?? value.toLowerCase().slice(0, 3);
}

function gdeltApiDate(value: Date): string {
  return value.toISOString().replace(/[-:T]/g, "").replace(/\.\d{3}Z$/, "");
}

function gdeltLanguageNames(request: ProviderFetchRequest): string[] {
  const language = request.language?.toLowerCase();
  if (language?.startsWith("ja")) return ["japanese"];
  if (language?.startsWith("en")) return ["english"];
  if (request.countries?.includes("JP")) return ["english", "japanese"];
  return [];
}

export function buildGdeltDiscoveryQueries(
  query: string,
  request: ProviderFetchRequest = {},
): string[] {
  const targetDomains = [...new Set((request.sourceTargets ?? []).flatMap((target) => [
    ...target.domains,
    ...(target.providerIdentifiers.GDELT ?? []),
  ]))];
  const domainFilter = targetDomains.length > 0
    ? `(${targetDomains.map((domain) => `domainis:${domain}`).join(" OR ")})`
    : "";
  const base = [query, domainFilter].filter(Boolean).join(" AND ");
  const languages = gdeltLanguageNames(request);
  return languages.length > 0
    ? languages.map((language) => `${base} sourcelang:${language}`)
    : [base];
}

export class GdeltProvider implements NewsProvider {
  readonly name = "GDELT" as const;
  readonly capabilities = {
    latest: true,
    search: true,
    languages: true,
    sourceMetadata: true,
    requiresCredentials: false,
  } as const;

  constructor(private readonly timeoutMs = 8_000) {}

  private async request(
    query: string,
    request: ProviderFetchRequest = {},
  ): Promise<ProviderFetchResult> {
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", query);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "datedesc");
    const maximumRecords = Math.min(250, request.limit ?? 150);
    url.searchParams.set("maxrecords", String(maximumRecords));
    const continuationEnd = request.continuation?.before
      ? new Date(request.continuation.before)
      : null;
    const rangeEnd = continuationEnd && !Number.isNaN(continuationEnd.getTime())
      ? continuationEnd
      : request.to ?? new Date();
    const rangeStart = request.from ?? new Date(rangeEnd.getTime() - 24 * 3_600_000);
    url.searchParams.set("startdatetime", gdeltApiDate(rangeStart));
    url.searchParams.set("enddatetime", gdeltApiDate(rangeEnd));

    let response: Response;
    try {
      response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, this.timeoutMs);
    } catch {
      throw new ProviderError(this.name, "REQUEST_FAILED", "GDELT request failed");
    }
    if (!response.ok) {
      throw new ProviderError(this.name, `HTTP_${response.status}`, "GDELT returned an error");
    }
    const parsed = gdeltResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(this.name, "INVALID_RESPONSE", "GDELT response was not usable");
    }
    const articles: ProviderArticle[] = parsed.data.articles.flatMap((article) => {
      const publishedAt = gdeltDate(article.seendate);
      if (!publishedAt || !publicationDateInRange(publishedAt, request.from, request.to)) return [];
      return [{
        provider: this.name,
        providerArticleId: article.url,
        title: article.title,
        url: article.url,
        imageUrl: article.socialimage ?? null,
        publishedAt,
        language: gdeltLanguage(article.language),
        sourceName: article.domain ?? "GDELT source",
        sourceIdentifier: article.domain,
        sourceCountry: countryNameToCode(article.sourcecountry),
      }];
    });
    const oldest = articles.reduce<number | null>((current, article) => {
      const timestamp = new Date(article.publishedAt).getTime();
      return current === null || timestamp < current ? timestamp : current;
    }, null);
    const exhausted = articles.length < maximumRecords || oldest === null || oldest <= rangeStart.getTime();
    return {
      provider: this.name,
      articles,
      receivedAt: new Date().toISOString(),
      continuation: exhausted ? null : { before: new Date(oldest - 1).toISOString() },
      exhausted,
    };
  }

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.search(
      request.query ?? (request.countries?.includes("JP") ? '("Japan" OR "日本" OR "日本国")' : "world"),
      request,
    );
  }

  async search(query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    const discoveryQueries = buildGdeltDiscoveryQueries(query, request);
    logNews("info", "gdelt_discovery_planned", {
      provider_source_targeted_query_count: request.sourceTargets?.length
        ? discoveryQueries.length
        : 0,
      discoveryQueryCount: discoveryQueries.length,
    });
    const settled = await Promise.allSettled(
      discoveryQueries.map((discoveryQuery) => this.request(discoveryQuery, request)),
    );
    const successful = settled.flatMap((result) => result.status === "fulfilled" ? result.value.articles : []);
    if (successful.length === 0 && settled.every((result) => result.status === "rejected")) {
      throw new ProviderError(this.name, "REQUEST_FAILED", "GDELT discovery failed");
    }
    const unique = new Map(successful.map((article) => [article.url, article]));
    const continuations = settled.flatMap((result) =>
      result.status === "fulfilled" && result.value.continuation ? [result.value.continuation] : [],
    );
    const before = continuations
      .map((continuation) => continuation.before)
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    const exhausted = before === undefined;
    return {
      provider: this.name,
      articles: [...unique.values()].slice(0, request.limit ?? 250),
      receivedAt: new Date().toISOString(),
      continuation: exhausted ? null : { before },
      exhausted,
    };
  }
}
