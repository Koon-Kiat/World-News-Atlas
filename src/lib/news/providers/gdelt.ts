import { z } from "zod";
import {
  buildCountryDiscoveryQuery,
  discoveryProfilesForCountries,
  localPublisherTargetsForCountries,
} from "../countries/discovery";
import { countryNameToCode, getCountryName } from "../countries/metadata";
import { logNews } from "../logger";
import { publicationDateInRange, trustedPublicationDate } from "../publication-date";
import type { ProviderArticle, ProviderFetchRequest, ProviderFetchResult } from "../types";
import { fetchWithTimeout, type NewsProvider, ProviderError } from "./provider";
import { historicalDiscoveryWindows } from "./historical-windows";

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
  afrikaans: "af", albanian: "sq", arabic: "ar", armenian: "hy", azerbaijani: "az",
  bengali: "bn", bosnian: "bs", bulgarian: "bg", catalan: "ca", chinese: "zh",
  croatian: "hr", czech: "cs", danish: "da", dutch: "nl", english: "en",
  estonian: "et", finnish: "fi", french: "fr", galician: "gl", georgian: "ka",
  german: "de", greek: "el", gujarati: "gu", hebrew: "he", hindi: "hi",
  hungarian: "hu", icelandic: "is", indonesian: "id", italian: "it", japanese: "ja",
  kannada: "kn", kazakh: "kk", korean: "ko", latvian: "lv", lithuanian: "lt",
  macedonian: "mk", malay: "ms", malayalam: "ml", marathi: "mr", mongolian: "mn",
  nepali: "ne", norwegian: "no", persian: "fa", polish: "pl", portuguese: "pt",
  punjabi: "pa", romanian: "ro", russian: "ru", serbian: "sr", sinhalese: "si",
  slovak: "sk", slovenian: "sl", somali: "so", spanish: "es", swahili: "sw",
  swedish: "sv", tamil: "ta", telugu: "te", thai: "th", turkish: "tr",
  ukrainian: "uk", vietnamese: "vi",
};

const GDELT_LANGUAGE_NAMES_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(LANGUAGE_CODES).map(([name, code]) => [code, name]),
);
const GDELT_BRANCHES_PER_STAGE = 3;

const GDELT_SOURCE_COUNTRY_NAMES: Readonly<Record<string, string>> = {
  US: "unitedstates",
  GB: "unitedkingdom",
  KR: "southkorea",
  KP: "northkorea",
  CZ: "czechrepublic",
  CI: "ivorycoast",
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
  const language = request.language?.toLowerCase().split("-")[0];
  if (language) return GDELT_LANGUAGE_NAMES_BY_CODE[language]
    ? [GDELT_LANGUAGE_NAMES_BY_CODE[language]]
    : [];
  return [...new Set(
    discoveryProfilesForCountries(request.countries ?? []).flatMap(({ gdeltLanguages }) => gdeltLanguages),
  )].slice(0, 3);
}

function gdeltSourceCountry(request: ProviderFetchRequest): string | null {
  const countries = request.countries ?? [];
  const index = request.sourcePerspective === "second-country" ? 1 : 0;
  if (!["local", "first-country", "second-country"].includes(request.sourcePerspective ?? "all")) return null;
  const code = countries[index];
  if (!code) return null;
  if (GDELT_SOURCE_COUNTRY_NAMES[code]) return GDELT_SOURCE_COUNTRY_NAMES[code];
  return getCountryName(code).normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "").toLocaleLowerCase("en");
}

