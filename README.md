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
- PostgreSQL schema, migrations, database seed, bounded resumable ingestion/backfill, coverage watermarks, structured diagnostics, caching, rate limiting, response validation, provider timeouts, and RSS SSRF controls.
- Device-local Light, Dark, and System themes with a pre-hydration theme bootstrap to prevent a wrong-theme flash.
- Opt-in fixtures for local development and tests; disabled by default and never required by the production UI.

## Architecture

```text
NewsAPI       GDELT       Bing News RSS       trusted publisher feeds
   \            |              |                       /
        provider adapters
                |
 bounded discovery stage (up to 96 provider candidates)
                |
          normalization
                |
  multilingual country/entity signals + layered source resolution
                |
 query-aware acceptance before relevant corpus capacity
                |
 cross-stage deduplication + representative-consistent clustering
                |
 stable snapshot ordering + period-aware relevant corpus
                |
   GET /api/news internal continuation
                |
 IntersectionObserver infinite-scroll UI (12-story reveals)
```

Database-backed reads use a bounded Prisma candidate path and provider/country/window checkpoints. A fresh complete window can satisfy a request without live calls; partial, stale, or unknown stored coverage is supplemented by live discovery and deduplicated into a hybrid result. Live HTTP discovery keeps a process-local query corpus for 60 minutes, caps it at 40 query entries, and performs at most one bounded stage per continuation request.

The browser calls only this application's `/api/news` route. Provider credentials and RSS configuration are never exposed through public environment variables or client components.

## Quick start with no services or API keys

Requirements: Node.js 24.15.0 or newer and npm.

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. Reviewed RSS feeds and Bing News RSS discovery require no API key. PostgreSQL and paid provider credentials are optional. Fixtures appear only when `NEWS_FIXTURES_ENABLED=true`; they are never silently substituted in production.

## PostgreSQL setup

Copy the environment template and set a real PostgreSQL connection string:

```powershell
Copy-Item .env.example .env.local
```

Then initialize and seed the database:

```powershell
npx prisma migrate deploy
npm run db:seed
```

The normalized schema includes the news entities plus `ProviderIngestionRun`, `ProviderIngestionCheckpoint`, and `IngestionSchedulerState`. Checkpoints record the discovery key, country/language shard, fixed window, cursor, covered boundaries, completion state, counts, and last successful update. Story count alone is never treated as proof of coverage.

Database reads apply the time range, selected countries, topic, language, source, and text search in PostgreSQL before mapping records. The final deterministic bilateral relevance and popularity ranking stays in application code. Candidate loading is bounded to 1,000 matching stories by default (operator-configurable from 300 to 5,000) after the database sort, preventing unbounded nested-relation reads while preserving the ranking window used by the UI.

Article/story persistence is transactional and idempotent. Ingestion persists after every bounded provider stage, so a stopped worker resumes its cursor instead of restarting page 1 or the newest date window. A repeated fixed backfill snapshot skips checkpoints that already cover it; a later snapshot requests only the uncovered time edge and merges that coverage into the existing watermark.

The current ChatGPT Sites project has no D1/R2 binding configured and uses live HTTP providers; its worker does not use the repository's raw PostgreSQL connection. The scheduled GitHub workflow is database-backed only when the repository `DATABASE_URL` secret points to a database reachable from GitHub Actions. It does not make Sites database-backed. A shared Sites corpus requires an actually configured supported binding or HTTP-accessible state service.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | For persistence | PostgreSQL connection string used only on the server. |
| `NEWSAPI_KEY` | No | Enables NewsAPI ingestion. Missing credentials disable only this adapter. |
| `GDELT_MODE` | No | `auto` (default) enables credential-free GDELT for 7d/30d country requests; `on` enables it wherever appropriate; `off` disables it. |
| `GDELT_ENABLED` | No | Legacy compatibility switch used only when `GDELT_MODE` is unset. |
| `NEWS_FIXTURES_ENABLED` | No | Opts into fixture fallback for local development or ingestion tests; defaults to `false`. |
| `NEWS_PROVIDER_TIMEOUT_MS` | No | External request timeout, clamped to 2–30 seconds; defaults to 8 seconds. |
| `NEWS_LIVE_STAGE_TIMEOUT_MS` | No | Whole live-discovery stage deadline, clamped to 2.5–12 seconds; defaults to at most 6.5 seconds so a stalled provider cannot hold the response open. |
| `NEWS_LIVE_BATCH_SIZE` | No | Maximum **new relevant** provider articles stored and clustered in one bounded discovery stage; defaults to 96 and is clamped to 24–150. Providers may return a larger bounded candidate pool before relevance filtering. |
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

