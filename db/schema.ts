import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const countries = sqliteTable("country", {
  code: text("code", { length: 2 }).primaryKey(),
  name: text("name").notNull(),
  ...timestamps,
});

export const sources = sqliteTable("source", {
  id: text("id").primaryKey(), name: text("name").notNull(), domain: text("domain").unique(),
  countryCode: text("country_code", { length: 2 }).references(() => countries.code, { onDelete: "set null" }),
  region: text("region"), language: text("language", { length: 12 }),
  scope: text("scope", { enum: ["LOCAL", "REGIONAL", "NATIONAL", "INTERNATIONAL"] }).notNull(),
  qualityScore: real("quality_score").notNull().default(0.7),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true), ...timestamps,
}, (table) => [
  uniqueIndex("source_name_country_unique").on(table.name, table.countryCode),
  index("source_country_scope_idx").on(table.countryCode, table.scope),
]);

export const sourceProviderIdentifiers = sqliteTable("source_provider_identifier", {
  id: text("id").primaryKey(), sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), identifier: text("identifier").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("source_provider_identifier_unique").on(table.provider, table.identifier),
  index("source_provider_source_idx").on(table.sourceId),
]);

export const articles = sqliteTable("article", {
  id: text("id").primaryKey(), provider: text("provider").notNull(),
  providerArticleId: text("provider_article_id").notNull(), title: text("title").notNull(),
  description: text("description"), url: text("url").notNull(), canonicalUrl: text("canonical_url").notNull().unique(),
  imageUrl: text("image_url"), publishedAt: text("published_at").notNull(), language: text("language", { length: 12 }).notNull(),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
  importanceScore: real("importance_score").notNull().default(0.5), relevanceScore: real("relevance_score").notNull().default(0.5),
  ...timestamps,
}, (table) => [
  uniqueIndex("article_provider_article_unique").on(table.provider, table.providerArticleId),
  index("article_published_idx").on(table.publishedAt),
  index("article_source_published_idx").on(table.sourceId, table.publishedAt),
  index("article_language_published_idx").on(table.language, table.publishedAt),
]);

export const articleProviderRefs = sqliteTable("article_provider_ref", {
  id: text("id").primaryKey(), articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), providerArticleId: text("provider_article_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("article_provider_ref_unique").on(table.provider, table.providerArticleId),
  index("article_provider_ref_article_idx").on(table.articleId),
]);

export const articleCountries = sqliteTable("article_country", {
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  countryCode: text("country_code", { length: 2 }).notNull().references(() => countries.code, { onDelete: "cascade" }),
  relevanceScore: real("relevance_score").notNull().default(0.5),
}, (table) => [primaryKey({ columns: [table.articleId, table.countryCode] }), index("article_country_country_idx").on(table.countryCode, table.articleId)]);

export const topics = sqliteTable("topic", {
  id: text("id").primaryKey(), slug: text("slug").notNull().unique(), label: text("label").notNull(), ...timestamps,
});
export const articleTopics = sqliteTable("article_topic", {
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.articleId, table.topicId] }), index("article_topic_topic_idx").on(table.topicId, table.articleId)]);

export const stories = sqliteTable("story", {
  id: text("id").primaryKey(), fingerprint: text("fingerprint").notNull().unique(), title: text("title").notNull(), summary: text("summary"),
  firstPublishedAt: text("first_published_at").notNull(), lastUpdatedAt: text("last_updated_at").notNull(),
  importanceScore: real("importance_score").notNull().default(0.5), clusterScore: real("cluster_score").notNull().default(0.5), ...timestamps,
}, (table) => [index("story_last_updated_idx").on(table.lastUpdatedAt), index("story_importance_updated_idx").on(table.importanceScore, table.lastUpdatedAt)]);
export const storyArticles = sqliteTable("story_article", {
  storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.storyId, table.articleId] }), index("story_article_article_idx").on(table.articleId)]);
export const storyCountries = sqliteTable("story_country", {
  storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
  countryCode: text("country_code", { length: 2 }).notNull().references(() => countries.code, { onDelete: "cascade" }),
  relevanceScore: real("relevance_score").notNull().default(0.5),
}, (table) => [primaryKey({ columns: [table.storyId, table.countryCode] }), index("story_country_country_idx").on(table.countryCode, table.storyId)]);
export const storyTopics = sqliteTable("story_topic", {
  storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.storyId, table.topicId] }), index("story_topic_topic_idx").on(table.topicId, table.storyId)]);