export function buildGdeltDiscoveryQueries(
  query: string,
  request: ProviderFetchRequest = {},
): string[] {
  const explicitTargetDomains = [...new Set((request.sourceTargets ?? []).flatMap((target) => [
    ...target.domains,
    ...(target.providerIdentifiers.GDELT ?? []),
  ]))];
  const domainFilter = explicitTargetDomains.length > 0
    ? `(${explicitTargetDomains.map((domain) => `domainis:${domain}`).join(" OR ")})`
    : "";
  const sourceCountry = gdeltSourceCountry(request);
  const sourceCountryFilter = sourceCountry ? `sourcecountry:${sourceCountry}` : "";
  const base = [query, domainFilter, sourceCountryFilter].filter(Boolean).join(" AND ");
  const languages = gdeltLanguageNames(request);
  const primaryBranches = languages.length > 0
    ? languages.map((language) => `${base} sourcelang:${language}`)
    : [base];
  if (request.sourceTargets?.length) return primaryBranches.slice(0, 3);

  const localDomains = request.sourcePerspective === "all"
    ? [...new Set(localPublisherTargetsForCountries(request.countries ?? []).flatMap(({ domains }) => domains))].slice(0, 8)
    : [];
  const localFilter = sourceCountryFilter || (localDomains.length > 0
    ? `(${localDomains.map((domain) => `domainis:${domain}`).join(" OR ")})`
    : "");
  const localLanguage = languages.find((language) => language !== "english") ?? languages[0];
  const localBranch = localFilter
    ? [localFilter, localLanguage ? `sourcelang:${localLanguage}` : ""].filter(Boolean).join(" ")
    : "";
  return [...new Set([...primaryBranches, localBranch].filter(Boolean))].slice(0, 3);
}

interface GdeltDiscoveryBranch {
  id: string;
  query: string;
  from?: Date;
  to?: Date;
}

