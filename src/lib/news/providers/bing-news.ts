import Parser from "rss-parser";
import type { ProviderArticle, ProviderFetchRequest, ProviderFetchResult } from "../types";
import { fetchWithTimeout, type NewsProvider, ProviderError } from "./provider";

const MAX_FEED_BYTES = 2 * 1024 * 1024;

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
    query: string,
    request: ProviderFetchRequest = {},
  ): Promise<ProviderFetchResult> {
    const url = new URL("https://www.bing.com/news/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "rss");
    url.searchParams.set("mkt", "en-SG");

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
      const publishedAt = item.isoDate ?? item.pubDate ?? new Date().toISOString();
      if (request.from && new Date(publishedAt).getTime() < request.from.getTime()) return [];
      return [{
        provider: this.name,
        providerArticleId: item.guid ?? `${url}#${index}`,
        title: item.title,
        description: item.contentSnippet ?? null,
        url: articleUrl,
        imageUrl: secureImageUrl(item.newsImage),
        publishedAt,
        language: "en",
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
    return this.requestOnce("world OR international", request);
  }

  async search(query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    const discoveryQueries = request.countries?.length
      ? [
          query,
          ...[
            "politics",
            "business",
            "technology",
            "society",
            "climate",
            "transport",
            "health",
            "education",
            "culture",
            "science",
            "sport",
          ].map((topic) => `${query} ${topic}`),
          `${query} site:reuters.com`,
          `${query} site:apnews.com`,
        ]
      : [query];
    const settled = await Promise.allSettled(
      discoveryQueries.map((discoveryQuery) => this.requestOnce(discoveryQuery, request)),
    );
    const successful = settled.flatMap((result) => result.status === "fulfilled" ? result.value.articles : []);
    if (successful.length === 0 && settled.every((result) => result.status === "rejected")) {
      throw new ProviderError(this.name, "REQUEST_FAILED", "Bing News RSS discovery failed");
    }
    const unique = new Map<string, ProviderArticle>();
    for (const article of successful) unique.set(article.url, article);
    return {
      provider: this.name,
      articles: [...unique.values()].slice(0, request.limit ?? 250),
      receivedAt: new Date().toISOString(),
    };
  }
}
