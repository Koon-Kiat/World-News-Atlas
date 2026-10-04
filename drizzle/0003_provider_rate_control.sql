CREATE TABLE `provider_request_control` (
	`provider` text PRIMARY KEY NOT NULL,
	`next_request_at` integer NOT NULL,
	`cooldown_until` integer NOT NULL,
	`failures` integer NOT NULL,
	`last_failure_at` integer NOT NULL
);
