# Production D1 migrations and deployment

Keep this order: **apply production D1 migrations → verify migration success → deploy the application → run/enable the revised ingestion workflow**. Keep the current workflow until the database and application are ready. Do not change repository secrets or branch protection for this release.

`0001_parallel_martin_li.sql` creates the distributed quota, logical ingestion request and operation lease tables. `0002_ingestion_retries.sql` only adds constant-default attempt/fencing fields, a saved plan and a terminal-failure marker to the ingestion control tables. Neither changes or recreates news data tables. Applied SQL files and matching Drizzle metadata are immutable; subsequent changes require new migrations. Use a migration ledger, never manually replay SQL files or use `drizzle-kit push` on production.

## Existing Sites deployment (normal path)

This repository declares `d1: "DB"` in `.openai/hosting.json` and uses `sites()` in `vite.config.ts`. The installed `@openai/sites-vite-plugin` copies `drizzle/**` into `dist/.openai/drizzle/**`; the Sites packaging helper includes those files with the Worker. The Sites 0.1.57 persistence contract explicitly states that migrations are **applied and recorded individually before Worker upload**. This establishes the migration-before-application gate; the presence of a `DB` binding alone would not establish it.

1. Run `npm run db:check`, the application checks, and both builds. Inspect the new SQL and confirm `dist/.openai/drizzle` contains the complete SQL/metadata chain. Save a Sites version built from that exact source and package it with the Sites helper.
2. Publish that saved version to the existing Site. Sites applies pending migrations to its existing `DB` and verifies each successful application through its migration ledger before uploading the Worker. A migration error blocks Worker upload. Do not keep retrying a deterministic SQL error: inspect the failure and establish which migrations were applied. A failed publication can leave earlier migrations applied.
3. Require a successful deployment status, then use the Sites database overview and table viewer to verify `api_rate_limit`, `ingestion_logical_request` and `ingestion_operation_lock`. The logical request table must include `attempts`, `attempt_token`, `plan_json`, `terminal_failure`; the lock must include `attempt_token`. Check `/api/health` as an application smoke test. Health alone does not prove migration success.
4. Only after those checks, merge/enable the revised ingestion workflow or manually run it. Inspect its per-scope results; retain the existing HMAC secret and nonce protection.

The managed publish operation performs migration, verification and Worker upload in that sequence; it does not expose a separate migration-only API. On 2026-09-08, the live Sites database overview confirmed all three `0001` tables in the existing `DB`. Every release still requires verification of its newly added columns.

## Wrangler path with authorized production access

`wrangler.jsonc` is **local-only** and its database ID must never be used with `--remote`. Sites controls the physical production mapping and credentials. Use this path only if the platform/operator supplies an authorized Wrangler **JSON** config for that same existing production `DB`, with a compatible existing migration ledger. Do not invent a database ID, create another database, or substitute a new ledger for an existing one. If Sites does not provide this access, use its managed path above.

The supplied config must have one top-level `d1_databases` entry whose binding matches `.openai/hosting.json`, the real existing database name/ID, and `migrations_dir` pointing to this checkout's `drizzle` directory (resolved relative to that config). Preserve its `migrations_table` when configured. Keep credentials in the existing Wrangler login/environment, not the config or repository. The script rejects missing mapping, the checked-in placeholder, another binding, or another migration directory before calling Wrangler.

```powershell
# Use the operator-supplied config; do not copy the local placeholder into it.
$env:NEWS_PRODUCTION_WRANGLER_CONFIG = 'C:\authorized-configs\world-news-atlas.production.json'
npm run db:migrate:production
npm run db:verify:production
```

The first command lists then applies pending migrations using `wrangler d1 migrations apply DB --remote --config <supplied-config>`. It verifies every checked-in SQL filename in the configured migration ledger and queries the required schema. The second repeats only those verification reads. Any failure exits nonzero: stop before deploying the application. Once both succeed, deploy the validated application to the same existing Site, verify deployment success, then run/enable revised ingestion. Do not alternate Sites and Wrangler migration ledgers unless the platform confirms they are compatible.

Normal Wrangler migration application skips recorded files, rolls back a failed migration, and retains earlier successful migrations. The additive schema remains compatible with the prior Worker if a later deployment step fails; do not roll back by dropping columns or tables.
