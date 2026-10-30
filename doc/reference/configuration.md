# Configuration

[Documentation index](../README.md)

The [.env.example](../../.env.example) template covers application settings. Keep credentials server-side and out of source control. Optional providers are configured by operators; visitors do not configure them.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEWS_INGEST_HMAC_SECRET` | Hosted ingestion | Server-only random secret shared with the GitHub workflow; use at least 32 characters. |
| `NEWSAPI_KEY` | No | Enables NewsAPI ingestion. Missing credentials disable only this adapter. |
| `GDELT_MODE` | No | `auto` (default) enables credential-free GDELT for 7d/30d country requests; `on` enables it wherever appropriate; `off` disables it. |
| `NEWS_GDELT_TIMEOUT_MS` | No | GDELT request timeout; defaults to 30,000 ms and is bounded to 8,000–30,000 ms. Other providers retain their general timeout. |
| `GDELT_ENABLED` | No | Legacy compatibility switch used only when `GDELT_MODE` is unset. |
| `NEWS_FIXTURES_ENABLED` | No | Enables browsing fixture fallback when live discovery returns no stories; defaults to `false`. Does not enable fixtures in ingestion CLI runs. Keep disabled in production. |
| `NEWS_PROVIDER_TIMEOUT_MS` | No | External request timeout, clamped to 2–30 seconds; defaults to 8 seconds. |
| `NEWS_LIVE_STAGE_TIMEOUT_MS` | No | Whole live-discovery stage deadline, clamped to 2.5–12 seconds; defaults to at most 6.5 seconds so a stalled provider cannot hold the response open. |
| `NEWS_LIVE_BATCH_SIZE` | No | Maximum **new** provider articles normalized in one bounded discovery stage; defaults to 96 and is clamped to 24–150. |
| `NEWS_LIVE_CORPUS_LIMIT` | No | Absolute accumulated **relevant** corpus safety cap; defaults to 1,000 and is clamped to 200–2,000. |
| `NEWS_LIVE_CORPUS_LIMIT_24H`, `_3D`, `_7D`, `_30D` | No | Period-aware relevant corpus defaults: 360, 500, 750, and 1,000, each bounded by the absolute cap. |
| `NEWS_LIVE_LOW_WATER` | No | Matching-story buffer threshold that can trigger another bounded stage; defaults to 24 and is clamped to 12–60. |
| `NEWS_LIVE_ARTICLE_LIMIT` | Deprecated | Compatibility alias used only as `NEWS_LIVE_BATCH_SIZE` when the new variable is unset. It no longer limits the accumulated corpus. |
| `NEWS_DATABASE_CANDIDATE_LIMIT` | No | Maximum matching stored-story candidate pool before application ranking; defaults to 1,000 and is clamped to 300–5,000. |
| `NEWS_DATABASE_FRESHNESS_MINUTES` | No | Maximum checkpoint age used to prove stored coverage is fresh; defaults to 120 minutes, bounded to 15–360. |
| `NEWS_INGESTION_STAGE_LIMIT` | No | Maximum bounded provider stages in one ingestion worker; defaults to 24, bounded to 1–200. |
| `NEWS_INGESTION_COUNTRY_BATCH_SIZE` | No | Rotating country shard size; defaults to 8, bounded to 1–40, with structured high-volume priority. |
| `NEWS_SEMANTIC_CLUSTERING_ENABLED` | No | Enables the semantic stage when set to `true` and an embedding credential is present. Defaults to deterministic lexical clustering. |
| `NEWS_EMBEDDING_API_KEY` or `OPENAI_API_KEY` | When semantic clustering is enabled | Server-only credential for the configured OpenAI embedding adapter. The project-specific variable takes precedence when both are set. |
| `NEWS_EMBEDDING_MODEL` | No | Embedding model name; defaults to `text-embedding-3-small`. |
| `NEWS_EMBEDDING_TIMEOUT_MS` | No | Embedding request timeout, clamped to 1–15 seconds; defaults to 5 seconds. |
| `RSS_FEEDS_JSON` | No | JSON array of server-controlled, rights-reviewed RSS/Atom feed definitions. |

There are intentionally no `NEXT_PUBLIC_` provider variables.

## Operator and diagnostic variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEWS_INGEST_URL` | GitHub Actions scheduler | HTTPS URL of the deployed `/api/internal/ingest/run` endpoint. |
| `OAI_SITES_BYPASS_TOKEN` | GitHub Actions scheduler | Access-gate token when the existing Site is owner-only; HMAC authentication is still required. |
| `NEWS_PRODUCTION_WRANGLER_CONFIG` | Production migration script | Path to an authorized JSON configuration for the existing production `DB`; see [deployment](../operations/deployment.md). |
| `NEWS_DIAGNOSTIC_QUIET` | Structured logger | Set to `true` to suppress structured news logs; the coverage CLI also supports `--quiet`. |

The workflow supplies `PERIOD`, `INGESTION_SCHEDULE`, `GITHUB_EVENT_NAME`, `GITHUB_RUN_ID` and `GITHUB_STEP_SUMMARY` to the scheduler. Manual workflow dispatch is the supported way to choose a hosted ingestion period.

`latest` means the past three days and uses `NEWS_LIVE_CORPUS_LIMIT_3D`. Period-specific corpus limits are also bounded to 200–2,000 and cannot exceed the absolute limit. The scheduled workflow explicitly requests four stages. The effective country batch is the smaller of the configured batch and the stage budget divided by the configured provider count, with a minimum of one country.

An empty `NEWSAPI_KEY` disables that adapter. `RSS_FEEDS_JSON` replaces, rather than extends, the default list; `[]` disables RSS and an unset/empty value uses defaults. Invalid RSS JSON or GDELT mode values fail configuration checks. See [providers](providers.md) for the feed shape and [ingestion](../operations/ingestion.md) for failure handling.

After changing a hosted runtime secret, publish a version and verify the effective configuration through ingestion. Do not assume deleting a settings entry clears a value already present on a deployed Worker; explicitly clear an optional credential when disabling it.

Implementation: [provider configuration](../../src/lib/news/providers/index.ts), [live discovery limits](../../src/lib/news/data-store.ts), [ingestion limits](../../src/lib/news/ingest.ts), [embedding configuration](../../src/lib/news/embeddings.ts).
