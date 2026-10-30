# Ingestion and recovery

[Documentation index](../README.md)

## Schedules, authentication and recovery

The workflow uses one job for two schedules: `*/30 * * * *` runs `24h` incremental discovery; `17 2,14 * * *` runs `30d` archive reconciliation at 02:17 and 14:17 UTC (10:17 and 22:17 Singapore time). Manual dispatch supports `latest`, `24h`, `7d`, and `30d`; the first two use incremental mode and the latter two use backfill mode. GitHub schedule delivery can be delayed.

The named passes are `global-discovery`, `country-rotation-first`, and `country-rotation-next`. The two country passes reserve different persisted rotating batches. Incremental and backfill rotations have separate counters, so frequent discovery cannot consume the archive rotation. A batch of one alternates high-volume and other countries. Every request signs a stable logical ID derived from workflow run ID, pass name and period. Re-running the same workflow run retains those IDs; retries use fresh timestamps and nonces.

## Outcomes and durable state

Central policy distinguishes four outcomes:

| Outcome | Acceptance | HTTP / workflow |
|---|---|---|
| SUCCESS | Storage succeeded and useful work or a legitimate successful empty stage completed; no provider failures | 200 / success |
| DEGRADED | The same storage/invariant/usefulness requirements hold; only transient optional provider failures remain | 200 / success, with affected providers, error codes and cooldown in the summary |
| RETRYABLE_FAILURE | No useful provider result, temporary storage/runtime failure, timeout or lost lease | 503 / bounded retries, then workflow failure |
| TERMINAL_FAILURE | Authentication/configuration/schema/state/invariant faults, terminal response/query errors, or credentials such as NewsAPI 401; explicit public-feed errors follow the degraded policy | Non-retryable 4xx or 422 / workflow failure |

The durable states are `RUNNING`, `SUCCEEDED`, `DEGRADED`, `FAILED_RETRYABLE`, `RETRY_BUDGET_EXHAUSTED`, and `FAILED_TERMINAL`. Three operation attempts exhaust the current logical request's budget; they do not turn a transient provider condition into a permanent error. Exhaustion returns 503 with `retryEligible: false`. A later scheduled run has a new ID and can recover. Final records are retained for seven days; cleanup is bounded. Legacy `FAILED` records and expired legacy attempts remain terminal. Reusing an ID with different signed input is rejected.

The route keeps the 180-second lease, renewal during work, 150-second execution budget, HMAC validation, bounded body and atomic nonce claim. Unique attempt tokens fence plans and request completion. Every production ingestion data/checkpoint/stage/rotation batch also checks the current lock token and lease inside the D1 transaction; a stale worker cannot write between a JavaScript ownership check and a database mutation. Country scope and snapshot are pinned before provider writes. Retries resume saved cursors and skip completed checkpoints. Corrupt plans/cursors fail explicitly. Re-ingestion preserves story members absent from the current provider batch.

## Retry ownership and deadlines

