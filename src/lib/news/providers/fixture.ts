import { getFixtureStories } from "@/data/fixture-news";
import type { ProviderFetchRequest, ProviderFetchResult } from "../types";
import type { NewsProvider } from "./provider";

export class FixtureProvider implements NewsProvider {
  readonly name = "FIXTURE" as const;
  readonly capabilities = {
    latest: true,
    search: true,
    languages: true,
    sourceMetadata: true,
    requiresCredentials: false,
  } as const;

  async fetchLatest(request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    const articles = getFixtureStories()
      .flatMap((story) => story.articles)
      .slice(0, request.limit ?? 250)
      .map((article) => ({
        provider: this.name,
        providerArticleId: article.providerArticleId,
        title: article.title,
        description: article.description,
        url: article.url,
        imageUrl: article.imageUrl,
        publishedAt: article.publishedAt,
        language: article.language,
        sourceName: article.source.name,
        sourceIdentifier: article.source.name,
        sourceCountry: article.source.countryCode,
        sourceScope: article.source.scope,
        sourceRegion: article.source.region,
      }));
    return { provider: this.name, articles, receivedAt: new Date().toISOString() };
  }

  async search(query: string, request: ProviderFetchRequest = {}): Promise<ProviderFetchResult> {
    const result = await this.fetchLatest(request);
    const needle = query.toLowerCase();
    return {
      ...result,
      articles: result.articles.filter((article) =>
        `${article.title} ${article.description ?? ""}`.toLowerCase().includes(needle),
      ),
    };
  }
}
