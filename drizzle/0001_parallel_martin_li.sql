CREATE TABLE `api_rate_limit` (
	`client_key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `api_rate_limit_expiry_idx` ON `api_rate_limit` (`reset_at`);--> statement-breakpoint
CREATE TABLE `ingestion_logical_request` (
	`request_id` text PRIMARY KEY NOT NULL,
	`body_digest` text NOT NULL,
	`state` text NOT NULL,
	`summary_json` text,
	`lease_until` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ingestion_logical_expiry_idx` ON `ingestion_logical_request` (`expires_at`);--> statement-breakpoint
CREATE INDEX `ingestion_logical_state_lease_idx` ON `ingestion_logical_request` (`state`,`lease_until`);--> statement-breakpoint
CREATE TABLE `ingestion_operation_lock` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`lease_until` integer NOT NULL
);
