import { getCountryName } from "./countries/metadata";
import { countryBatchForRun, type IngestionMode, type IngestionCheckpoint, type IngestionStageRecord, type IngestionStageResult } from "./ingestion-state";
import { newsPeriodHours } from "./periods";
import { createConfiguredProviders } from "./providers";
import { canonicalSourceId, parseDomainlessSourceId, sourceSeedForSelection } from "./sources/registry";
import { registrableDomain } from "./sources/domain";
import type { DatabaseCoverageState, NewsStore } from "./store";
import { topicLabel } from "./topics";
import { buildNewsResponse } from "./query";
import { D1IngestionRequestStore } from "./ingestion-requests";
import { IngestionError } from "./ingestion-outcome";
import { z } from "zod";
import type { NewsQuery, NewsResponse, NormalizedArticle, ProviderContinuationState, ProviderName, SourceScope, StoryCandidate, StoryView } from "./types";

type D1Value = string | number | null;
type WriteBatch = (statements: D1PreparedStatement[]) => Promise<D1Result[]>;
interface StoryRow { id: string; title: string; summary: string | null; first_published_at: string; last_updated_at: string; importance_score: number }
interface StoryCountryRow { story_id: string; code: string; name: string; relevance_score: number }
interface StoryTopicRow { story_id: string; slug: string }
interface ArticleRow {
  story_id: string; id: string; provider: ProviderName; provider_article_id: string; title: string; description: string | null;
  url: string; canonical_url: string; image_url: string | null; published_at: string; language: string;
  importance_score: number; relevance_score: number; source_name: string; source_domain: string | null;
  source_country_code: string | null; source_region: string | null; source_language: string | null;
  source_scope: SourceScope; source_quality_score: number;
}
interface ArticleCountryRow { article_id: string; code: string; name: string; relevance_score: number }
interface ArticleTopicRow { article_id: string; slug: string }
interface CheckpointRow {
  provider: ProviderName; discovery_key: string; country_code: string | null; language: string | null; mode: string;
  status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED"; window_start: string; window_end: string;
  cursor: string | null; exhausted: number; coverage_complete: number; received_count: number; accepted_count: number;
  duplicate_count: number; covered_from: string | null; covered_to: string | null; last_successful_at: string | null;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

const cursorSchema = z.object({
  page: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  before: z.iso.datetime().optional(),
  discoveryCursors: z.record(z.string(), z.iso.datetime().nullable()).optional(),
  discoveryPages: z.record(z.string(), z.number().int().positive().nullable()).optional(),
  completedPlanIds: z.array(z.string()).optional(),
  attemptedPlanIds: z.array(z.string()).optional(),
  exhaustionReason: z.string().optional(),
}).strict();

function jsonCursor(value: string | null): ProviderContinuationState | null {
  if (value === null) return null;
  try {
    return cursorSchema.parse(JSON.parse(value));
  } catch { throw new IngestionError("INVALID_STATE"); }
}

function checkpointFromRow(row: CheckpointRow): IngestionCheckpoint {
  if (!["incremental", "backfill"].includes(row.mode) || !["RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"].includes(row.status) ||
      !z.iso.datetime().safeParse(row.window_start).success || !z.iso.datetime().safeParse(row.window_end).success ||
      row.window_start > row.window_end || ![0, 1].includes(row.exhausted) || ![0, 1].includes(row.coverage_complete) ||
      [row.received_count, row.accepted_count, row.duplicate_count].some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new IngestionError("INVALID_STATE");
  }
  return {
    provider: row.provider, discoveryKey: row.discovery_key, countryCode: row.country_code, language: row.language,
    mode: row.mode === "backfill" ? "backfill" : "incremental",
    status: row.status === "SUCCEEDED" || row.status === "FAILED" ? row.status : "PARTIAL",
    windowStart: row.window_start, windowEnd: row.window_end, cursor: jsonCursor(row.cursor),
    exhausted: Boolean(row.exhausted), coverageComplete: Boolean(row.coverage_complete),
    receivedCount: row.received_count, acceptedCount: row.accepted_count, duplicateCount: row.duplicate_count,
    coveredFrom: row.covered_from ?? undefined, coveredTo: row.covered_to ?? undefined,
    lastSuccessfulAt: row.last_successful_at ?? undefined,
  };
}

async function allRows<T>(database: D1Database, sql: string, values: D1Value[] = []): Promise<T[]> {
  const result = await database.prepare(sql).bind(...values).all<T>();
  return result.results ?? [];
}

async function firstId(database: D1Database, sql: string, values: D1Value[]): Promise<string | null> {
  return (await database.prepare(sql).bind(...values).first<{ id: string }>())?.id ?? null;
}

async function ensureCountry(database: D1Database, write: WriteBatch, code: string, name = getCountryName(code)): Promise<void> {
  const now = new Date().toISOString();
  await write([database.prepare(`
    INSERT INTO country (code, name, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
  `).bind(code, name, now, now)]);
}

async function upsertSource(database: D1Database, write: WriteBatch, article: NormalizedArticle): Promise<string> {
  if (article.source.countryCode) await ensureCountry(database, write, article.source.countryCode);
  const existingId = article.source.domain
    ? await firstId(database, "SELECT id FROM source WHERE domain = ? LIMIT 1", [article.source.domain])
    : await firstId(database, "SELECT id FROM source WHERE domain IS NULL AND LOWER(name) = LOWER(?) AND country_code IS ? LIMIT 1", [article.source.name, article.source.countryCode]);
  const sourceId = existingId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [database.prepare(`
    INSERT INTO source (id, name, domain, country_code, region, language, scope, quality_score, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, domain = excluded.domain,
      country_code = excluded.country_code, region = excluded.region, language = excluded.language,
      scope = excluded.scope, quality_score = excluded.quality_score, is_active = 1, updated_at = excluded.updated_at
  `).bind(sourceId, article.source.name, article.source.domain, article.source.countryCode,
    article.source.region, article.source.language, article.source.scope, article.source.qualityScore, now, now)];
  if (article.sourceIdentifier) {
    statements.push(database.prepare(`
      INSERT INTO source_provider_identifier (id, source_id, provider, identifier, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider, identifier) DO UPDATE SET source_id = excluded.source_id
    `).bind(crypto.randomUUID(), sourceId, article.provider, article.sourceIdentifier, now));
  }
  await write(statements);
  return sourceId;
}

async function upsertArticle(database: D1Database, write: WriteBatch, article: NormalizedArticle): Promise<string> {
  const sourceId = await upsertSource(database, write, article);
  for (const country of article.countries) await ensureCountry(database, write, country.code, country.name);
  const canonicalId = await firstId(database, "SELECT id FROM article WHERE canonical_url = ? LIMIT 1", [article.canonicalUrl]);
  const providerId = await firstId(database, "SELECT article_id AS id FROM article_provider_ref WHERE provider = ? AND provider_article_id = ? LIMIT 1", [article.provider, article.providerArticleId]);
  const articleId = canonicalId ?? providerId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    database.prepare(`
      INSERT INTO article (id, provider, provider_article_id, title, description, url, canonical_url, image_url,
        published_at, language, source_id, importance_score, relevance_score, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, provider_article_id = excluded.provider_article_id,
        title = excluded.title, description = excluded.description, url = excluded.url,
        canonical_url = excluded.canonical_url, image_url = excluded.image_url, published_at = excluded.published_at,
        language = excluded.language, source_id = excluded.source_id, importance_score = excluded.importance_score,
        relevance_score = excluded.relevance_score, updated_at = excluded.updated_at
    `).bind(articleId, article.provider, article.providerArticleId, article.title, article.description, article.url,
      article.canonicalUrl, article.imageUrl, article.publishedAt, article.language, sourceId,
      article.importanceScore, article.relevanceScore, now, now),
    database.prepare(`
      INSERT INTO article_provider_ref (id, article_id, provider, provider_article_id, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_article_id) DO UPDATE SET article_id = excluded.article_id
    `).bind(crypto.randomUUID(), articleId, article.provider, article.providerArticleId, now),
    database.prepare("DELETE FROM article_country WHERE article_id = ?").bind(articleId),
    database.prepare("DELETE FROM article_topic WHERE article_id = ?").bind(articleId),
  ];
  for (const country of article.countries) {
    statements.push(database.prepare("INSERT INTO article_country (article_id, country_code, relevance_score) VALUES (?, ?, ?)").bind(articleId, country.code, country.relevanceScore));
  }
  for (const slug of article.topics) {
    statements.push(database.prepare(`
      INSERT INTO topic (id, slug, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at
    `).bind(`topic:${slug}`, slug, topicLabel(slug), now, now));
    statements.push(database.prepare(`
      INSERT INTO article_topic (article_id, topic_id) SELECT ?, id FROM topic WHERE slug = ?
      ON CONFLICT(article_id, topic_id) DO NOTHING
    `).bind(articleId, slug));
  }
  await write(statements);
  return articleId;
}