Providers classify failures and preserve partial branch progress; they do not loop on transient errors. NewsAPI retains one semantic HTTP 400 fallback without hosted date parameters. The logical operation owns durable resume. The scheduler owns transport retries (three failures per pass) and time-bounded status polling, honoring server cooldowns. A pass may start requests for six minutes (enough for an orphaned attempt's 180-second lease to expire and a retried 150-second operation to finish), and the three passes share a 20-minute budget. Connections have a ten-second budget and every request gets the full 165 seconds: the scheduler never starts a request it cannot wait for, because an abandoned operation keeps the ingestion lock and makes the next pass see BUSY. Each request is logged with its elapsed time and result; the workflow has a 25-minute setup/run limit. A required delay that cannot fit ends that pass without sending an early retry. Later passes still run within the job budget. Any failed pass makes the workflow fail.

The shared Retry-After parser accepts delay-seconds and HTTP dates, rejects malformed values, clamps past dates to zero, and caps delays at 15 minutes. Missing/malformed values use exponential backoff starting at 30 seconds plus up to one second of positive jitter. The cap is explicit protection against unreasonable upstream values; expiry does not promise upstream recovery. Endpoint responses round cooldowns up to seconds. Provider bodies are bounded and their abort signal stays active through body consumption. Ingestion retries bypass cached failures; successful results and in-flight work remain coalesced.

GDELT follows the configured `auto`/`on`/`off` policy. A shared D1 row coordinates its 5.5-second request-start spacing and 429/503 cooldown across live discovery and ingestion Workers. Reservations expire without cleanup or a queue; updates cannot shorten another worker's cooldown. Missing Retry-After uses a shared exponential failure streak that resets after a quiet interval. GDELT processes branches sequentially within a 31-second stage budget, beneath the 32-second ingestion provider deadline, and stops starting branches after failure. Successful branch cursors survive; failed branches remain pending. Its separate request timeout defaults to 30 seconds. Production requires D1 coordination; development/tests can use memory. English-index query terms and original-language/publisher filters remain in use; recognized HTTP-200 query rejections remain terminal.

Actions summaries show SUCCESS, DEGRADED or FAILED, named pass, request/operation attempts, stored article/story counts, processed stages, provider codes, cooldown and duration. Inspect the provider code first: 429/503/timeouts indicate transient upstream trouble. Public RSS denials and malformed responses use PUBLIC_FEED_UNAVAILABLE and PUBLIC_FEED_INVALID_RESPONSE and can degrade a productive pass; generic HTTP_401/HTTP_403, INVALID_QUERY, INVALID_RESPONSE and INVALID_CONFIGURATION remain terminal and require repair. STORAGE_UNAVAILABLE and LEASE_LOST are not degraded success; INVALID_STATE requires schema/state investigation. Follow [deployment order](deployment.md) before enabling workflow changes that depend on new server behavior or schema.

After changing a Sites runtime secret, publish a saved version and verify the effective provider configuration through ingestion. Clearing `NEWSAPI_KEY` to an empty value explicitly disables that optional provider; deleting the settings entry alone can leave an older deployed Worker secret active. Invalid RSS JSON or GDELT mode values now fail configuration checks instead of silently selecting defaults.

## Commands and pipeline

Run a local provider dry run with:

```powershell
npm run ingest:news
npm run ingest:backfill -- --period=30d
npm run ingest:backfill -- --country=US --period=30d --stages=48
```

The production path is `.github/workflows/news-ingestion.yml`. Every 30 minutes it sends three sequential, independently signed requests (one global and two rotating country passes) to `/api/internal/ingest/run`. Each request is capped at four provider stages so it stays within Sites request limits. D1 preserves checkpoints and country rotation between requests.

The ingestion pipeline:

1. Selects a bounded country and provider discovery shard.
2. Resumes saved Bing plan IDs, RSS feed IDs, NewsAPI pages, or GDELT branch date cursors.
3. Normalizes provider-specific responses.
4. Separates publisher country from mentioned countries.
5. Removes canonical URL and strong headline duplicates.
6. Builds hybrid semantic/lexical story clusters when configured, or deterministic lexical clusters otherwise.
7. Persists articles, provider references, country/topic relations, stories, and checkpoints through the Sites D1 binding.
8. Saves a coverage watermark and run record after every stage, including raw, accepted, out-of-window, irrelevant, duplicate, stored, and story counts without article bodies or secrets.

Without a D1 runtime binding, the local commands fetch, normalize, deduplicate, cluster, and print a dry-run summary. These commands use configured live providers; `NEWS_FIXTURES_ENABLED` controls the browsing fallback and does not enable fixtures in ingestion runs.

Configure repository secrets `NEWS_INGEST_URL` and `NEWS_INGEST_HMAC_SECRET`; configure the same HMAC value in Sites. An owner-only Site also needs `OAI_SITES_BYPASS_TOKEN` so GitHub can pass the Sites access gate before the application verifies the HMAC. The workflow has no database or provider credentials: `NEWSAPI_KEY` remains only in Sites.

Coverage can be inspected without printing article content:

```powershell
npm run diagnose:coverage -- --country=US --period=30d --max-stages=12
npm run smoke:coverage -- --country=JP --period=30d --max-stages=4
```

The smoke command is optional and intentionally excluded from CI because real-provider availability changes.

## Troubleshooting

| Observation | Check and response |
| --- | --- |
| `DEGRADED` with persisted work or a legitimate successful stage | Inspect provider codes and cooldown; this is accepted partial operation, not proof of complete coverage. |
| `PUBLIC_FEED_UNAVAILABLE` / `PUBLIC_FEED_INVALID_RESPONSE` | Inspect the configured public feed. Attempted feeds are retained separately from completed feeds so later publishers can run. |
| No useful provider work | A retryable failure is expected even if all individual errors are transient. Raw fetched articles alone are not useful persisted work. |
| `HTTP_401`, generic `HTTP_403`, `INVALID_CONFIGURATION`, `INVALID_QUERY` | Repair credentials/configuration/query. Do not retry terminal input unchanged. |
| `INVALID_STATE` or a schema error | Compare the deployed Worker, migration ledger and actual columns with the checked-in release. Preserve existing request history. |
| `BUSY` or `LEASE_LOST` | Inspect ownership and request deadlines; wait for the current lease/retry deadline rather than launching overlapping work. |
| `STORAGE_UNAVAILABLE` | Restore D1 availability. Storage failure cannot count as degraded success. |
| `RETRY_BUDGET_EXHAUSTED` | The same logical ID cannot start another operation; a later scheduled run uses a new ID. It is still a failed run. |

A successful empty stage can make a pass legitimate without adding articles. Zero stored articles do not prove new geographic or archive coverage. Observe both the summaries and stored checkpoints.

Implementation: [workflow](../../.github/workflows/news-ingestion.yml), [scheduler](../../scripts/scheduled-ingestion.mjs), [outcome policy](../../src/lib/news/ingestion-outcome.ts), [signed route](../../src/lib/news/ingest-route.ts), [logical requests](../../src/lib/news/ingestion-requests.ts), [shared GDELT control](../../src/lib/news/providers/gdelt-rate-control.ts).
