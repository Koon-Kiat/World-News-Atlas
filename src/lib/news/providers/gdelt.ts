import { z } from "zod";
import { countryNameToCode } from "../countries/metadata";
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
    url.searchParams.set("sort", "hybridrel");
    url.searchParams.set("maxrecords", String(Math.min(250, request.limit ?? 150)));
    const rangeEnd = request.to ?? new Date();
    const rangeStart = request.from ?? new Date(rangeEnd.getTime() - 24 * 3_600_000);
    const rangeDays = Math.max(1, Math.min(90, Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000)));
    url.searchParams.set("timespan", `${rangeDays}d`);

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
    return { provider: this.name, articles, receivedAt: new Date().toISOString() };
  }

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.request(request.query ?? "sourcelang:english", request);
  }

  search(query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.request(query, request);
  }
}