function chunks<T>(values: T[], size = 80): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function groupRows<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = grouped.get(id);
    if (group) group.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

function sourceAccessClause(query: NewsQuery, values: D1Value[]): string | null {
  const selections: string[] = [];
  for (const selection of query.sources) {
    const seed = sourceSeedForSelection(selection);
    if (seed) {
      const domains = [...new Set([seed.domain, ...seed.alternateDomains].map(registrableDomain))];
      selections.push(`(LOWER(src.name) = LOWER(?) OR src.domain IN (${placeholders(domains.length)}))`);
      values.push(seed.name, ...domains);
    } else if (selection.startsWith("domain:")) {
      selections.push("src.domain = ?");
      values.push(registrableDomain(selection.slice("domain:".length)));
    } else {
      const domainless = parseDomainlessSourceId(selection);
      if (domainless) {
        selections.push(`(src.domain IS NULL AND LOWER(src.name) = LOWER(?)${domainless.countryCode ? " AND src.country_code = ?" : ""})`);
        values.push(domainless.name);
        if (domainless.countryCode) values.push(domainless.countryCode);
      } else {
        selections.push("LOWER(src.name) = LOWER(?)");
        values.push(selection);
      }
    }
  }
  const perspectiveCountry = query.sourcePerspective === "local" || query.sourcePerspective === "first-country"
    ? query.countries[0] : query.sourcePerspective === "second-country" ? query.countries[1] : undefined;
  const predicates: string[] = [];
  if (selections.length) predicates.push(`(${selections.join(" OR ")})`);
  if (perspectiveCountry) {
    predicates.push("src.country_code = ?"); values.push(perspectiveCountry);
  } else if (query.sourcePerspective === "international" && query.countries.length) {
    predicates.push(`(src.country_code IS NULL OR src.country_code NOT IN (${placeholders(query.countries.length)}))`);
    values.push(...query.countries);
  }
  return predicates.length ? predicates.join(" AND ") : null;
}

