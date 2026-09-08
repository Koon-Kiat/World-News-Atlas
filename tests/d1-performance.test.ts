// @vitest-environment node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { D1NewsStore } from "@/lib/news/d1-store";
import { buildNewsResponse, DEFAULT_NEWS_QUERY } from "@/lib/news/query";

it("measures a 1,000-story stored first page without reducing the candidate pool", async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "benchmark", modules: true,
    script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: "benchmark" } }));
  try {
    await mf.ready;
    const db = await mf.getD1Database("DB", "benchmark") as unknown as D1Database;
    for (const file of readdirSync("drizzle").filter((file) => file.endsWith(".sql")).sort()) {
      for (const sql of readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint").filter((sql) => sql.trim())) {
        await db.prepare(sql).run();
      }
    }
    const now = new Date();
    const published = new Date(now.getTime() - 60_000).toISOString();
    await db.prepare("INSERT INTO source (id,name,domain,scope) VALUES ('source','Benchmark','example.com','INTERNATIONAL')").run();
    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000)
      INSERT INTO article (id,provider,provider_article_id,title,url,canonical_url,published_at,language,source_id)
      SELECT 'a'||x,'RSS','a'||x,'Story '||x,'https://example.com/'||x,'https://example.com/'||x,?,'en','source' FROM n`).bind(published).run();
    await db.prepare(`INSERT INTO story (id,fingerprint,title,first_published_at,last_updated_at)
      SELECT id,id,title,published_at,published_at FROM article`).run();
    await db.prepare("INSERT INTO story_article (story_id,article_id) SELECT id,id FROM article").run();
    const store = new D1NewsStore(db);
    const timings: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const candidates = await store.loadStories(DEFAULT_NEWS_QUERY, now);
      const response = buildNewsResponse(candidates, DEFAULT_NEWS_QUERY, "database");
      timings.push(Math.round(performance.now() - start));
      expect(candidates).toHaveLength(1000);
      expect(response.stories).toHaveLength(12);
      expect(response.meta.total).toBe(1000);
    }
    const pageTimings: number[] = [];
    const full = await store.loadStories(DEFAULT_NEWS_QUERY, now);
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const page = await store.loadStoryPage(DEFAULT_NEWS_QUERY, now);
      pageTimings.push(Math.round(performance.now() - start));
      expect(page).toEqual(buildNewsResponse(full, DEFAULT_NEWS_QUERY, "database", undefined, {}, now));
    }
    // Exercise the D1 display-hydration path at the end of both rankings; the
    // complete logical traversal must neither skip nor duplicate candidates.
    for (const sort of ["newest", "popular"] as const) {
      const traversed: string[] = [];
      for (let page = 1; page <= 84; page++) {
        const query = { ...DEFAULT_NEWS_QUERY, sort, page };
        const expected = buildNewsResponse(full, query, "database", undefined, {}, now);
        traversed.push(...expected.stories.map(({ id }) => id));
        if (page === 43 || page === 84) expect(await store.loadStoryPage(query, now)).toEqual(expected);
      }
      expect(traversed).toHaveLength(1000);
      expect(new Set(traversed).size).toBe(1000);
    }
    if (process.env.NEWS_BENCHMARK_OUTPUT) writeFileSync(process.env.NEWS_BENCHMARK_OUTPUT,
      JSON.stringify({ fullCandidateMs: timings, boundedPageMs: pageTimings, candidates: full.length, pages: 84 }));
  } finally { await mf.dispose(); }
}, 60_000);
