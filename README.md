# Worldline

Worldline is a production-minded explorer for news coverage from configured providers. It works immediately for an anonymous visitor: global coverage appears with no setup, one selected country shows stories involving that country, and two selected countries surface stories meaningfully related to both. It does not claim to index all news.

Fixture mode is an explicit development option only. Production returns live stories or an honest empty state and never substitutes sample stories for reporting.

## What is implemented

- Responsive D3 world map with hover, click, keyboard selection, deselection, clear selection, and an explicit two-country limit.
- Global, one-country, and two-country exploration.
- Local/international perspective filtering based on publisher country—not article subject.
- Bilateral source filters for first-country, second-country, and outside sources.
- Topic, result-derived language, time, outlet, keyword, and newest/popularity sorting controls.
- Searchable, grouped multi-publisher selection with stable publisher IDs, per-result counts, sticky selected outlets, and display-name compatibility for older API links.
- Story-first results with grouped publisher coverage and links to original live articles.
- Provider adapters for NewsAPI, GDELT, publisher RSS/Atom feeds, and Bing News RSS discovery with original-publisher URL extraction.
- Social-media-style infinite scrolling backed by bounded incremental provider discovery, a 12-story UI reveal batch, and a cached live corpus that can grow past 200 stories without processing it all in one worker invocation.
- Provider-independent source registry and many-to-one provider identifier mapping, including provider-aware domain/source pushdown before the final server filter.
- Data-driven multilingual discovery for every ISO country, using bounded canonical, local-name, demonym, institution, location, topic, local-publisher, and wire-service lanes. Bing uses reviewed documented markets such as `en-US`, `de-DE`, `fr-FR`, and `ja-JP`, with `en-US` as the safe fallback.
- Layered server-side country detection using official/native names, demonyms and safe capitals for all ISO countries plus reviewed major locations, subdivisions, and country-specific institutions. Publisher country remains separate from article subject country.
- Sites D1 schema and Drizzle migrations, bounded resumable ingestion/backfill, coverage watermarks, structured diagnostics, caching, rate limiting, response validation, provider timeouts, and RSS SSRF controls.
- Device-local Light, Dark, and System themes with a pre-hydration theme bootstrap to prevent a wrong-theme flash.
- Opt-in fixtures for local development and tests; disabled by default and never required by the production UI.

## Architecture

```text
GitHub Actions (24h every 30 minutes; 30d twice daily)
                |
 HMAC-signed POST /api/internal/ingest/run
                |
 bounded provider discovery -> normalize -> deduplicate -> cluster
                |
 Sites D1 (articles, stories, relations, checkpoints, replay nonces)
                |
 GET /api/news reads D1 first and supplements incomplete coverage live
                |
 country / comparison / search / filter UI
```

D1-backed reads use a bounded indexed candidate path and provider/country/window checkpoints. A fresh complete window can satisfy a request without live calls; partial, stale, or unknown stored coverage is supplemented by live discovery and deduplicated into a hybrid result. Live HTTP discovery keeps a process-local query corpus for 60 minutes, caps it at 40 query entries, and performs at most one bounded stage per continuation request.

The browser calls only this application's `/api/news` route. Provider credentials and RSS configuration are never exposed through public environment variables or client components.

### Initial rendering and progressive coverage

`/country` and `/compare` render up to 12 stored stories in the initial HTML. The server gives D1 1.2 seconds to return useful data; unavailable, empty or slow storage returns the normal shell and lets client/live discovery recover. External providers never run on this HTML path. Hydration reuses matching stored results. Partial stored coverage establishes a live/hybrid continuation when the list approaches the viewport, keeping the initial stories visible.

D1 ranks the full configured candidate pool using compact article metadata, then retrieves display text/URLs only for the selected page. Complete database-backed API responses use the same bounded display query. Batched relations and grouped reconstruction replace serial per-chunk reads; hybrid reconciliation still loads full candidates for cross-provider clustering. Default corpus/candidate limits, ranking, source diversity, country rotation and time windows are unchanged. Pagination retains one request at a time, aborts on filter changes, prefetches within 500px, deduplicates and sorts results, bounds automatic no-growth retries, and always permits a manual retry. Searches debounce for 400ms; Enter/Search submits immediately.