export function databaseCandidateLimit(): number {
  const configured = Number(process.env.NEWS_DATABASE_CANDIDATE_LIMIT ?? 1_000);
  return Number.isFinite(configured) ? Math.max(300, Math.min(5_000, Math.floor(configured))) : 1_000;
}

export class D1NewsStore implements NewsStore {
  readonly ingestionRequests: D1IngestionRequestStore;
  constructor(readonly database: D1Database, private readonly fence?: { requestId: string; token: string }) {
    this.ingestionRequests = new D1IngestionRequestStore(database);
  }

  forIngestion(requestId: string, token: string): D1NewsStore {
    return new D1NewsStore(this.database, { requestId, token });
  }

  private write: WriteBatch = async (statements) => {
    if (!this.fence) return this.database.batch(statements);
    // D1 batch rolls back all statements on constraint failure. A valid owner
    // inserts nothing; a stale owner deliberately violates the existing NOT
    // NULL constraint. The guard and data writes share one transaction, closing
    // the gap between a JavaScript lease check and the actual mutation. Neither
    // a missing lock nor a replaced token can let an old worker write.
    const guard = this.database.prepare(`INSERT INTO ingestion_operation_lock (id, request_id, lease_until, attempt_token)
      SELECT 'production', NULL, 0, '' WHERE NOT EXISTS (
        SELECT 1 FROM ingestion_operation_lock WHERE id = 'production'
          AND request_id = ? AND attempt_token = ? AND lease_until > unixepoch('subsec') * 1000
      )`).bind(this.fence.requestId, this.fence.token);
    try { return (await this.database.batch([guard, ...statements])).slice(1); }
    catch (error) {
      if (error instanceof Error && error.message.includes("NOT NULL constraint failed: ingestion_operation_lock.request_id")) {
        throw new IngestionError("LEASE_LOST");
      }
      throw error;
    }
  };

