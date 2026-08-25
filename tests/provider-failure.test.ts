import { describe, expect, it } from "vitest";
import { fetchProviderArticlesGracefully } from "@/lib/news/providers";
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

describe("provider failure handling", () => {
  it("continues with successful providers when another provider fails", async () => {
    const result = await fetchProviderArticlesGracefully([
      fakeProvider("NEWSAPI", true),
      fakeProvider("GDELT", false),
    ]);
    expect(result.articles).toHaveLength(1);
    expect(result.failures).toEqual([{ provider: "NEWSAPI", code: "TEST_FAILURE" }]);
  });
});
