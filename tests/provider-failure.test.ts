import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchProviderArticlesGracefully,
  resetProviderRequestCacheForTesting,
} from "@/lib/news/providers";
import type { NewsProvider } from "@/lib/news/providers/provider";
import { ProviderError } from "@/lib/news/providers/provider";
import type { ProviderFetchResult } from "@/lib/news/types";

const successResult: ProviderFetchResult = {
  provider: "GDELT",
  receivedAt: new Date().toISOString(),
  articles: [
    {
      provider: "GDELT",
      providerArticleId: "working",
      title: "Working provider article",
      url: "https://example.com/working",
      publishedAt: new Date().toISOString(),
      sourceName: "Working source",
    },
  ],
};

function fakeProvider(name: "NEWSAPI" | "GDELT", fails: boolean): NewsProvider {
  return {
    name,
    capabilities: {
      latest: true,
      search: true,
      languages: true,
      sourceMetadata: true,
      requiresCredentials: name === "NEWSAPI",
    },
    async fetchLatest() {
      if (fails) throw new ProviderError(name, "TEST_FAILURE", "simulated");
      return successResult;
    },
    async search() {
      return this.fetchLatest();
    },
  };
}

afterEach(() => {
  resetProviderRequestCacheForTesting();
});

describe("provider failure handling", () => {
  it("continues with successful providers when another provider fails", async () => {
    const result = await fetchProviderArticlesGracefully([
      fakeProvider("NEWSAPI", true),
      fakeProvider("GDELT", false),
    ]);
    expect(result.articles).toHaveLength(1);
    expect(result.failures).toEqual([{ provider: "NEWSAPI", code: "TEST_FAILURE" }]);
  });

  it("coalesces concurrent duplicate upstream requests and reuses the short cache", async () => {
    const fetchLatest = vi.fn(async () => successResult);
    const provider: NewsProvider = {
      ...fakeProvider("GDELT", false),
      fetchLatest,
      search: fetchLatest,
    };

    await Promise.all([
      fetchProviderArticlesGracefully([provider]),
      fetchProviderArticlesGracefully([provider]),
    ]);
    await fetchProviderArticlesGracefully([provider]);

    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it("short-caches provider failures to avoid retry amplification", async () => {
    const fetchLatest = vi.fn(async () => {
      throw new ProviderError("GDELT", "TEST_FAILURE", "simulated");
    });
    const provider: NewsProvider = {
      ...fakeProvider("GDELT", false),
      fetchLatest,
      search: fetchLatest,
    };

    const first = await fetchProviderArticlesGracefully([provider]);
    const second = await fetchProviderArticlesGracefully([provider]);

    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(first.failures).toEqual(second.failures);
  });

  it("short-caches empty provider responses to avoid retry amplification", async () => {
    const fetchLatest = vi.fn(async (): Promise<ProviderFetchResult> => ({
      provider: "GDELT",
      receivedAt: new Date().toISOString(),
      articles: [],
    }));
    const provider: NewsProvider = {
      ...fakeProvider("GDELT", false),
      fetchLatest,
      search: fetchLatest,
    };

    const first = await fetchProviderArticlesGracefully([provider]);
    const second = await fetchProviderArticlesGracefully([provider]);

    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(first.articles).toEqual([]);
    expect(second.articles).toEqual([]);
  });
});
