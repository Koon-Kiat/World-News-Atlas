// @vitest-environment node

import { readFileSync } from "node:fs";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clusterArticles } from "@/lib/news/cluster";
import { loadDatabaseCoverage, loadDatabaseStories } from "@/lib/news/data-store";
import { D1NewsStore } from "@/lib/news/d1-store";
import { persistStoryCandidates } from "@/lib/news/persistence";
import { buildNewsResponse } from "@/lib/news/query";
import { canonicalSourceId } from "@/lib/news/sources/registry";
import type { NewsStore } from "@/lib/news/store";
import type { NewsQuery, NormalizedArticle } from "@/lib/news/types";

const migration = readFileSync("drizzle/0000_world_news_d1.sql", "utf8")
  .split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
const baseQuery: NewsQuery = { countries: [], sourcePerspective: "all", sources: [], period: "30d", sort: "newest", page: 1, pageSize: 12 };

let miniflare: Miniflare;
let database: D1Database;
let store: NewsStore;

function article(
  id: string,
  title: string,
  countries: Array<{ code: string; name: string; relevanceScore: number }>,
  options: { ageMinutes?: number; topics?: string[]; language?: string; sourceName?: string } = {},
): NormalizedArticle {
  const sourceName = options.sourceName ?? "Integration News";
  return {
    id, provider: "RSS", providerArticleId: id, title, description: `${title} reporting summary`,
    url: `https://example.com/${id}`, canonicalUrl: `https://example.com/${id}`, imageUrl: null,
    publishedAt: new Date(Date.now() - (options.ageMinutes ?? 1) * 60_000).toISOString(),
    language: options.language ?? "en",
    source: {
      id: canonicalSourceId({ name: sourceName, domain: sourceName === "Integration News" ? "example.com" : null, countryCode: "JP" }),
      name: sourceName, domain: sourceName === "Integration News" ? "example.com" : null,
      countryCode: "JP", region: "Asia", language: options.language ?? "en", scope: "NATIONAL", qualityScore: 0.9,
    },
    sourceIdentifier: sourceName, countries, topics: options.topics ?? ["politics"], importanceScore: 0.8, relevanceScore: 0.9,
  };
}

async function countRows(table: "article" | "story" | "story_article"): Promise<number> {
  return (await database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>())?.count ?? 0;
}

beforeEach(async () => {
  miniflare = new Miniflare(convertV4MiniflareOptions({
    name: "news-test", modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "world-news-test" },
  }));
  await miniflare.ready;
  database = await miniflare.getD1Database("DB", "news-test") as unknown as D1Database;
  for (const statement of migration) await database.prepare(statement).run();
  store = new D1NewsStore(database);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await miniflare.dispose();
});

describe("D1 news integration", () => {
  it("persists and reclusters idempotently with every relational link intact", async () => {
    const initial = article("cluster-a", "Japan launches a regional technology programme", [{ code: "JP", name: "Japan", relevanceScore: 1 }]);
    await persistStoryCandidates(clusterArticles([initial]), store);
    await persistStoryCandidates(clusterArticles([initial]), store);
    expect(await countRows("article")).toBe(1);
    expect(await countRows("story")).toBe(1);
    expect(await countRows("story_article")).toBe(1);

    const related = article("cluster-b", "Japan and Singapore launch technology programme", [
      { code: "JP", name: "Japan", relevanceScore: 1 },
      { code: "SG", name: "Singapore", relevanceScore: 1 },
    ], { topics: ["technology"] });
    await persistStoryCandidates(clusterArticles([{ ...initial, topics: ["technology"] }, related]), store);
    const query = { ...baseQuery, countries: ["JP", "SG"], topic: "technology" };
    const response = buildNewsResponse(await loadDatabaseStories(query, store), query, "database");
    expect(response.meta.total).toBe(1);
    expect(response.stories[0].articles).toHaveLength(2);
    expect(response.stories[0].countries.map(({ code }) => code).sort()).toEqual(["JP", "SG"]);
    expect(await countRows("story")).toBe(1);
  }, 15_000);

  it("returns Unicode, source, topic, country, and newest-first queries", async () => {
    const older = article("old", "Older Japan politics report", [{ code: "JP", name: "Japan", relevanceScore: 1 }], { ageMinutes: 90, sourceName: "Example News" });
    const newest = article("new", "日本政府が半導体投資を発表", [{ code: "JP", name: "Japan", relevanceScore: 1 }], { ageMinutes: 1, topics: ["technology"], language: "ja" });
    await persistStoryCandidates([...clusterArticles([older]), ...clusterArticles([newest])], store);
    const all = await loadDatabaseStories({ ...baseQuery, countries: ["JP"] }, store);
    expect(all.map(({ title }) => title)).toEqual(["日本政府が半導体投資を発表", "Older Japan politics report"]);
    const japanese = await loadDatabaseStories({ ...baseQuery, countries: ["JP"], topic: "technology", language: "ja" }, store);
    expect(japanese).toHaveLength(1);
    const sourceId = canonicalSourceId({ name: "Example News", domain: null, countryCode: "JP" });
    const exactSource = await loadDatabaseStories({ ...baseQuery, sources: [sourceId] }, store);
    expect(exactSource.map(({ title }) => title)).toEqual(["Older Japan politics report"]);
  });

  it("persists checkpoints, scheduler rotation, and nonce replay protection", async () => {
    const now = new Date("2026-09-02T00:00:00.000Z");
    const windowStart = new Date("2026-08-03T00:00:00.000Z");
    vi.stubEnv("GDELT_ENABLED", "true");
    vi.stubEnv("NEWSAPI_KEY", "");
    for (const provider of ["OTHER", "RSS", "GDELT"] as const) {
      await store.save({
        provider, discoveryKey: "backfill:JP:30d:all", countryCode: "JP", language: null, mode: "backfill",
        status: "SUCCEEDED", windowStart: windowStart.toISOString(), windowEnd: now.toISOString(), cursor: null,
        exhausted: true, coverageComplete: provider === "GDELT", receivedCount: 10, acceptedCount: 8, duplicateCount: 2,
        coveredFrom: provider === "GDELT" ? windowStart.toISOString() : undefined,
        coveredTo: provider === "GDELT" ? now.toISOString() : undefined, lastSuccessfulAt: now.toISOString(),
      });
    }
    await expect(loadDatabaseCoverage({ ...baseQuery, countries: ["JP"] }, store, now))
      .resolves.toMatchObject({ complete: true, archiveComplete: true, checkpointCount: 3 });
    expect(await store.nextCountryBatch(4)).not.toEqual(await store.nextCountryBatch(4));
    const expiresAt = new Date(now.getTime() + 300_000);
    await expect(store.claimIngestionNonce("a".repeat(24), now, expiresAt)).resolves.toBe(true);
    await expect(store.claimIngestionNonce("a".repeat(24), now, expiresAt)).resolves.toBe(false);
    await expect(store.deleteExpiredIngestionNonces(new Date(expiresAt.getTime() + 1))).resolves.toBe(1);
  });
});