  async persistStoryCandidates(candidates: StoryCandidate[], beforeWrite?: () => Promise<void>): Promise<{ storedArticles: number; storiesUpdated: number }> {
    const uniqueArticles = new Map(candidates.flatMap(({ articles }) => articles).map((article) => [article.canonicalUrl, article]));
    const articleIds = new Map<string, string>();
    for (const article of uniqueArticles.values()) {
      await beforeWrite?.();
      articleIds.set(article.canonicalUrl, await upsertArticle(this.database, this.write, article));
    }
    const previousStoriesByArticle = new Map<string, string[]>();
    for (const idChunk of chunks([...articleIds.values()])) {
      for (const row of await allRows<{ story_id: string; article_id: string }>(this.database,
        `SELECT story_id, article_id FROM story_article WHERE article_id IN (${placeholders(idChunk.length)})`, idChunk)) {
        previousStoriesByArticle.set(row.article_id, [...(previousStoriesByArticle.get(row.article_id) ?? []), row.story_id]);
      }
    }
    for (const candidate of candidates) {
      await beforeWrite?.();
      for (const country of candidate.countries) await ensureCountry(this.database, this.write, country.code, country.name);
      const existingId = await firstId(this.database, "SELECT id FROM story WHERE fingerprint = ? LIMIT 1", [candidate.fingerprint]);
      const storyId = existingId ?? crypto.randomUUID();
      const affectedStoryIds = new Set([storyId]);
      const now = new Date().toISOString();
      const statements: D1PreparedStatement[] = [
        this.database.prepare(`
          INSERT INTO story (id, fingerprint, title, summary, first_published_at, last_updated_at, importance_score, cluster_score, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint, title = excluded.title,
            summary = excluded.summary, first_published_at = excluded.first_published_at,
            last_updated_at = excluded.last_updated_at, importance_score = excluded.importance_score,
            cluster_score = excluded.cluster_score, updated_at = excluded.updated_at
        `).bind(storyId, candidate.fingerprint, candidate.title, candidate.summary, candidate.firstPublishedAt,
          candidate.lastUpdatedAt, candidate.importanceScore, candidate.clusterScore, now, now),
      ];
      for (const article of candidate.articles) {
        const articleId = articleIds.get(article.canonicalUrl);
        if (!articleId) throw new IngestionError("INVARIANT_FAILED");
        for (const previousId of previousStoriesByArticle.get(articleId) ?? []) affectedStoryIds.add(previousId);
        // A provider stage only owns its incoming articles. Retain the other
        // members of both the destination cluster and any previous cluster.
        statements.push(this.database.prepare("DELETE FROM story_article WHERE article_id = ? AND story_id <> ?").bind(articleId, storyId));
        statements.push(this.database.prepare("INSERT INTO story_article (story_id, article_id) VALUES (?, ?) ON CONFLICT(story_id, article_id) DO NOTHING").bind(storyId, articleId));
      }
      for (const affectedId of affectedStoryIds) statements.push(...this.refreshStoryStatements(affectedId, now));
      await this.write(statements);
    }
    return { storedArticles: articleIds.size, storiesUpdated: candidates.length };
  }

  private refreshStoryStatements(storyId: string, now: string): D1PreparedStatement[] {
    // Derive filters and display metadata from actual membership, including
    // articles absent from this batch. Run with the membership change atomically.
    const members = "SELECT article_id FROM story_article WHERE story_id = ?";
    return [
      this.database.prepare("DELETE FROM story WHERE id = ? AND NOT EXISTS (SELECT 1 FROM story_article WHERE story_id = ?)").bind(storyId, storyId),
      this.database.prepare("DELETE FROM story_country WHERE story_id = ?").bind(storyId),
      this.database.prepare(`INSERT INTO story_country (story_id, country_code, relevance_score)
        SELECT ?, country_code, MAX(relevance_score) FROM article_country WHERE article_id IN (${members}) GROUP BY country_code`).bind(storyId, storyId),
      this.database.prepare("DELETE FROM story_topic WHERE story_id = ?").bind(storyId),
      this.database.prepare(`INSERT INTO story_topic (story_id, topic_id)
        SELECT ?, topic_id FROM article_topic WHERE article_id IN (${members}) GROUP BY topic_id`).bind(storyId, storyId),
      this.database.prepare(`UPDATE story SET
        (title, summary) = (SELECT title, description FROM article WHERE id IN (${members}) ORDER BY importance_score DESC, published_at ASC, id ASC LIMIT 1),
        (first_published_at, last_updated_at, importance_score) =
          (SELECT MIN(published_at), MAX(published_at), MIN(1.0, MAX(importance_score) + MIN(0.18, COUNT(*) * 0.04)) FROM article WHERE id IN (${members})),
        updated_at = ? WHERE id = ?`).bind(storyId, storyId, now, storyId),
    ];
  }