export const providerIngestionRuns = sqliteTable("provider_ingestion_run", {
  id: text("id").primaryKey(), provider: text("provider").notNull(), discoveryKey: text("discovery_key").notNull().default("global"),
  countryCode: text("country_code", { length: 2 }), language: text("language", { length: 12 }), mode: text("mode", { length: 24 }).notNull().default("incremental"),
  status: text("status").notNull().default("RUNNING"), startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`), completedAt: text("completed_at"),
  windowStart: text("window_start"), windowEnd: text("window_end"), cursor: text("cursor"),
  exhausted: integer("exhausted", { mode: "boolean" }).notNull().default(false), coverageComplete: integer("coverage_complete", { mode: "boolean" }).notNull().default(false),
  lastSuccessfulAt: text("last_successful_at"), receivedCount: integer("received_count").notNull().default(0), normalizedCount: integer("normalized_count").notNull().default(0),
  acceptedCount: integer("accepted_count").notNull().default(0), outOfWindowCount: integer("out_of_window_count").notNull().default(0),
  irrelevantCount: integer("irrelevant_count").notNull().default(0), duplicateCount: integer("duplicate_count").notNull().default(0),
  storedCount: integer("stored_count").notNull().default(0), storiesUpdated: integer("stories_updated").notNull().default(0), errorCode: text("error_code"),
}, (table) => [
  index("ingestion_run_provider_started_idx").on(table.provider, table.startedAt),
  index("ingestion_run_discovery_started_idx").on(table.provider, table.discoveryKey, table.startedAt),
  index("ingestion_run_country_window_idx").on(table.countryCode, table.windowStart, table.windowEnd),
]);

export const providerIngestionCheckpoints = sqliteTable("provider_ingestion_checkpoint", {
  id: text("id").primaryKey(), provider: text("provider").notNull(), discoveryKey: text("discovery_key").notNull(),
  countryCode: text("country_code", { length: 2 }), language: text("language", { length: 12 }), mode: text("mode", { length: 24 }).notNull().default("incremental"),
  status: text("status").notNull().default("RUNNING"), windowStart: text("window_start").notNull(), windowEnd: text("window_end").notNull(),
  coveredFrom: text("covered_from"), coveredTo: text("covered_to"), cursor: text("cursor"),
  exhausted: integer("exhausted", { mode: "boolean" }).notNull().default(false), coverageComplete: integer("coverage_complete", { mode: "boolean" }).notNull().default(false),
  receivedCount: integer("received_count").notNull().default(0), acceptedCount: integer("accepted_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0), lastSuccessfulAt: text("last_successful_at"), ...timestamps,
}, (table) => [
  uniqueIndex("ingestion_checkpoint_provider_discovery_unique").on(table.provider, table.discoveryKey),
  index("ingestion_checkpoint_country_window_idx").on(table.countryCode, table.windowStart, table.windowEnd),
  index("ingestion_checkpoint_status_updated_idx").on(table.status, table.updatedAt),
]);

export const ingestionSchedulerState = sqliteTable("ingestion_scheduler_state", {
  id: text("id").primaryKey(), nextCountryOffset: integer("next_country_offset").notNull().default(0),
  lastRunAt: text("last_run_at"), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const ingestionRequestNonces = sqliteTable("ingestion_request_nonce", {
  nonce: text("nonce").primaryKey(), receivedAt: text("received_at").notNull(), expiresAt: text("expires_at").notNull(),
}, (table) => [index("ingestion_request_nonce_expiry_idx").on(table.expiresAt)]);

export const apiRateLimits = sqliteTable("api_rate_limit", {
  clientKey: text("client_key").primaryKey(), count: integer("count").notNull(), resetAt: integer("reset_at").notNull(),
}, (table) => [index("api_rate_limit_expiry_idx").on(table.resetAt)]);

export const ingestionLogicalRequests = sqliteTable("ingestion_logical_request", {
  requestId: text("request_id").primaryKey(), bodyDigest: text("body_digest").notNull(), state: text("state").notNull(),
  summaryJson: text("summary_json"), leaseUntil: integer("lease_until").notNull(), expiresAt: integer("expires_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("ingestion_logical_expiry_idx").on(table.expiresAt), index("ingestion_logical_state_lease_idx").on(table.state, table.leaseUntil)]);
export const ingestionOperationLock = sqliteTable("ingestion_operation_lock", {
  id: text("id").primaryKey(), requestId: text("request_id").notNull(), leaseUntil: integer("lease_until").notNull(),
});