Ordinary database responses retain the API's public HTTP cache policy. The browser no longer forces every request to bypass that cache. Live responses and explicit continuations use `no-store`; an active continuation is not replaced by a newly complete database window. The map, landing globe and reader have separate client chunks and reserved placeholders. Complete flag geography remains available, with flags emitted as separate cached SVG assets instead of embedded into global CSS.

### Production security and local state

The production news limiter uses an atomic D1 counter shared across Workers (90 requests per 60 seconds) behind an inexpensive local limiter. It trusts Cloudflare's canonical `CF-Connecting-IP` only with the Workers D1 binding; conventional forwarded headers are ignored. IP keys are hashed. Storage is bounded to 10,000 keys with indexed expiry cleanup, saturated counters, and no eviction of active quotas. Denials return 429 with `Retry-After`; unavailable distributed storage fails closed with 503 in production. No external service is required.

Document CSP uses a fresh request nonce for framework scripts and a same-origin prepaint theme script. Image and production connection sources are restricted to the application origin (plus data images). Vinext already renders documents on request; the native Next backend explicitly uses `connection()` so prerendered inline scripts cannot violate the nonce policy. Document HTML is not shared-cacheable; API and hashed-asset caching remain independent. Inline styles remain necessary for React's map transforms, progress effects and theme variables. `/api/health` returns only `{"status":"ok"}`. Images stream through the existing reviewed host/path/redirect boundary with a 6MiB running byte bound and a seven-second deadline covering both headers and body.

One root saved-story provider performs one initial storage read and maintains one cross-tab listener. The existing `worldline:saved-stories:v1` key now contains `{ "version": 2, "stories": [...] }`: the complete nested snapshot is validated, bounded to 50 saved stories, and safe legacy arrays are migrated on read. Invalid/corrupt/future data is rejected. Restricted storage or quota failures show a non-blocking status; clear-all offers a ten-second in-memory Undo.

Service-worker caches are explicitly versioned (`v3`). Navigation stays network-first; only successful, non-redirected, non-private, cacheable known routes can be saved. API, authenticated, cross-origin and query-string resources are excluded. Hashed assets have an 80-entry bound. A small static offline page remains available when dynamic/private documents cannot be cached; offline content does not claim to be current news.

### Scheduled ingestion protocol

The workflow uses one job for two schedules: `*/30 * * * *` runs `24h` incremental discovery; `17 2,14 * * *` runs `30d` archive reconciliation at 02:17 and 14:17 UTC (10:17 and 22:17 Singapore time). Manual dispatch supports `latest`, `24h`, `7d`, and `30d`; the first two use incremental mode and the latter two use backfill mode. GitHub schedule delivery can be delayed.

The named passes are `global-discovery`, `country-rotation-first`, and `country-rotation-next`. The two country passes reserve different persisted rotating batches. Incremental and backfill rotations have separate counters, so frequent discovery cannot consume the archive rotation. A batch of one alternates high-volume and other countries. Every request signs a stable logical ID derived from workflow run ID, pass name and period. Re-running the same workflow run retains those IDs; retries use fresh timestamps and nonces.

Central policy distinguishes four outcomes:

| Outcome | Acceptance | HTTP / workflow |
|---|---|---|
| SUCCESS | Storage succeeded and useful work or a legitimate successful empty stage completed; no provider failures | 200 / success |
| DEGRADED | The same storage/invariant/usefulness requirements hold; only transient optional provider failures remain | 200 / success, with affected providers, error codes and cooldown in the summary |
| RETRYABLE_FAILURE | No useful provider result, temporary storage/runtime failure, timeout or lost lease | 503 / bounded retries, then workflow failure |
| TERMINAL_FAILURE | Authentication/configuration/schema/state/invariant faults, malformed responses, terminal query errors, or credentials such as NewsAPI 401 | Non-retryable 4xx or 422 / workflow failure |

The durable states are `RUNNING`, `SUCCEEDED`, `DEGRADED`, `FAILED_RETRYABLE`, `RETRY_BUDGET_EXHAUSTED`, and `FAILED_TERMINAL`. Three operation attempts exhaust the current logical request's budget; they do not turn a transient provider condition into a permanent error. Exhaustion returns 503 with `retryEligible: false`. A later scheduled run has a new ID and can recover. Final records are retained for seven days; cleanup is bounded. Legacy `FAILED` records and expired legacy attempts remain terminal. Reusing an ID with different signed input is rejected.