  async loadStories(query: NewsQuery, now = new Date(), options: { compact?: boolean; ids?: string[] } = {}): Promise<StoryView[]> {
    const values: D1Value[] = [new Date(now.getTime() - newsPeriodHours(query.period) * 3_600_000).toISOString(), now.toISOString()];
    const where = [`EXISTS (SELECT 1 FROM story_article p JOIN article a ON a.id = p.article_id WHERE p.story_id = s.id AND a.published_at >= ? AND a.published_at <= ?)`];
    for (const countryCode of query.countries) {
      where.push("EXISTS (SELECT 1 FROM story_country sc WHERE sc.story_id = s.id AND sc.country_code = ?)"); values.push(countryCode);
    }
    if (query.topic) {
      where.push("EXISTS (SELECT 1 FROM story_topic st JOIN topic t ON t.id = st.topic_id WHERE st.story_id = s.id AND t.slug = ?)"); values.push(query.topic);
    }
    if (query.language) {
      where.push("EXISTS (SELECT 1 FROM story_article sl JOIN article la ON la.id = sl.article_id WHERE sl.story_id = s.id AND la.language = ?)"); values.push(query.language);
    }
    const accessValues: D1Value[] = [];
    const accessClause = sourceAccessClause(query, accessValues);
    if (accessClause) {
      where.push(`EXISTS (SELECT 1 FROM story_article al JOIN article aa ON aa.id = al.article_id JOIN source src ON src.id = aa.source_id WHERE al.story_id = s.id AND ${accessClause})`);
      values.push(...accessValues);
    }
    if (query.search) {
      const needle = `%${query.search.toLocaleLowerCase("en")}%`;
      where.push(`(LOWER(s.title) LIKE ? OR LOWER(COALESCE(s.summary, '')) LIKE ?
        OR EXISTS (SELECT 1 FROM story_country x JOIN country c ON c.code = x.country_code WHERE x.story_id = s.id AND LOWER(c.name) LIKE ?)
        OR EXISTS (SELECT 1 FROM story_topic x JOIN topic t ON t.id = x.topic_id WHERE x.story_id = s.id AND LOWER(t.slug) LIKE ?)
        OR EXISTS (SELECT 1 FROM story_article x JOIN article a ON a.id = x.article_id JOIN source src ON src.id = a.source_id
          WHERE x.story_id = s.id AND (LOWER(a.title) LIKE ? OR LOWER(COALESCE(a.description, '')) LIKE ? OR LOWER(src.name) LIKE ?)))`);
      values.push(needle, needle, needle, needle, needle, needle, needle);
    }
    if (options.ids) {
      where.push("s.id IN (SELECT value FROM json_each(?))");
      values.push(JSON.stringify(options.ids));
    }
    values.push(databaseCandidateLimit());
    const order = query.sort === "newest" ? "s.last_updated_at DESC, s.importance_score DESC, s.id ASC" : "s.importance_score DESC, s.last_updated_at DESC, s.id ASC";
    const storyRows = await allRows<StoryRow>(this.database, `SELECT s.id, s.title, s.summary, s.first_published_at, s.last_updated_at, s.importance_score FROM story s WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`, values);
    if (!storyRows.length) return [];
    const ids = JSON.stringify(storyRows.map(({ id }) => id));
    // JSON table-valued parameters avoid D1's variable limit. One batch keeps
    // relation reads consistent and replaces dozens of serial round trips.
    const marks = "SELECT value FROM json_each(?)";
    const compact = options.compact && !query.search;
    const results = await this.database.batch([
      this.database.prepare(`SELECT sc.story_id, c.code, c.name, sc.relevance_score FROM story_country sc JOIN country c ON c.code = sc.country_code WHERE sc.story_id IN (${marks})`).bind(ids),
      this.database.prepare(`SELECT st.story_id, t.slug FROM story_topic st JOIN topic t ON t.id = st.topic_id WHERE st.story_id IN (${marks})`).bind(ids),
      this.database.prepare(`
        SELECT sa.story_id, a.id, a.provider, a.provider_article_id,
          ${compact ? "'' AS title, NULL AS description, '' AS url, '' AS canonical_url, NULL AS image_url" : "a.title, a.description, a.url, a.canonical_url, a.image_url"},
          a.published_at, a.language, a.importance_score, a.relevance_score,
          src.name AS source_name, src.domain AS source_domain, src.country_code AS source_country_code,
          src.region AS source_region, src.language AS source_language, src.scope AS source_scope,
          src.quality_score AS source_quality_score
        FROM story_article sa JOIN article a ON a.id = sa.article_id JOIN source src ON src.id = a.source_id
        WHERE sa.story_id IN (${marks}) ORDER BY a.published_at ASC, a.id ASC
      `).bind(ids),
      this.database.prepare(`SELECT ac.article_id, c.code, c.name, ac.relevance_score FROM article_country ac JOIN country c ON c.code = ac.country_code WHERE ac.article_id IN (SELECT article_id FROM story_article WHERE story_id IN (${marks}))`).bind(ids),
      this.database.prepare(`SELECT at.article_id, t.slug FROM article_topic at JOIN topic t ON t.id = at.topic_id WHERE at.article_id IN (SELECT article_id FROM story_article WHERE story_id IN (${marks}))`).bind(ids),
    ]);
    const storyCountries = groupRows(results[0].results as unknown as StoryCountryRow[], (row) => row.story_id);
    const storyTopics = groupRows(results[1].results as unknown as StoryTopicRow[], (row) => row.story_id);
    const articleRows = groupRows(results[2].results as unknown as ArticleRow[], (row) => row.story_id);
    const articleCountries = groupRows(results[3].results as unknown as ArticleCountryRow[], (row) => row.article_id);
    const articleTopics = groupRows(results[4].results as unknown as ArticleTopicRow[], (row) => row.article_id);
    return storyRows.map((story) => ({
      id: story.id, title: story.title, summary: story.summary, firstPublishedAt: story.first_published_at,
      lastUpdatedAt: story.last_updated_at, importanceScore: story.importance_score,
      countries: (storyCountries.get(story.id) ?? []).map((row) => ({ code: row.code, name: row.name, relevanceScore: row.relevance_score })),
      topics: (storyTopics.get(story.id) ?? []).map(({ slug }) => slug),
      articles: (articleRows.get(story.id) ?? []).map((article) => ({
        id: article.id, provider: article.provider, providerArticleId: article.provider_article_id,
        title: article.title, description: article.description, url: article.url, canonicalUrl: article.canonical_url,
        imageUrl: article.image_url, publishedAt: article.published_at, language: article.language,
        source: {
          id: canonicalSourceId({ name: article.source_name, domain: article.source_domain, countryCode: article.source_country_code }),
          name: article.source_name, domain: article.source_domain, countryCode: article.source_country_code,
          region: article.source_region, language: article.source_language, scope: article.source_scope,
          qualityScore: article.source_quality_score,
        },
        countries: (articleCountries.get(article.id) ?? []).map((row) => ({ code: row.code, name: row.name, relevanceScore: row.relevance_score })),
        topics: (articleTopics.get(article.id) ?? []).map(({ slug }) => slug),
        importanceScore: article.importance_score, relevanceScore: article.relevance_score,
        isFixture: article.provider === "FIXTURE",
      })),
    }));
  }

