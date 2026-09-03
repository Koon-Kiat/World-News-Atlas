CREATE TABLE `article_country` (
	`article_id` text NOT NULL,
	`country_code` text(2) NOT NULL,
	`relevance_score` real DEFAULT 0.5 NOT NULL,
	PRIMARY KEY(`article_id`, `country_code`),
	FOREIGN KEY (`article_id`) REFERENCES `article`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`country_code`) REFERENCES `country`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `article_country_country_idx` ON `article_country` (`country_code`,`article_id`);--> statement-breakpoint
CREATE TABLE `article_provider_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_article_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `article`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_provider_ref_unique` ON `article_provider_ref` (`provider`,`provider_article_id`);--> statement-breakpoint
CREATE INDEX `article_provider_ref_article_idx` ON `article_provider_ref` (`article_id`);--> statement-breakpoint
CREATE TABLE `article_topic` (
	`article_id` text NOT NULL,
	`topic_id` text NOT NULL,
	PRIMARY KEY(`article_id`, `topic_id`),
	FOREIGN KEY (`article_id`) REFERENCES `article`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `article_topic_topic_idx` ON `article_topic` (`topic_id`,`article_id`);--> statement-breakpoint
CREATE TABLE `article` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_article_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`image_url` text,
	`published_at` text NOT NULL,
	`language` text(12) NOT NULL,
	`source_id` text NOT NULL,
	`importance_score` real DEFAULT 0.5 NOT NULL,
	`relevance_score` real DEFAULT 0.5 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_canonical_url_unique` ON `article` (`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `article_provider_article_unique` ON `article` (`provider`,`provider_article_id`);--> statement-breakpoint
CREATE INDEX `article_published_idx` ON `article` (`published_at`);--> statement-breakpoint
CREATE INDEX `article_source_published_idx` ON `article` (`source_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `article_language_published_idx` ON `article` (`language`,`published_at`);--> statement-breakpoint
CREATE TABLE `country` (
	`code` text(2) PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingestion_request_nonce` (
	`nonce` text PRIMARY KEY NOT NULL,
	`received_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ingestion_request_nonce_expiry_idx` ON `ingestion_request_nonce` (`expires_at`);--> statement-breakpoint
CREATE TABLE `ingestion_scheduler_state` (
	`id` text PRIMARY KEY NOT NULL,
	`next_country_offset` integer DEFAULT 0 NOT NULL,
	`last_run_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_ingestion_checkpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`discovery_key` text NOT NULL,
	`country_code` text(2),
	`language` text(12),
	`mode` text(24) DEFAULT 'incremental' NOT NULL,
	`status` text DEFAULT 'RUNNING' NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`covered_from` text,
	`covered_to` text,
	`cursor` text,
	`exhausted` integer DEFAULT false NOT NULL,
	`coverage_complete` integer DEFAULT false NOT NULL,
	`received_count` integer DEFAULT 0 NOT NULL,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`last_successful_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingestion_checkpoint_provider_discovery_unique` ON `provider_ingestion_checkpoint` (`provider`,`discovery_key`);--> statement-breakpoint
CREATE INDEX `ingestion_checkpoint_country_window_idx` ON `provider_ingestion_checkpoint` (`country_code`,`window_start`,`window_end`);--> statement-breakpoint
CREATE INDEX `ingestion_checkpoint_status_updated_idx` ON `provider_ingestion_checkpoint` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `provider_ingestion_run` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`discovery_key` text DEFAULT 'global' NOT NULL,
	`country_code` text(2),
	`language` text(12),
	`mode` text(24) DEFAULT 'incremental' NOT NULL,
	`status` text DEFAULT 'RUNNING' NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`window_start` text,
	`window_end` text,
	`cursor` text,
	`exhausted` integer DEFAULT false NOT NULL,
	`coverage_complete` integer DEFAULT false NOT NULL,
	`last_successful_at` text,
	`received_count` integer DEFAULT 0 NOT NULL,
	`normalized_count` integer DEFAULT 0 NOT NULL,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`out_of_window_count` integer DEFAULT 0 NOT NULL,
	`irrelevant_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`stored_count` integer DEFAULT 0 NOT NULL,
	`stories_updated` integer DEFAULT 0 NOT NULL,
	`error_code` text
);
--> statement-breakpoint
CREATE INDEX `ingestion_run_provider_started_idx` ON `provider_ingestion_run` (`provider`,`started_at`);--> statement-breakpoint
CREATE INDEX `ingestion_run_discovery_started_idx` ON `provider_ingestion_run` (`provider`,`discovery_key`,`started_at`);--> statement-breakpoint
CREATE INDEX `ingestion_run_country_window_idx` ON `provider_ingestion_run` (`country_code`,`window_start`,`window_end`);--> statement-breakpoint
CREATE TABLE `source_provider_identifier` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`provider` text NOT NULL,
	`identifier` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_provider_identifier_unique` ON `source_provider_identifier` (`provider`,`identifier`);--> statement-breakpoint
CREATE INDEX `source_provider_source_idx` ON `source_provider_identifier` (`source_id`);--> statement-breakpoint
CREATE TABLE `source` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`country_code` text(2),
	`region` text,
	`language` text(12),
	`scope` text NOT NULL,
	`quality_score` real DEFAULT 0.7 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`country_code`) REFERENCES `country`(`code`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_domain_unique` ON `source` (`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_name_country_unique` ON `source` (`name`,`country_code`);--> statement-breakpoint
CREATE INDEX `source_country_scope_idx` ON `source` (`country_code`,`scope`);--> statement-breakpoint
CREATE TABLE `story` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`first_published_at` text NOT NULL,
	`last_updated_at` text NOT NULL,
	`importance_score` real DEFAULT 0.5 NOT NULL,
	`cluster_score` real DEFAULT 0.5 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_fingerprint_unique` ON `story` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `story_last_updated_idx` ON `story` (`last_updated_at`);--> statement-breakpoint
CREATE INDEX `story_importance_updated_idx` ON `story` (`importance_score`,`last_updated_at`);--> statement-breakpoint
CREATE TABLE `story_article` (
	`story_id` text NOT NULL,
	`article_id` text NOT NULL,
	PRIMARY KEY(`story_id`, `article_id`),
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `article`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_article_article_idx` ON `story_article` (`article_id`);--> statement-breakpoint
CREATE TABLE `story_country` (
	`story_id` text NOT NULL,
	`country_code` text(2) NOT NULL,
	`relevance_score` real DEFAULT 0.5 NOT NULL,
	PRIMARY KEY(`story_id`, `country_code`),
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`country_code`) REFERENCES `country`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_country_country_idx` ON `story_country` (`country_code`,`story_id`);--> statement-breakpoint
CREATE TABLE `story_topic` (
	`story_id` text NOT NULL,
	`topic_id` text NOT NULL,
	PRIMARY KEY(`story_id`, `topic_id`),
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_topic_topic_idx` ON `story_topic` (`topic_id`,`story_id`);--> statement-breakpoint
CREATE TABLE `topic` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topic_slug_unique` ON `topic` (`slug`);