The route keeps the 180-second lease, renewal during work, 150-second execution budget, HMAC validation, bounded body and atomic nonce claim. Unique attempt tokens fence plans and request completion. Every production ingestion data/checkpoint/stage/rotation batch also checks the current lock token and lease inside the D1 transaction; a stale worker cannot write between a JavaScript ownership check and a database mutation. Country scope and snapshot are pinned before provider writes. Retries resume saved cursors and skip completed checkpoints. Corrupt plans/cursors fail explicitly. Re-ingestion preserves story members absent from the current provider batch.

Providers classify failures and preserve partial branch progress; they do not loop on transient errors. NewsAPI retains one semantic HTTP 400 fallback without hosted date parameters. The logical operation owns durable resume. The scheduler owns transport retries (three failures per pass) and time-bounded status polling, honoring server cooldowns. A pass may start requests for six minutes (enough for an orphaned attempt's 180-second lease to expire and a retried 150-second operation to finish), and the three passes share a 20-minute budget. Connections have a ten-second budget and every request gets the full 165 seconds: the scheduler never starts a request it cannot wait for, because an abandoned operation keeps the ingestion lock and makes the next pass see BUSY. Each request is logged with its elapsed time and result; the workflow has a 25-minute setup/run limit. A required delay that cannot fit ends that pass without sending an early retry. Later passes still run within the job budget. Any failed pass makes the workflow fail.

The shared Retry-After parser accepts delay-seconds and HTTP dates, rejects malformed values, clamps past dates to zero, and caps delays at 15 minutes. Missing/malformed values use exponential backoff starting at 30 seconds plus up to one second of positive jitter. The cap is explicit protection against unreasonable upstream values; expiry does not promise upstream recovery. Endpoint responses round cooldowns up to seconds. Provider bodies are bounded and their abort signal stays active through body consumption. Ingestion retries bypass cached failures; successful results and in-flight work remain coalesced.

GDELT stays enabled under the existing provider-selection policy. A shared D1 row coordinates its 5.5-second request-start spacing and 429/503 cooldown across live discovery and ingestion Workers. Reservations expire without cleanup or a queue; updates cannot shorten another worker's cooldown. Missing Retry-After uses a shared exponential failure streak that resets after a quiet interval. GDELT processes branches sequentially within a 31-second stage budget, beneath the 32-second ingestion provider deadline, and stops starting branches after failure. Successful branch cursors survive; failed branches remain pending. Its separate request timeout stays at 30 seconds. Production requires D1 coordination; development/tests can use memory. English-index query terms and original-language/publisher filters remain in use; recognized HTTP-200 query rejections remain terminal.

Actions summaries show SUCCESS, DEGRADED or FAILED, named pass, request/operation attempts, stored article/story counts, processed stages, provider codes, cooldown and duration. Inspect the provider code first: 429/503/timeouts indicate transient upstream trouble; 401/403, INVALID_QUERY, INVALID_RESPONSE and INVALID_CONFIGURATION require repair. STORAGE_UNAVAILABLE and LEASE_LOST are not degraded success; INVALID_STATE requires schema/state investigation. Use [deployment order](docs/production-deployment.md) before enabling the new workflow and [engineering report](docs/ingestion-reliability-report.md) for the audit and validation evidence.

After changing a Sites runtime secret, publish a saved version and verify the effective provider configuration through ingestion. Clearing `NEWSAPI_KEY` to an empty value explicitly disables that optional provider; deleting the settings entry alone can leave an older deployed Worker secret active. Invalid RSS JSON or GDELT mode values now fail configuration checks instead of silently selecting defaults.

## Quick start with no services or API keys

Requirements: Node.js 24.15.0 or newer and npm.

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. Reviewed RSS feeds and Bing News RSS discovery require no API key. The local UI falls back to live discovery when a D1 binding is unavailable. Fixtures appear only when `NEWS_FIXTURES_ENABLED=true`; they are never silently substituted in production.

## Sites D1 persistence

The hosted app declares the logical `DB` binding in `.openai/hosting.json`. Sites owns the physical D1 database, applies and records generated Drizzle migrations before Worker upload, and exposes the binding only to server code. The checked-in Wrangler database ID is a local placeholder. See [production migration and deployment order](docs/production-deployment.md) before publishing or enabling revised ingestion; it includes the guarded `npm run db:migrate:production` and `npm run db:verify:production` commands for operators with an authorized production Wrangler config. For local D1 development:

```powershell
Copy-Item .env.example .env.local
npm run db:migrate:local
```

The normalized schema includes the news entities plus provider runs, checkpoints, scheduler state, and one-time request nonces. Checkpoints record the discovery key, country/language shard, fixed window, cursor, covered boundaries, completion state, counts, and last successful update. Story count alone is never treated as proof of coverage.

D1 reads apply the time range, selected countries, topic, language, source, and text search before mapping records. The final deterministic bilateral relevance and popularity ranking stays in application code. Candidate loading is bounded to 1,000 matching stories by default (operator-configurable from 300 to 5,000) after the database sort.

Article/story persistence is transactional and idempotent. Ingestion persists after every bounded provider stage, so a stopped worker resumes its cursor instead of restarting page 1 or the newest date window. A repeated fixed backfill snapshot skips checkpoints that already cover it; a later snapshot requests only the uncovered time edge and merges that coverage into the existing watermark.

The scheduled GitHub workflow never receives database credentials. It makes several small sequential requests to the Sites ingestion endpoint, which performs provider work and writes through the server-only D1 binding. Requests use HMAC-SHA256 over the exact timestamp, nonce, and body; D1 records each nonce atomically to reject replay.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEWS_INGEST_HMAC_SECRET` | Hosted ingestion | Server-only random secret shared with the GitHub workflow; use at least 32 characters. |
| `NEWSAPI_KEY` | No | Enables NewsAPI ingestion. Missing credentials disable only this adapter. |
| `GDELT_MODE` | No | `auto` (default) enables credential-free GDELT for 7d/30d country requests; `on` enables it wherever appropriate; `off` disables it. |
| `NEWS_GDELT_TIMEOUT_MS` | No | GDELT request timeout; defaults to 30,000 ms and is bounded to 8,000–30,000 ms. Other providers retain their general timeout. |
| `GDELT_ENABLED` | No | Legacy compatibility switch used only when `GDELT_MODE` is unset. |
| `NEWS_FIXTURES_ENABLED` | No | Opts into fixture fallback for local development or ingestion tests; defaults to `false`. |
| `NEWS_PROVIDER_TIMEOUT_MS` | No | External request timeout, clamped to 2–30 seconds; defaults to 8 seconds. |
| `NEWS_LIVE_STAGE_TIMEOUT_MS` | No | Whole live-discovery stage deadline, clamped to 2.5–12 seconds; defaults to at most 6.5 seconds so a stalled provider cannot hold the response open. |
| `NEWS_LIVE_BATCH_SIZE` | No | Maximum **new** provider articles normalized in one bounded discovery stage; defaults to 96 and is clamped to 24–150. |
| `NEWS_LIVE_CORPUS_LIMIT` | No | Absolute accumulated **relevant** corpus safety cap; defaults to 1,000 and is clamped to 200–2,000. |
| `NEWS_LIVE_CORPUS_LIMIT_24H`, `_3D`, `_7D`, `_30D` | No | Period-aware relevant corpus defaults: 360, 500, 750, and 1,000, each bounded by the absolute cap. |
| `NEWS_LIVE_LOW_WATER` | No | Matching-story buffer threshold that can trigger another bounded stage; defaults to 24 and is clamped to 12–60. |
| `NEWS_LIVE_ARTICLE_LIMIT` | Deprecated | Compatibility alias used only as `NEWS_LIVE_BATCH_SIZE` when the new variable is unset. It no longer limits the accumulated corpus. |
| `NEWS_DATABASE_CANDIDATE_LIMIT` | No | Maximum matching stored stories loaded with nested coverage before application ranking; defaults to 1,000 and is clamped to 300–5,000. |
| `NEWS_DATABASE_FRESHNESS_MINUTES` | No | Maximum checkpoint age used to prove stored coverage is fresh; defaults to 120 minutes. |
| `NEWS_INGESTION_STAGE_LIMIT` | No | Maximum bounded provider stages in one ingestion worker; defaults to 24. |
| `NEWS_INGESTION_COUNTRY_BATCH_SIZE` | No | Rotating country shard size; defaults to 8 with structured high-volume priority. |
| `NEWS_SEMANTIC_CLUSTERING_ENABLED` | No | Enables the semantic stage when set to `true` and an embedding credential is present. Defaults to deterministic lexical clustering. |
| `NEWS_EMBEDDING_API_KEY` or `OPENAI_API_KEY` | When semantic clustering is enabled | Server-only credential for the configured OpenAI embedding adapter. The project-specific variable takes precedence when both are set. |
| `NEWS_EMBEDDING_MODEL` | No | Embedding model name; defaults to `text-embedding-3-small`. |
| `NEWS_EMBEDDING_TIMEOUT_MS` | No | Embedding request timeout, clamped to 1–15 seconds; defaults to 5 seconds. |
| `RSS_FEEDS_JSON` | No | JSON array of server-controlled, rights-reviewed RSS/Atom feed definitions. |

There are intentionally no `NEXT_PUBLIC_` provider variables.

## News ingestion

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
4. separates publisher country from mentioned countries.
5. Removes canonical URL and strong headline duplicates.
6. Builds hybrid semantic/lexical story clusters when configured, or deterministic lexical clusters otherwise.
7. Persists articles, provider references, country/topic relations, stories, and checkpoints through the Sites D1 binding.
8. Saves a coverage watermark and run record after every stage, including raw, accepted, out-of-window, irrelevant, duplicate, stored, and story counts without article bodies or secrets.

Without a D1 runtime binding, the local commands fetch, normalize, deduplicate, cluster, and print a dry-run summary. Fixtures are used only when `NEWS_FIXTURES_ENABLED=true` is set explicitly.

Configure repository secrets `NEWS_INGEST_URL` and `NEWS_INGEST_HMAC_SECRET`; configure the same HMAC value in Sites. An owner-only Site also needs `OAI_SITES_BYPASS_TOKEN` so GitHub can pass the Sites access gate before the application verifies the HMAC. The workflow has no database or provider credentials: `NEWSAPI_KEY` remains only in Sites.

Coverage can be inspected without printing article content:

```powershell
npm run diagnose:coverage -- --country=US --period=30d --max-stages=12
npm run smoke:coverage -- --country=JP --period=30d --max-stages=4
```

The smoke command is optional and intentionally excluded from CI because real-provider availability changes.

## Provider behavior

| Provider | Credentials | Default behavior |
| --- | --- | --- |
| GDELT | None | `auto` for 7d/30d country views. Principal local languages get independent `sourcelang:` branches and cursors. Historical requests sample bounded recent, middle, and oldest time windows first, then continue each branch until the requested range is covered. Selected publishers use documented `domainis:`/`sourcecountry:` filters where appropriate. |
| RSS/Atom | None | Reviewed feeds from BBC News, The Guardian, Al Jazeera, CNA, The Straits Times, The Japan Times, NHK, DW, Euronews, France 24, Sky News, and NPR are enabled by default. RSS is a finite snapshot: up to four relevant feeds are fetched per stage, each feed snapshot is visited once per fresh corpus, and articles remain publisher-round-robin. |
| Bing News RSS | None | Bing is a finite discovery snapshot, not an archive. At most two of 18 staged plans run per worker stage; completed plan IDs are retained. Markets/local languages are data-driven, local publisher domains are prioritized, and Reuters/AP remain supplementary lanes. |
| NewsAPI | `NEWSAPI_KEY` | Optional archive-capable provider. Continuation uses `page`/`totalResults`; hosted date-filter incompatibility retries still enforce the publication window locally. Source-country metadata is cached and local-perspective source IDs are pushed upstream where NewsAPI exposes them. Provider-plan/result-limit exhaustion remains distinct from coverage completeness. |
| Fixtures | None | Disabled by default. Available only as an explicit local development/testing fallback. |

Publisher availability is never assumed. A source-registry entry is an identity mapping, not an availability claim. The UI lists only publishers present in the current candidate set plus any publisher the visitor already selected. NHK is additionally enabled through its reviewed default RSS feed; Reuters and AP remain discovery targets rather than bundled feeds.

The verified Japanese identity registry also recognizes The Asahi Shimbun, The Yomiuri Shimbun, Nikkei, Kyodo News, The Mainichi, Jiji Press, The Hokkaido Shimbun, and Okinawa Times. These entries improve publisher identity and provider-domain targeting; they do **not** claim a bundled feed. Their official domains and publisher identity were reviewed, but no additional default RSS feed was enabled because a suitable public, publisher-operated feed and reuse posture were not both verified. No feed URL or scraping path was invented.

### Japanese publisher registry review

| Publisher identity | Reviewed official news domain(s) | Default RSS status |
| --- | --- | --- |
| NHK | `nhk.or.jp`, `news.web.nhk` | Enabled: the existing publisher-operated Japanese metadata feed. |
| The Japan Times | `japantimes.co.jp` | Enabled: the existing publisher-operated feed. |
| The Asahi Shimbun | `asahi.com` | Identity/provider targeting only; no additional feed enabled. |
| The Yomiuri Shimbun | `yomiuri.co.jp` | Identity/provider targeting only; no additional feed enabled. |
| Nikkei | `nikkei.com` | Identity/provider targeting only; no additional feed enabled. |
| Kyodo News | `kyodonews.jp`, `kyodonews.net` | Identity/provider targeting only; no additional feed enabled. |
| The Mainichi | `mainichi.jp` | Identity/provider targeting only; no additional feed enabled. |
| Jiji Press | `jiji.com` | Identity/provider targeting only; no additional feed enabled. |
| The Hokkaido Shimbun | `hokkaido-np.co.jp` | Regional identity/provider targeting only; no additional feed enabled. |
| Okinawa Times | `okinawatimes.co.jp` | Regional identity/provider targeting only; no additional feed enabled. |

“Not enabled” means the registry improves identity and discovery matching only. It does not mean the publisher lacks a feed; it means this project did not verify both a suitable official public endpoint and an appropriate reuse posture, so it deliberately did not add one.

Publisher identity and country resolution is layered. Maintained stable IDs and provider-specific identifiers take precedence, followed by canonical registrable-domain matching through the Public Suffix List, provider metadata, reviewed RSS configuration, and reliable ccTLD signals. Generic domains such as `.com`, `.org`, and `.net` never create a country assignment, and publisher country is never inferred from the article subject. Resolution method and confidence are retained internally for logs and tests. Public source facets expose stable ID, display name, canonical domain, publisher country, language, scope, quality score, and story count.

RSS items are accepted only when the publisher supplies a parseable publication time. Missing, invalid, implausibly future, or out-of-range dates are rejected rather than being relabelled as newly published. The adapter prefers publisher snippets/summaries/descriptions, never persists unrestricted `content:encoded` as an article body, and sanitizes and truncates an encoded fallback to about 800 characters.

### Configuring approved RSS feeds

`RSS_FEEDS_JSON` replaces the default feed list with an operator-reviewed array like this:

```json
[
  {
    "sourceId": "approved-publisher",
    "name": "Approved publisher",
    "feedUrl": "https://publisher.example/feed.xml",
    "websiteUrl": "https://publisher.example/",
    "countryCode": "SG",
    "region": null,
    "language": "en",
    "scope": "NATIONAL",
    "coverageCountries": ["SG"]
  }
]
```

This is administrator configuration, not a visitor-facing feature. Feed URLs must use public, credential-free HTTPS endpoints. The adapter rejects local/private addresses, validates redirects, limits response size, and does not accept arbitrary URLs from API requests.

## News API

Examples:

```text
GET /api/news
GET /api/news?countries=JP
GET /api/news?countries=JP,SG
GET /api/news?countries=JP&sourcePerspective=local&period=24h
GET /api/news?countries=JP,SG&sourcePerspective=second-country&topic=technology
GET /api/news?countries=JP&source=japan-times&source=al-jazeera
GET /api/news?countries=JP&sourcePerspective=local&language=ja
GET /api/news?countries=JP&period=30d&sort=newest&page=2
```

Typed values:

- `countries`: zero to two unique ISO 3166-1 alpha-2 codes.
- `sourcePerspective`: `all`; `local` or `international` for one country; `first-country`, `second-country`, or `international` for two countries.
- `period`: `latest`, `24h`, `7d`, or `30d`.
- `sort`: `newest` (strict publication-time order) or `popular` (multi-source coverage and story-importance score).
- `source`: repeatable stable publisher ID; up to 20 outlets. Maintained display names remain accepted for compatibility.
- `topic`: lowercase topic slug. The shared UI/backend set is politics, business, technology, society, climate, defence, transport, culture, and sports.
- `language`: BCP 47-style short language tag when metadata exists.
- `search`: at most 120 characters.
- `page`: 1–100; `pageSize`: 1–250.

Internal pages power infinite continuation only; the normal interface has no numbered-page navigation. Response metadata separates materialized story clusters from individual articles and distinguishes `hasMore`, `discoveryExhausted`, `archiveCoverageComplete`, `coverageComplete`, `coverageDegraded`, `coverageStatus`, and `corpusLimitReached`. A finite Bing/RSS stop or safety cap can make `hasMore=false` without claiming complete 30-day coverage. The UI labels such counts as discovered/currently available coverage. If process-local state disappears between scroll requests, the continuation ID is rejected explicitly and the interface replaces the stale feed with a fresh first page instead of silently appending a restarted corpus.

Invalid combinations return a sanitized `400` response. Live responses and explicit continuations are `no-store` because requesting continuation can expand the server-side corpus even when an internal page repeats. D1 enforces production quotas across instances. Live continuation corpora remain process-local; expired or unavailable continuations return an explicit reset and recover through the existing discovery path.

## Caching and request control

- Live query corpora are cached for 60 minutes, capped at 40 entries, and keyed by countries, perspective, source IDs, topic, language, period, sort, search, and non-secret provider configuration.
- Provider requests are coalesced while in flight. Successful results are cached for five minutes, empty results for 45 seconds, and failures for 20 seconds, preventing rapid retry amplification.
- Provider caching is capped at 160 entries. The request limiter is capped at 2,000 client windows and trusts the deployment-provided Cloudflare client address before generic proxy headers.
- The live cache exposes a small store interface for a future shared implementation. The production limiter already uses the supported Sites D1 binding; no Redis, Durable Object or paid dependency is required.
- A single live stage processes no more than `NEWS_LIVE_BATCH_SIZE` candidates. Raw provider round-robin is preserved, but only query-relevant articles consume period-aware corpus capacity. Bing runs at most two upstream plans per stage and 18 over the finite plan set.
- The browser prefetches cached internal pages until roughly 30–50 stories are ready ahead. When the server-side matching buffer reaches `NEWS_LIVE_LOW_WATER`, one further bounded provider stage can run. Opening the page does not continuously refetch providers while enough cached material remains.

No cache key, log entry, or API response contains provider credentials.

## Theme preferences

The Settings page and every news-page header provide Light, Dark, and System controls. System is the default. A manual selection is stored in browser `localStorage`, never sent to the server, and applies across the country, comparison, and settings pages. A small server-rendered bootstrap runs before page content and resolves the theme before hydration to avoid a light-to-dark flash. Both themes use shared CSS design tokens, preserve map hover/selected states, and respect reduced-motion preferences.

## Ranking and two-country relevance

Ranking is deterministic and politically neutral. Newest sorting uses publication time. Popularity is an explicit coverage proxy—not readership data—and prioritizes story importance, independent-source count, source-country diversity, geographic relevance, and modest recency. Two-country results require both countries through direct article or reviewed country-category signals, reward balanced country relevance and bilateral headline focus, and penalize long incidental country lists. A publisher's home country alone never creates a bilateral match.

Country detection is provider-independent and combines explicit coverage metadata, structured locations, names from twelve language datasets, a compact generated geography file, reviewed aliases/subdivisions/institutions, conservative ISO handling, and lower-confidence URL hints. The generated file comes from the ODbL-1.0 `mledoze/countries` dataset pinned to commit `9eff32e4eef26715aa59d99b200127d1ef150e7a`; `npm run data:update-countries` refreshes it deliberately. Ambiguous capitals are excluded from automatic signals. All detection remains server-side, and publisher origin remains separate from article subject geography.

Language inference trusts provider/feed metadata first, then high-confidence Kana and Hangul scripts, then a small conservative Latin-language marker classifier. Long Latin-script text is no longer assumed to be English; unsupported or ambiguous text remains `und`, including Han-only text without reliable metadata.

Clustering keeps lexical comparison as a cheap deterministic signal and an optional provider-independent embedding boundary. New members must match the stable representative and, for deeper clusters, supporting members; single-link A≈B≈C chains no longer merge when A and C are different events. Cross-language reports can still merge when semantic evidence matches the representative. Embeddings remain optional; deterministic lexical clustering is fully functional without API credits.

## Security and content handling

- Secrets stay in server environment variables.
- API parameters and provider response shapes are validated.
- Provider calls use bounded timeouts and isolated failure handling.
- RSS ingestion is allow-list only and applies SSRF-oriented URL, DNS, redirect, protocol, and size checks.
- Article/image URLs are restricted to HTTP(S), external article links use safe target attributes, and provider error details are not returned to ordinary users. A reviewed same-origin media relay resolves missing publisher `og:image` metadata and rejects unapproved article, image, and redirect hosts.
- NHK relay support is narrowly limited to reviewed official news paths on `news.web.nhk`, `imgu.web.nhk`, and `www3.nhk.or.jp`; other NHK or CDN paths still fall back to the placeholder.
- Security headers include CSP, frame denial, content-type protection, a restrictive permissions policy, and a strict referrer policy.
- Full article bodies are never stored or rendered by this MVP. Live cards and Reader show attribution, metadata, permitted short descriptions, and original-publisher links. RSS `content:encoded` is used only as a sanitized, bounded fallback when no publisher summary exists.

## Licensing and provider limitations

- NewsAPI plan restrictions and production rights depend on the operator's account and current terms. Verify them before deployment.
- Bing News RSS discovery is used only for headline-level, private, non-commercial exploration and links directly to the discovered publisher URL. Review Microsoft's current terms before changing that usage model.
- GDELT can supply broad discovery metadata but does not grant rights to republish publisher content. The original publisher's rights still apply.
- RSS availability does not automatically grant permission to archive, reproduce, translate, or commercially reuse full content. Enable only reviewed feeds and retain only permitted metadata/excerpts. Publishers listed as identity-only are not default feed sources because this project did not verify both a suitable official public endpoint and an appropriate reuse posture.
- Images and descriptions may have separate rights or hotlinking restrictions. A production operator should disable or proxy only expressly licensed media according to publisher/provider terms.
- This repository does not include licensed Reuters, AP, or other full-content feeds and does not claim that any named publisher is currently available.

Review the current official terms for every selected provider and publisher before production use.

## Current MVP limitations

- Coverage remains limited by configured provider availability, provider/API result limits, publisher metadata quality, and licensing. RSS/Bing snapshots cannot prove a complete historical archive; GDELT/NewsAPI can broaden discovery but still do not guarantee every publisher or event.
- Story clustering uses hybrid semantic and lexical similarity when semantic embeddings are explicitly configured and gracefully falls back to deterministic lexical clustering otherwise. The embedding cache is process-local rather than shared or database-backed.
- Publisher-country resolution uses a structured registry, provider identifiers, RSS metadata, registrable domains, and reliable ccTLD signals; truly unknown, globally hosted, or internationally repurposed country-code domains may remain unclassified.
- The durable article corpus, ingestion checkpoints, scheduler state, and replay nonces are shared in D1. Live browsing continuation remains process-local and resets honestly after an isolate restart; production request quotas and GDELT cooldowns are shared in D1.
- Live-provider browsing is finite for the chosen time range and provider result windows. Infinite scroll can progressively accumulate 200+ stories where providers supply enough unique coverage, but it stops at the configured corpus maximum and never crawls publisher sites or bypasses provider/API limits.
- No automatic translation, user accounts, admin UI, or full-content storage is implemented. Saved articles use browser-local storage and do not sync across devices.
- Fixture URLs are intentionally non-live and shown as “Sample article” rather than pretending to be publisher links.

## Validation

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run db:check
npm audit
```

The test suite additionally covers D1 migrations and relational persistence, signed ingestion and replay rejection, multilingual discovery/markets, large country corpora through bounded continuation, archive windows, checkpoint resume, partial-database supplementation, complete-database live-call avoidance, article-based periods, provider filtering, representative-consistent clustering, and honest completion semantics.

Build tooling uses a [local braces security backport](vendor/braces/README.md) until a verified upstream fix is released. Its source, license and provenance are committed; clean installs need no patch script. Security regression tests cover the patched parser, AST walkers and installed glob callers. Keep the full dependency audit enabled alongside these tests.