  async loadStoryPage(query: NewsQuery, now = new Date()): Promise<NewsResponse> {
    const candidates = await this.loadStories(query, now, { compact: true });
    const response = buildNewsResponse(candidates, query, "database", undefined, {}, now);
    if (!response.stories.length) return response;
    const ids = JSON.stringify(response.stories.flatMap((story) => story.articles.map(({ id }) => id)));
    const displayRows = await allRows<Pick<ArticleRow, "id" | "title" | "description" | "url" | "canonical_url" | "image_url">>(
      this.database, `SELECT id, title, description, url, canonical_url, image_url
        FROM article WHERE id IN (SELECT value FROM json_each(?))`, [ids]);
    const articles = new Map(displayRows.map((article) => [article.id, article]));
    // Retain the exact projected window, filtering and ranking from the broad
    // pool. Only restore large display fields for this page's articles.
    response.stories = response.stories.map((story) => ({ ...story,
      articles: story.articles.flatMap((article) => {
        const display = articles.get(article.id);
        return display ? [{ ...article, title: display.title, description: display.description,
          url: display.url, canonicalUrl: display.canonical_url, imageUrl: display.image_url }] : [];
      }),
    })).filter((story) => story.articles.length > 0);
    return response;
  }

  async loadCoverage(query: NewsQuery, now = new Date()): Promise<DatabaseCoverageState> {
    const windowStart = new Date(now.getTime() - newsPeriodHours(query.period) * 3_600_000);
    const freshnessMs = Math.max(15, Math.min(360, Number(process.env.NEWS_DATABASE_FRESHNESS_MINUTES ?? 120))) * 60_000;
    const freshAfter = new Date(now.getTime() - freshnessMs).toISOString();
    const values: D1Value[] = [freshAfter, windowStart.toISOString(), freshAfter];
    const countryClause = query.countries.length ? `country_code IN (${placeholders(query.countries.length)})` : "country_code IS NULL";
    values.push(...query.countries);
    const checkpoints = await allRows<CheckpointRow>(this.database, `SELECT * FROM provider_ingestion_checkpoint
      WHERE status = 'SUCCEEDED' AND last_successful_at >= ? AND window_start <= ? AND window_end >= ? AND ${countryClause}`, values);
    const countryCodes: Array<string | null> = query.countries.length ? query.countries : [null];
    const historical = query.period === "7d" || query.period === "30d";
    const enabledProviders = [...new Set(createConfiguredProviders({ period: query.period, countries: query.countries }).map(({ name }) => name))];
    const providerComplete = (countryCode: string | null, provider: ProviderName): boolean => checkpoints.some((checkpoint) =>
      checkpoint.country_code === countryCode && checkpoint.provider === provider &&
      (["GDELT", "NEWSAPI"].includes(provider)
        ? Boolean(checkpoint.coverage_complete) && checkpoint.covered_from !== null && checkpoint.covered_from <= windowStart.toISOString() && checkpoint.covered_to !== null && checkpoint.covered_to >= freshAfter
        : Boolean(checkpoint.exhausted)));
    const complete = checkpoints.length > 0 && countryCodes.every((code) => enabledProviders.every((provider) => providerComplete(code, provider)));
    const archiveComplete = complete && (!historical || countryCodes.every((code) => checkpoints.some((checkpoint) =>
      checkpoint.country_code === code && ["GDELT", "NEWSAPI"].includes(checkpoint.provider) &&
      checkpoint.covered_from !== null && checkpoint.covered_from <= windowStart.toISOString() && checkpoint.covered_to !== null && checkpoint.covered_to >= freshAfter)));
    const reasons: string[] = [];
    if (!complete) reasons.push(checkpoints.length ? "DATABASE_WINDOW_PARTIAL" : "DATABASE_COVERAGE_UNKNOWN");
    if (historical && !archiveComplete) reasons.push("DATABASE_ARCHIVE_PARTIAL");
    return { complete: complete && (!historical || archiveComplete), archiveComplete, reasons, checkpointCount: checkpoints.length };
  }

