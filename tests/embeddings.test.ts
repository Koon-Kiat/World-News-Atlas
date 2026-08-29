import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configuredTextEmbeddingProvider,
  OpenAiTextEmbeddingProvider,
} from "@/lib/news/embeddings";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("semantic embedding provider", () => {
  it("is disabled without explicit server-side configuration", () => {
    expect(configuredTextEmbeddingProvider({})).toBeNull();
    expect(configuredTextEmbeddingProvider({ NEWS_SEMANTIC_CLUSTERING_ENABLED: "true" })).toBeNull();
    expect(configuredTextEmbeddingProvider({
      NEWS_SEMANTIC_CLUSTERING_ENABLED: "true",
      NEWS_EMBEDDING_API_KEY: "server-only-test-key",
    })).toBeInstanceOf(OpenAiTextEmbeddingProvider);
    expect(configuredTextEmbeddingProvider({
      NEWS_SEMANTIC_CLUSTERING_ENABLED: "true",
      OPENAI_API_KEY: "standard-server-only-test-key",
    })).toBeInstanceOf(OpenAiTextEmbeddingProvider);
  });

  it("batches embedding requests and preserves vector order", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(JSON.stringify({
        data: payload.input.map((_text, index) => ({ index, embedding: [index + 1, 1] })),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new OpenAiTextEmbeddingProvider("test-key", "test-model", 1_000);

    const embeddings = await provider.embed(Array.from({ length: 65 }, (_, index) => `text ${index}`));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(embeddings).toHaveLength(65);
    expect(embeddings[0]).toEqual([1, 1]);
    expect(embeddings[64]).toEqual([1, 1]);
  });

  it("rejects malformed external responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ index: 0, embedding: [1] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAiTextEmbeddingProvider("test-key", "test-model", 1_000);

    await expect(provider.embed(["headline"])).rejects.toThrow("invalid response");
  });

  it("aborts embedding calls that exceed the configured timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const provider = new OpenAiTextEmbeddingProvider("test-key", "test-model", 1_000);
    const request = provider.embed(["headline"]);
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });
});