Run continuous recent ingestion or a resumable historical backfill with:

```powershell
npm run ingest:news
npm run ingest:backfill -- --period=30d
npm run ingest:backfill -- --country=US --period=30d --stages=48
```

The commands use fixed snapshots, provider continuation, bounded stages, per-country rotation, canonical deduplication, per-stage persistence, and checkpointed resume. `ingest:news` defaults to a recent incremental window; `ingest:backfill` defaults to 30 days. Every country in the structured high-volume list rotates through the priority slots while the remaining ISO countries rotate through separate capacity. The selected shard count is capped by the stage/provider budget so the scheduler never advances past countries the current worker could not touch.

The ingestion pipeline:

1. Selects a bounded country and provider discovery shard.
2. Resumes saved Bing plan IDs, RSS feed IDs, NewsAPI pages, or GDELT branch date cursors.
3. Normalizes provider-specific responses.
4. separates publisher country from mentioned countries.
5. Removes canonical URL and strong headline duplicates.
6. Builds hybrid semantic/lexical story clusters when configured, or deterministic lexical clusters otherwise.
7. Persists articles, provider references, country/topic relations, and stories when `DATABASE_URL` is set.
8. Saves a coverage watermark and run record after every stage, including raw, accepted, out-of-window, irrelevant, duplicate, stored, and story counts without article bodies or secrets.

Without `DATABASE_URL`, the command still fetches, normalizes, deduplicates, clusters, and prints a dry-run summary. Fixtures are used only when `NEWS_FIXTURES_ENABLED=true` is set explicitly.

`.github/workflows/news-ingestion.yml` runs a bounded 30-day continuation pass every 30 minutes and supports manual dispatch with another period. It uses repository secrets, applies migrations, and prevents concurrent ingestion runs with workflow concurrency. Database reachability from GitHub-hosted runners is a deployment prerequisite. When the optional `DATABASE_URL` secret is absent, the workflow records a successful not-configured summary and skips the persistence steps instead of reporting a broken ingestion run.

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
| NewsAPI | `NEWSAPI_KEY` | Optional archive-capable provider. Seven- and 30-day requests sample bounded recent, middle, and oldest windows before continuing each window independently with `page`/`totalResults`; hosted date-filter incompatibility retries still enforce the publication window locally. Source-country metadata is cached and local-perspective source IDs are pushed upstream where NewsAPI exposes them. Provider-plan/result-limit exhaustion remains distinct from coverage completeness. |
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

Invalid combinations return a sanitized `400` response. Live responses are `no-store` because requesting continuation can expand the server-side corpus even when an internal page repeats. A best-effort per-instance rate limit remains; multi-instance production should move live corpus and limiter state to shared infrastructure such as Redis or Durable Objects.

## Caching and request control

- Live query corpora are cached for 60 minutes, capped at 40 entries, and keyed by countries, perspective, source IDs, topic, language, period, sort, search, and non-secret provider configuration.
- Provider requests are coalesced while in flight. Successful results are cached for five minutes, empty results for 45 seconds, and failures for 20 seconds, preventing rapid retry amplification.
- Provider caching is capped at 160 entries. The request limiter is capped at 2,000 client windows and trusts the deployment-provided Cloudflare client address before generic proxy headers.
- The cache and limiter expose small store interfaces so a multi-instance deployment can replace process-local state with Redis, Durable Objects, or KV without changing the API contract.
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
- Live corpus and rate-limit state use explicit store boundaries but remain process-local because this Sites project has no shared binding configured. Continuation IDs detect a missing/restarted corpus and recover honestly; true multi-instance deep-scroll continuity still requires a configured shared store.
- Live-provider browsing is finite for the chosen time range and provider result windows. Infinite scroll can progressively accumulate 200+ stories where providers supply enough unique coverage, but it stops at the configured corpus maximum and never crawls publisher sites or bypasses provider/API limits.
- No automatic translation, user accounts, admin UI, or full-content storage is implemented. Saved articles use browser-local storage and do not sync across devices.
- Fixture URLs are intentionally non-live and shown as “Sample article” rather than pretending to be publisher links.

## Validation

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npx prisma validate
npm audit
```

The test suite additionally covers multilingual discovery/markets, 400 irrelevant articles ahead of country results, 500-story US/JP/SG corpora through bounded continuation, archive windows, ingestion checkpoint resume, partial-database supplementation, complete-database live-call avoidance, article-based periods, NewsAPI fallback filtering, representative-consistent clustering, and honest completion semantics. GitHub Actions starts PostgreSQL 17 and applies the real migrations.