  async load(discoveryKey: string, provider: ProviderName): Promise<IngestionCheckpoint | null> {
    const row = await this.database.prepare("SELECT * FROM provider_ingestion_checkpoint WHERE provider = ? AND discovery_key = ? LIMIT 1").bind(provider, discoveryKey).first<CheckpointRow>();
    return row ? checkpointFromRow(row) : null;
  }

  async save(checkpoint: IngestionCheckpoint): Promise<void> {
    const now = new Date().toISOString();
    await this.write([this.database.prepare(`
      INSERT INTO provider_ingestion_checkpoint (id, provider, discovery_key, country_code, language, mode, status,
        window_start, window_end, covered_from, covered_to, cursor, exhausted, coverage_complete,
        received_count, accepted_count, duplicate_count, last_successful_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, discovery_key) DO UPDATE SET country_code = excluded.country_code, language = excluded.language,
        mode = excluded.mode, status = excluded.status, window_start = excluded.window_start, window_end = excluded.window_end,
        covered_from = excluded.covered_from, covered_to = excluded.covered_to, cursor = excluded.cursor,
        exhausted = excluded.exhausted, coverage_complete = excluded.coverage_complete,
        received_count = excluded.received_count, accepted_count = excluded.accepted_count,
        duplicate_count = excluded.duplicate_count, last_successful_at = excluded.last_successful_at, updated_at = excluded.updated_at
    `).bind(`${checkpoint.provider}:${checkpoint.discoveryKey}`, checkpoint.provider, checkpoint.discoveryKey,
      checkpoint.countryCode, checkpoint.language, checkpoint.mode, checkpoint.status, checkpoint.windowStart,
      checkpoint.windowEnd, checkpoint.coveredFrom ?? null, checkpoint.coveredTo ?? null,
      checkpoint.cursor ? JSON.stringify(checkpoint.cursor) : null, checkpoint.exhausted ? 1 : 0,
      checkpoint.coverageComplete ? 1 : 0, checkpoint.receivedCount, checkpoint.acceptedCount,
      checkpoint.duplicateCount, checkpoint.lastSuccessfulAt ?? null, now, now)]);
  }

