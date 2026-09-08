ALTER TABLE `ingestion_logical_request` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ingestion_logical_request` ADD `attempt_token` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `ingestion_logical_request` ADD `plan_json` text;--> statement-breakpoint
ALTER TABLE `ingestion_logical_request` ADD `terminal_failure` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ingestion_operation_lock` ADD `attempt_token` text DEFAULT '' NOT NULL;