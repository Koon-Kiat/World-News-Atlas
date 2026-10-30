# Deployment and rollback

[Documentation index](../README.md)

Deploy in this order: **apply D1 migrations → verify schema → publish the matching Worker → enable/run the matching ingestion workflow**. A GitHub merge does not deploy the Site. Scheduler changes take effect from the workflow checkout, so coordinate changes that depend on new server behavior.

This is a runbook, not a claim that the current checkout has been deployed. Record the source revision, saved Site version, migration results and ingestion run when executing a release.

## Preflight

1. Review the intended source revision and pending SQL. Applied migrations and matching Drizzle metadata are immutable; add new migrations rather than modifying existing ones.
2. Run `npm ci`, `npm run db:check`, `npm run check`, `npm run build` and `npm audit --audit-level=high`. Also run `npm run build:next` for native Next.js compatibility, then rebuild with `npm run build` before packaging the Sites artifact.
3. Preserve the existing Site, `DB` binding, secrets and news corpus. If the scheduler requires the new schema or Worker, keep that scheduler change disabled until the deployment gates pass.

## Sites-managed path

The repository declares the logical `DB` binding in [.openai/hosting.json](../../.openai/hosting.json) and enables the Sites plugin in [vite.config.ts](../../vite.config.ts). The checked-in Wrangler database ID is a local placeholder, not a production target.

1. Build and package the exact release with the available Sites packaging workflow. Inspect `dist/.openai/drizzle/` for the full SQL and metadata chain. Save a version for the existing Site.
2. Before publishing, confirm the active Sites tooling applies and records pending migrations before Worker upload. The repository cannot establish the behavior of a future hosting-tool version by itself. If that ordering cannot be confirmed, stop the release until a supported migration path is available.
3. Publish the saved version. Require a successful deployment result and inspect migration failures before retrying: an interrupted publication may leave earlier migrations applied.
4. Verify the actual schema and application as described below, then run or enable the matching ingestion workflow.

## Required schema verification

Verify the migration ledger and actual columns; a `DB` binding or healthy endpoint alone proves neither.

| Migration | Contract |
| --- | --- |
| `0000_world_news_d1.sql` | News entities, provider runs, coverage checkpoints, scheduler state and nonce storage |
| `0001_parallel_martin_li.sql` | `api_rate_limit`, `ingestion_logical_request`, `ingestion_operation_lock` |
| `0002_ingestion_retries.sql` | Request retry/attempt/plan fields and lock attempt token |
| `0003_provider_rate_control.sql` | Shared provider pacing and cooldown |
| `0004_ingestion_retry_deadline.sql` | Logical request `retry_at` |

The production verifier probes these fields:

| Table | Required probe columns |
| --- | --- |
| `api_rate_limit` | `client_key`, `count`, `reset_at` |
| `ingestion_logical_request` | `attempts`, `attempt_token`, `plan_json`, `terminal_failure`, `retry_at` |
| `ingestion_operation_lock` | `attempt_token`, `lease_until` |
| `provider_request_control` | `provider`, `next_request_at`, `cooldown_until`, `failures`, `last_failure_at` |

Use the existing hosting database inspection capability or the authorized Wrangler verifier below. Do not manually replay SQL files or use `drizzle-kit push` against production.

## Authorized Wrangler path

Use this only when the platform/operator supplies a Wrangler **JSON** configuration for the same existing production `DB` and a compatible migration ledger. Otherwise use the managed deployment path. Never send the checked-in local placeholder to `--remote`, invent a database ID, create a replacement database or substitute a new ledger.

The supplied configuration must identify exactly one top-level D1 entry matching the hosting binding, with its real database name/ID and a `migrations_dir` resolving to this checkout's `drizzle/`. Preserve `migrations_table` when configured. Keep credentials in the existing Wrangler login/environment, outside the repository.

```powershell
$env:NEWS_PRODUCTION_WRANGLER_CONFIG = 'C:\authorized-configs\world-news-atlas.production.json'
npm run db:migrate:production
npm run db:verify:production
```

The first command lists and applies pending migrations, verifies every checked-in SQL filename in the configured ledger and probes required columns. The second performs only the verification reads. The script rejects missing mapping, the local placeholder, another binding, a different migration directory or a custom migration filename pattern before invoking Wrangler. Any failure blocks application deployment. Do not alternate Sites and Wrangler migration ledgers without confirming compatibility.

## Release acceptance

1. Record the successful deployment and its exact source revision/version.
2. Confirm the migration ledger and schema probes above, then check `/api/health` returns `{"status":"ok"}`.
3. Inspect representative country/comparison API responses and browser views.
4. Dispatch `24h` ingestion and inspect all three named passes. Inspect a `30d` run as well when changing archive behavior, and observe the subsequent scheduled run.
5. Check provider codes, cooldowns, persisted counts and checkpoints. `DEGRADED` is accepted only under the [ingestion outcome policy](ingestion.md); zero stored articles do not prove new coverage. Verify logical-ID replay with fresh authentication when changing idempotency behavior.

Keep provider credentials in Sites. GitHub needs only the ingestion URL, shared HMAC secret and, for a private Site, its access-gate token. After changing a runtime secret, republish and verify the effective configuration. Clearing an optional credential explicitly is safer than assuming deletion of a settings entry removes an older deployed value.

## Rollback

Pause ingestion while changing incompatible Worker/scheduler versions. Preserve the database, new columns, checkpoints and request history. Older Workers may not understand `DEGRADED`, `RETRY_BUDGET_EXHAUSTED`, `retry_at` or shared provider cooldowns even though the migrations are additive.

Restore a compatible Worker/scheduler pair, repeat schema/application checks, then resume ingestion with new logical IDs for new operator runs. Do not rewrite completed request states or drop tables to make old code accept them. Final request records expire through the existing seven-day retention policy.

Implementation: [production migration guard](../../scripts/migrate-production.mjs), [schema](../../db/schema.ts), [migration journal](../../drizzle/meta/_journal.json), [ingestion workflow](../../.github/workflows/news-ingestion.yml).
