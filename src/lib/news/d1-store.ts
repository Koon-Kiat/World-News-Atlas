import { getCountryName } from "./countries/metadata";
import { countryBatchForRun, type IngestionCheckpoint, type IngestionStageRecord, type IngestionStageResult } from "./ingestion-state";
import { newsPeriodHours } from "./periods";
import { createConfiguredProviders } from "./providers";
import { canonicalSourceId, parseDomainlessSourceId, sourceSeedForSelection } from "./sources/registry";
import { registrableDomain } from "./sources/domain";
import type { DatabaseCoverageState, NewsStore } from "./store";
import { topicLabel } from "./topics";
import type { NewsQuery, NormalizedArticle, ProviderContinuationState, ProviderName, SourceScope, StoryCandidate, StoryView } from "./types";

type D1Value = string | number | null;
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

function jsonCursor(value: string | null): ProviderContinuationState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as ProviderContinuationState : null;
  } catch { return null; }
}

function checkpointFromRow(row: CheckpointRow): IngestionCheckpoint {
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

async function ensureCountry(database: D1Database, code: string, name = getCountryName(code)): Promise<void> {
  const now = new Date().toISOString();
  await database.prepare(`
    INSERT INTO country (code, name, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
  `).bind(code, name, now, now).run();
}

async function upsertSource(database: D1Database, article: NormalizedArticle): Promise<string> {
  if (article.source.countryCode) await ensureCountry(database, article.source.countryCode);
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
  await database.batch(statements);
  return sourceId;
}

async function upsertArticle(database: D1Database, article: NormalizedArticle): Promise<string> {
  const sourceId = await upsertSource(database, article);
  for (const country of article.countries) await ensureCountry(database, country.code, country.name);
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
  await database.batch(statements);
  return articleId;
}

function chunks<T>(values: T[], size = 80): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
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
  constructor(readonly database: D1Database) {}

  async persistStoryCandidates(candidates: StoryCandidate[]): Promise<{ storedArticles: number; storiesUpdated: number }> {
    const uniqueArticles = new Map(candidates.flatMap(({ articles }) => articles).map((article) => [article.canonicalUrl, article]));
    const articleIds = new Map<string, string>();
    for (const article of uniqueArticles.values()) articleIds.set(article.canonicalUrl, await upsertArticle(this.database, article));
    const previousStoryIds = new Set<string>();
    for (const idChunk of chunks([...articleIds.values()])) {
      for (const row of await allRows<{ story_id: string }>(this.database,
        `SELECT DISTINCT story_id FROM story_article WHERE article_id IN (${placeholders(idChunk.length)})`, idChunk)) previousStoryIds.add(row.story_id);
    }
    const desiredStoryIds = new Set<string>();
    for (const candidate of candidates) {
      for (const country of candidate.countries) await ensureCountry(this.database, country.code, country.name);
      const existingId = await firstId(this.database, "SELECT id FROM story WHERE fingerprint = ? LIMIT 1", [candidate.fingerprint]);
      const storyId = existingId ?? crypto.randomUUID();
      desiredStoryIds.add(storyId);
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
        this.database.prepare("DELETE FROM story_article WHERE story_id = ?").bind(storyId),
        this.database.prepare("DELETE FROM story_country WHERE story_id = ?").bind(storyId),
        this.database.prepare("DELETE FROM story_topic WHERE story_id = ?").bind(storyId),
      ];
      for (const article of candidate.articles) {
        const articleId = articleIds.get(article.canonicalUrl);
        if (!articleId) throw new Error("Persisted article could not be reconciled");
        statements.push(this.database.prepare("INSERT INTO story_article (story_id, article_id) VALUES (?, ?) ON CONFLICT(story_id, article_id) DO NOTHING").bind(storyId, articleId));
      }
      for (const country of candidate.countries) statements.push(this.database.prepare("INSERT INTO story_country (story_id, country_code, relevance_score) VALUES (?, ?, ?)").bind(storyId, country.code, country.relevanceScore));
      for (const slug of candidate.topics) {
        statements.push(this.database.prepare(`
          INSERT INTO topic (id, slug, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at
        `).bind(`topic:${slug}`, slug, topicLabel(slug), now, now));
        statements.push(this.database.prepare("INSERT INTO story_topic (story_id, topic_id) SELECT ?, id FROM topic WHERE slug = ? ON CONFLICT(story_id, topic_id) DO NOTHING").bind(storyId, slug));
      }
      await this.database.batch(statements);
    }
    for (const idChunk of chunks([...previousStoryIds].filter((id) => !desiredStoryIds.has(id)))) {
      await this.database.prepare(`DELETE FROM story WHERE id IN (${placeholders(idChunk.length)})`).bind(...idChunk).run();
    }
    await this.database.prepare("DELETE FROM story WHERE NOT EXISTS (SELECT 1 FROM story_article WHERE story_article.story_id = story.id)").run();
    return { storedArticles: articleIds.size, storiesUpdated: candidates.length };
  }

  async loadStories(query: NewsQuery, now = new Date()): Promise<StoryView[]> {
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
    values.push(databaseCandidateLimit());
    const order = query.sort === "newest" ? "s.last_updated_at DESC, s.importance_score DESC, s.id ASC" : "s.importance_score DESC, s.last_updated_at DESC, s.id ASC";
    const storyRows = await allRows<StoryRow>(this.database, `SELECT s.id, s.title, s.summary, s.first_published_at, s.last_updated_at, s.importance_score FROM story s WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`, values);
    if (!storyRows.length) return [];
    const storyIds = storyRows.map(({ id }) => id);
    const storyCountries: StoryCountryRow[] = [];
    const storyTopics: StoryTopicRow[] = [];
    const articleRows: ArticleRow[] = [];
    for (const idChunk of chunks(storyIds)) {
      const marks = placeholders(idChunk.length);
      storyCountries.push(...await allRows<StoryCountryRow>(this.database, `SELECT sc.story_id, c.code, c.name, sc.relevance_score FROM story_country sc JOIN country c ON c.code = sc.country_code WHERE sc.story_id IN (${marks})`, idChunk));
      storyTopics.push(...await allRows<StoryTopicRow>(this.database, `SELECT st.story_id, t.slug FROM story_topic st JOIN topic t ON t.id = st.topic_id WHERE st.story_id IN (${marks})`, idChunk));
      articleRows.push(...await allRows<ArticleRow>(this.database, `
        SELECT sa.story_id, a.id, a.provider, a.provider_article_id, a.title, a.description, a.url, a.canonical_url,
          a.image_url, a.published_at, a.language, a.importance_score, a.relevance_score,
          src.name AS source_name, src.domain AS source_domain, src.country_code AS source_country_code,
          src.region AS source_region, src.language AS source_language, src.scope AS source_scope,
          src.quality_score AS source_quality_score
        FROM story_article sa JOIN article a ON a.id = sa.article_id JOIN source src ON src.id = a.source_id
        WHERE sa.story_id IN (${marks}) ORDER BY a.published_at ASC, a.id ASC
      `, idChunk));
    }
    const articleCountries: ArticleCountryRow[] = [];
    const articleTopics: ArticleTopicRow[] = [];
    for (const idChunk of chunks(articleRows.map(({ id }) => id))) {
      const marks = placeholders(idChunk.length);
      articleCountries.push(...await allRows<ArticleCountryRow>(this.database, `SELECT ac.article_id, c.code, c.name, ac.relevance_score FROM article_country ac JOIN country c ON c.code = ac.country_code WHERE ac.article_id IN (${marks})`, idChunk));
      articleTopics.push(...await allRows<ArticleTopicRow>(this.database, `SELECT at.article_id, t.slug FROM article_topic at JOIN topic t ON t.id = at.topic_id WHERE at.article_id IN (${marks})`, idChunk));
    }
    return storyRows.map((story) => ({
      id: story.id, title: story.title, summary: story.summary, firstPublishedAt: story.first_published_at,
      lastUpdatedAt: story.last_updated_at, importanceScore: story.importance_score,
      countries: storyCountries.filter((row) => row.story_id === story.id).map((row) => ({ code: row.code, name: row.name, relevanceScore: row.relevance_score })),
      topics: storyTopics.filter((row) => row.story_id === story.id).map(({ slug }) => slug),
      articles: articleRows.filter((row) => row.story_id === story.id).map((article) => ({
        id: article.id, provider: article.provider, providerArticleId: article.provider_article_id,
        title: article.title, description: article.description, url: article.url, canonicalUrl: article.canonical_url,
        imageUrl: article.image_url, publishedAt: article.published_at, language: article.language,
        source: {
          id: canonicalSourceId({ name: article.source_name, domain: article.source_domain, countryCode: article.source_country_code }),
          name: article.source_name, domain: article.source_domain, countryCode: article.source_country_code,
          region: article.source_region, language: article.source_language, scope: article.source_scope,
          qualityScore: article.source_quality_score,
        },
        countries: articleCountries.filter((row) => row.article_id === article.id).map((row) => ({ code: row.code, name: row.name, relevanceScore: row.relevance_score })),
        topics: articleTopics.filter((row) => row.article_id === article.id).map(({ slug }) => slug),
        importanceScore: article.importance_score, relevanceScore: article.relevance_score,
        isFixture: article.provider === "FIXTURE",
      })),
    }));
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
    await this.database.prepare(`
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
      checkpoint.duplicateCount, checkpoint.lastSuccessfulAt ?? null, now, now).run();
  }

  async startStage(stage: IngestionStageRecord): Promise<string> {
    const id = crypto.randomUUID();
    await this.database.prepare(`INSERT INTO provider_ingestion_run
      (id, provider, discovery_key, country_code, language, mode, status, started_at, window_start, window_end)
      VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?)`)
      .bind(id, stage.provider, stage.discoveryKey, stage.countryCode, stage.language, stage.mode,
        new Date().toISOString(), stage.windowStart.toISOString(), stage.windowEnd.toISOString()).run();
    return id;
  }

  async finishStage(id: string | null, result: IngestionStageResult): Promise<void> {
    if (!id) return;
    const now = new Date().toISOString();
    await this.database.prepare(`UPDATE provider_ingestion_run SET status = ?, completed_at = ?, last_successful_at = ?,
      cursor = ?, exhausted = ?, coverage_complete = ?, received_count = ?, normalized_count = ?, accepted_count = ?,
      out_of_window_count = ?, irrelevant_count = ?, duplicate_count = ?, stored_count = ?, stories_updated = ?, error_code = ? WHERE id = ?`)
      .bind(result.status, now, result.status === "FAILED" ? null : now, result.cursor ? JSON.stringify(result.cursor) : null,
        result.exhausted ? 1 : 0, result.coverageComplete ? 1 : 0, result.receivedCount, result.normalizedCount,
        result.acceptedCount, result.outOfWindowCount, result.irrelevantCount, result.duplicateCount,
        result.storedCount, result.storiesUpdated, result.errorCode ?? null, id).run();
  }

  async nextCountryBatch(size: number): Promise<string[]> {
    const now = new Date().toISOString();
    await this.database.prepare(`INSERT INTO ingestion_scheduler_state (id, next_country_offset, last_run_at, updated_at)
      VALUES ('country-rotation', 0, ?, ?) ON CONFLICT(id) DO UPDATE SET last_run_at = excluded.last_run_at, updated_at = excluded.updated_at`).bind(now, now).run();
    const row = await this.database.prepare("SELECT next_country_offset FROM ingestion_scheduler_state WHERE id = 'country-rotation'").first<{ next_country_offset: number }>();
    const offset = row?.next_country_offset ?? 0;
    const batch = countryBatchForRun(offset, size);
    await this.database.prepare("UPDATE ingestion_scheduler_state SET next_country_offset = ?, updated_at = ? WHERE id = 'country-rotation'")
      .bind(offset >= 1_000_000 ? 0 : offset + 1, now).run();
    return batch;
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
