import { z } from "zod";

export interface TextEmbeddingProvider {
  readonly id: string;
  embed(texts: string[]): Promise<number[][]>;
}

const embeddingResponseSchema = z.object({
  data: z.array(z.object({
    index: z.number().int().nonnegative(),
    embedding: z.array(z.number().finite()).min(2),
  })),
});

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const MAX_BATCH_SIZE = 64;

function boundedTimeout(value: string | undefined): number {
  const parsed = Number(value ?? 5_000);
  return Number.isFinite(parsed) ? Math.min(15_000, Math.max(1_000, parsed)) : 5_000;
}

export class OpenAiTextEmbeddingProvider implements TextEmbeddingProvider {
  readonly id: string;

  constructor(
    private readonly apiKey: string,
    private readonly model = "text-embedding-3-small",
    private readonly timeoutMs = 5_000,
  ) {
    if (!apiKey.trim()) throw new Error("Embedding API key is required");
    this.id = `openai:${model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += MAX_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + MAX_BATCH_SIZE);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(OPENAI_EMBEDDINGS_URL, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: this.model, input: batch }),
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`);
      const parsed = embeddingResponseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.data.length !== batch.length) {
        throw new Error("Embedding provider returned an invalid response");
      }
      const ordered = [...parsed.data.data].sort((first, second) => first.index - second.index);
      const dimension = ordered[0]?.embedding.length;
      if (!dimension || ordered.some((entry, index) => entry.index !== index || entry.embedding.length !== dimension)) {
        throw new Error("Embedding provider returned inconsistent vectors");
      }
      embeddings.push(...ordered.map(({ embedding }) => embedding));
    }
    return embeddings;
  }
}

export function configuredTextEmbeddingProvider(
  environment: Record<string, string | undefined> = process.env,
): TextEmbeddingProvider | null {
  if (environment.NEWS_SEMANTIC_CLUSTERING_ENABLED?.toLocaleLowerCase("en") !== "true") return null;
  const apiKey = environment.NEWS_EMBEDDING_API_KEY?.trim() || environment.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = environment.NEWS_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  return new OpenAiTextEmbeddingProvider(apiKey, model, boundedTimeout(environment.NEWS_EMBEDDING_TIMEOUT_MS));
}