  async startStage(stage: IngestionStageRecord): Promise<string> {
    const id = crypto.randomUUID();
    await this.write([this.database.prepare(`INSERT INTO provider_ingestion_run
      (id, provider, discovery_key, country_code, language, mode, status, started_at, window_start, window_end)
      VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?)`)
      .bind(id, stage.provider, stage.discoveryKey, stage.countryCode, stage.language, stage.mode,
        new Date().toISOString(), stage.windowStart.toISOString(), stage.windowEnd.toISOString())]);
    return id;
  }

  async finishStage(id: string | null, result: IngestionStageResult): Promise<void> {
    if (!id) return;
    const now = new Date().toISOString();
    await this.write([this.database.prepare(`UPDATE provider_ingestion_run SET status = ?, completed_at = ?, last_successful_at = ?,
      cursor = ?, exhausted = ?, coverage_complete = ?, received_count = ?, normalized_count = ?, accepted_count = ?,
      out_of_window_count = ?, irrelevant_count = ?, duplicate_count = ?, stored_count = ?, stories_updated = ?, error_code = ? WHERE id = ?`)
      .bind(result.status, now, result.status === "FAILED" ? null : now, result.cursor ? JSON.stringify(result.cursor) : null,
        result.exhausted ? 1 : 0, result.coverageComplete ? 1 : 0, result.receivedCount, result.normalizedCount,
        result.acceptedCount, result.outOfWindowCount, result.irrelevantCount, result.duplicateCount,
        result.storedCount, result.storiesUpdated, result.errorCode ?? null, id)]);
  }

  async nextCountryBatch(size: number, mode: IngestionMode = "incremental"): Promise<string[]> {
    const now = new Date().toISOString();
    const id = mode === "backfill" ? "country-rotation:backfill" : "country-rotation";
    const result = await this.write([this.database.prepare(`INSERT INTO ingestion_scheduler_state (id, next_country_offset, last_run_at, updated_at)
      VALUES (?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET
        next_country_offset = CASE WHEN next_country_offset >= 1000000 THEN 0 ELSE next_country_offset + 1 END,
        last_run_at = excluded.last_run_at, updated_at = excluded.updated_at
      RETURNING next_country_offset`).bind(id, now, now)]);
    const row = result[0].results[0] as { next_country_offset: number } | undefined;
    if (!row) throw new IngestionError("INVARIANT_FAILED");
    return countryBatchForRun(row.next_country_offset === 0 ? 1_000_000 : row.next_country_offset - 1, size);
  }

  async claimIngestionNonce(nonce: string, receivedAt: Date, expiresAt: Date): Promise<boolean> {
    const result = await this.database.prepare("INSERT OR IGNORE INTO ingestion_request_nonce (nonce, received_at, expires_at) VALUES (?, ?, ?)")
      .bind(nonce, receivedAt.toISOString(), expiresAt.toISOString()).run();
    return (result.meta.changes ?? 0) === 1;
  }

  async deleteExpiredIngestionNonces(now: Date, limit = 250): Promise<number> {
    const result = await this.database.prepare(`DELETE FROM ingestion_request_nonce WHERE nonce IN
      (SELECT nonce FROM ingestion_request_nonce WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?)`)
      .bind(now.toISOString(), Math.max(1, Math.min(1_000, Math.floor(limit)))).run();
    return result.meta.changes ?? 0;
  }
}
