import { z } from "zod";
import type { ProviderArticle, ProviderFetchRequest, ProviderFetchResult } from "../types";
import { fetchWithTimeout, type NewsProvider, ProviderError } from "./provider";

const newsApiResponseSchema = z.object({
  status: z.string(),
  message: z.string().optional(),
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

export class NewsApiProvider implements NewsProvider {
  readonly name = "NEWSAPI" as const;
  readonly capabilities = {
    latest: true,
    search: true,
    languages: true,
    sourceMetadata: true,
    requiresCredentials: true,
  } as const;

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 8_000,
  ) {
    if (!apiKey.trim()) throw new ProviderError(this.name, "MISSING_CREDENTIAL", "NewsAPI is disabled");
  }

  private async fetchSourceCountries(): Promise<Map<string, string>> {
    try {
      const response = await fetchWithTimeout(
        "https://newsapi.org/v2/top-headlines/sources",
        { headers: { "X-Api-Key": this.apiKey, Accept: "application/json" } },
        this.timeoutMs,
      );
      if (!response.ok) return new Map();
      const parsed = newsApiSourcesSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.status !== "ok") return new Map();
      return new Map(
        parsed.data.sources.flatMap((source) =>
          source.country ? [[source.id, source.country.toUpperCase()] as const] : [],
        ),
      );
    } catch {
      return new Map();
    }
  }

  private async request(
    query: string,
    request: ProviderFetchRequest = {},
  ): Promise<ProviderFetchResult> {
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", query);
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("pageSize", String(Math.min(100, request.limit ?? 100)));
    if (request.from) url.searchParams.set("from", request.from.toISOString());
    if (request.to) url.searchParams.set("to", request.to.toISOString());

    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        { headers: { "X-Api-Key": this.apiKey, Accept: "application/json" } },
        this.timeoutMs,
      );
      if (response.status === 400 && (url.searchParams.has("from") || url.searchParams.has("to"))) {
        url.searchParams.delete("from");
        url.searchParams.delete("to");
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
      throw new ProviderError(this.name, `HTTP_${response.status}`, "NewsAPI returned an error");
    }
    const parsed = newsApiResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.status !== "ok") {
      throw new ProviderError(this.name, "INVALID_RESPONSE", "NewsAPI response was not usable");
    }

    const sourceCountries = await this.fetchSourceCountries();
    const articles: ProviderArticle[] = (parsed.data.articles ?? []).map((article) => ({
      provider: this.name,
      providerArticleId: article.url,
      title: article.title,
      description: article.description,
      url: article.url,
      imageUrl: article.urlToImage,
      publishedAt: article.publishedAt,
      sourceName: article.source.name,
      sourceIdentifier: article.source.id,
      sourceCountry: article.source.id ? sourceCountries.get(article.source.id) ?? null : null,
    }));
    return { provider: this.name, articles, receivedAt: new Date().toISOString() };
  }

  fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.request(request.query ?? "world OR international", request);
  }

  search(query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    return this.request(query, request);
  }
}