function gdeltDiscoveryBranches(
  queries: string[],
  request: ProviderFetchRequest,
): GdeltDiscoveryBranch[] {
  const windows = historicalDiscoveryWindows(request);
  return queries.flatMap((query, queryIndex) => windows.map((window) => ({
    id: `gdelt:${queryIndex}:${window.index}:${query}`,
    query,
    from: window.from,
    to: window.to,
  })));
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

  constructor(private readonly timeoutMs = 30_000) {}

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
    let outOfWindow = 0;
    const datedArticles = parsed.data.articles.map((article) => ({ article, publishedAt: gdeltDate(article.seendate) }));
    const articles: ProviderArticle[] = datedArticles.flatMap(({ article, publishedAt }) => {
      if (!publishedAt || !publicationDateInRange(publishedAt, request.from, request.to)) {
        outOfWindow += 1;
        return [];
      }
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
    const oldest = datedArticles.reduce<number | null>((current, { publishedAt }) => {
      const timestamp = publishedAt ? new Date(publishedAt).getTime() : Number.NaN;
      if (!Number.isFinite(timestamp)) return current;
      return current === null || timestamp < current ? timestamp : current;
    }, null);
    const pageShort = parsed.data.articles.length < maximumRecords;
    const reachedStart = oldest === null || oldest <= rangeStart.getTime();
    const exhausted = pageShort || reachedStart;
    const timeRangeCovered = exhausted;
    return {
      provider: this.name,
      articles,
      receivedAt: new Date().toISOString(),
      continuation: exhausted ? null : { before: new Date(oldest - 1).toISOString() },
      exhausted,
      coverage: {
        archiveCapable: true,
        windowStart: rangeStart.toISOString(),
        windowEnd: rangeEnd.toISOString(),
        coveredFrom: timeRangeCovered ? rangeStart.toISOString() : new Date(oldest).toISOString(),
        coveredTo: rangeEnd.toISOString(),
        timeRangeCovered,
        exhaustionReason: timeRangeCovered ? "time_range_covered" : undefined,
      },
      diagnostics: { received: parsed.data.articles.length, outOfWindow },
    };
  }

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.search(
      request.query ?? buildCountryDiscoveryQuery(request.countries ?? []) ?? "world",
      request,
    );
  }

  async search(query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    const discoveryQueries = buildGdeltDiscoveryQueries(query, request);
    const discoveryBranches = gdeltDiscoveryBranches(discoveryQueries, request);
    const existingCursors = request.continuation?.discoveryCursors;
    const activeBranches = discoveryBranches
      .filter(({ id }) => existingCursors?.[id] !== null)
      .slice(0, GDELT_BRANCHES_PER_STAGE);
    logNews("info", "gdelt_discovery_planned", {
      provider_source_targeted_query_count: activeBranches.filter(({ query: branchQuery }) =>
        /\b(?:domainis|sourcecountry):/u.test(branchQuery)
      ).length,
      discoveryQueryCount: activeBranches.length,
      exhaustedDiscoveryQueryCount: discoveryBranches.filter(({ id }) => existingCursors?.[id] === null).length,
    });
    if (activeBranches.length === 0) {
      return {
        provider: this.name,
        articles: [],
        receivedAt: new Date().toISOString(),
        continuation: null,
        exhausted: true,
      };
    }
    const perBranchLimit = Math.max(1, Math.ceil((request.limit ?? 250) / activeBranches.length));
    const settled = await Promise.allSettled(
      activeBranches.map((branch) => {
        const branchBefore = existingCursors?.[branch.id] ?? request.continuation?.before;
        return this.request(branch.query, {
          ...request,
          from: branch.from,
          to: branch.to,
          limit: perBranchLimit,
          continuation: branchBefore ? { before: branchBefore } : undefined,
        });
      }),
    );
    const successful = settled.flatMap((result) => result.status === "fulfilled" ? result.value.articles : []);
    if (successful.length === 0 && settled.every((result) => result.status === "rejected")) {
      // Preserve HTTP/authentication errors instead of masking every failure as
      // transient. The ingestion handler needs the code to decide retryability.
      throw settled[0].reason;
    }
    const unique = new Map(successful.map((article) => [article.url, article]));
    const discoveryCursors: Record<string, string | null> = { ...existingCursors };
    activeBranches.forEach((branch, index) => {
      const result = settled[index];
      if (result.status === "fulfilled") {
        discoveryCursors[branch.id] = result.value.continuation?.before ?? null;
      }
    });
    const exhausted = discoveryBranches.every(({ id }) =>
      discoveryCursors[id] === null
    );
    const fulfilled = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const cursorDates = Object.values(discoveryCursors)
      .filter((cursor): cursor is string => Boolean(cursor))
      .map((cursor) => new Date(cursor).getTime())
      .filter(Number.isFinite);
    const singleCursor = discoveryBranches.length === 1
      ? discoveryCursors[discoveryBranches[0].id]
      : null;
    return {
      provider: this.name,
      articles: [...unique.values()].slice(0, request.limit ?? 250),
      receivedAt: new Date().toISOString(),
      continuation: exhausted
        ? null
        : discoveryBranches.length === 1 && singleCursor
          ? { before: singleCursor }
          : { discoveryCursors },
      exhausted,
      coverage: {
        archiveCapable: true,
        windowStart: request.from?.toISOString(),
        windowEnd: request.to?.toISOString(),
        coveredFrom: exhausted
          ? request.from?.toISOString()
          : cursorDates.length > 0
            ? new Date(Math.min(...cursorDates)).toISOString()
            : undefined,
        coveredTo: request.to?.toISOString(),
        timeRangeCovered: exhausted,
        exhaustionReason: exhausted ? "time_range_covered" : undefined,
      },
      diagnostics: {
        received: fulfilled.reduce((total, result) => total + (result.diagnostics?.received ?? result.articles.length), 0),
        plansAttempted: activeBranches.length,
        plansCompleted: discoveryBranches.filter(({ id }) => discoveryCursors[id] === null).length,
        languages: gdeltLanguageNames(request),
        countryQueries: activeBranches.map(({ query: branchQuery }) => branchQuery),
        outOfWindow: fulfilled.reduce((total, result) => total + (result.diagnostics?.outOfWindow ?? 0), 0),
      },
    };
  }
}
