# Worldline

Worldline is a production-minded MVP for exploring world news through an interactive map. It works immediately for an anonymous visitor: global coverage appears with no setup, one selected country shows stories involving that country, and two selected countries surface stories meaningfully related to both.

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
- English and Japanese Japan discovery (`Japan`, `日本`, and `日本国`) with separate Bing locales and optional GDELT language queries.
- Layered multilingual country detection, conservative script-aware language inference, data-driven English/Japanese topic classification, URL canonicalization, deduplication, hybrid semantic/lexical story clustering, and ranking.
- PostgreSQL schema, Prisma migration, database seed, manual ingestion command, structured logs, caching, rate limiting, response validation, provider timeouts, and RSS SSRF controls.
- Device-local Light, Dark, and System themes with a pre-hydration theme bootstrap to prevent a wrong-theme flash.
- Opt-in fixtures for local development and tests; disabled by default and never required by the production UI.

## Architecture

```text
NewsAPI       GDELT       Bing News RSS       trusted publisher feeds
   \            |              |                       /
        provider adapters
                |
 bounded discovery stage (up to 96 new provider articles)
                |
          normalization
                |
  multilingual country/entity signals + layered source resolution
                |
 URL deduplication + hybrid semantic/lexical clustering
                |
 cross-stage deduplication + clustering
                |
 stable snapshot ordering + cached corpus (up to 400 articles)
                |
   GET /api/news internal continuation
                |
 IntersectionObserver infinite-scroll UI (12-story reveals)
```

Database-backed reads continue to use the separate bounded Prisma candidate path. Live HTTP discovery keeps a process-local query corpus for 60 minutes, caps it at 40 query entries, and performs at most one bounded discovery stage per continuation request. Already normalized articles are reused for that corpus lifecycle.

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

The normalized schema includes `Country`, `Source`, `SourceProviderIdentifier`, `Article`, `ArticleProviderRef`, `ArticleCountry`, `Topic`, `ArticleTopic`, `Story`, `StoryArticle`, `StoryCountry`, `StoryTopic`, and `ProviderIngestionRun`. Important time, source, country, language, topic, and relationship fields are indexed.

Database reads apply the time range, selected countries, topic, language, source, and text search in PostgreSQL before mapping records. The final deterministic bilateral relevance and popularity ranking stays in application code. Candidate loading is bounded to 1,000 matching stories by default (operator-configurable from 300 to 5,000) after the database sort, preventing unbounded nested-relation reads while preserving the ranking window used by the UI.

Ingestion is transactional and idempotent. When an article's countries, topics, or cluster fingerprint changes, the new cluster becomes authoritative, obsolete story rows and their relationships are retired, and an article is not left attached to a stale cluster.

The current ChatGPT Sites deployment uses live HTTP providers because hosted Sites workers do not open raw PostgreSQL TCP connections. Durable hosted ingestion therefore needs an HTTP-accessible database API, a supported platform binding, or a private HTTP tunnel. Local development and GitHub Actions use PostgreSQL directly through Prisma.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | For persistence | PostgreSQL connection string used only on the server. |
| `NEWSAPI_KEY` | No | Enables NewsAPI ingestion. Missing credentials disable only this adapter. |
| `GDELT_ENABLED` | No | Enables credential-free GDELT ingestion; defaults to `false`. |
| `NEWS_FIXTURES_ENABLED` | No | Opts into fixture fallback for local development or ingestion tests; defaults to `false`. |
| `NEWS_PROVIDER_TIMEOUT_MS` | No | External request timeout, clamped to 2–30 seconds; defaults to 8 seconds. |
| `NEWS_LIVE_BATCH_SIZE` | No | Maximum **new** provider articles normalized in one bounded discovery stage; defaults to 96 and is clamped to 24–150. |
| `NEWS_LIVE_CORPUS_LIMIT` | No | Maximum accumulated normalized articles in one cached live query; defaults to 400 and is clamped to 200–1,000. |
| `NEWS_LIVE_LOW_WATER` | No | Matching-story buffer threshold that can trigger another bounded stage; defaults to 24 and is clamped to 12–60. |
| `NEWS_LIVE_ARTICLE_LIMIT` | Deprecated | Compatibility alias used only as `NEWS_LIVE_BATCH_SIZE` when the new variable is unset. It no longer limits the accumulated corpus. |
| `NEWS_DATABASE_CANDIDATE_LIMIT` | No | Maximum matching stored stories loaded with nested coverage before application ranking; defaults to 1,000 and is clamped to 300–5,000. |
| `NEWS_SEMANTIC_CLUSTERING_ENABLED` | No | Enables the semantic stage when set to `true` and an embedding credential is present. Defaults to deterministic lexical clustering. |
| `NEWS_EMBEDDING_API_KEY` or `OPENAI_API_KEY` | When semantic clustering is enabled | Server-only credential for the configured OpenAI embedding adapter. The project-specific variable takes precedence when both are set. |
| `NEWS_EMBEDDING_MODEL` | No | Embedding model name; defaults to `text-embedding-3-small`. |
| `NEWS_EMBEDDING_TIMEOUT_MS` | No | Embedding request timeout, clamped to 1–15 seconds; defaults to 5 seconds. |
| `RSS_FEEDS_JSON` | No | JSON array of server-controlled, rights-reviewed RSS/Atom feed definitions. |

There are intentionally no `NEXT_PUBLIC_` provider variables.

## News ingestion

Run ingestion manually with:

```powershell
npm run ingest:news
```

The command:

1. Fetches providers concurrently.
2. Continues when any individual provider fails.
3. Normalizes provider-specific responses.
4. separates publisher country from mentioned countries.
5. Removes canonical URL and strong headline duplicates.
6. Builds hybrid semantic/lexical story clusters when configured, or deterministic lexical clusters otherwise.
7. Persists articles, provider references, country/topic relations, and stories when `DATABASE_URL` is set.
8. Logs received, normalized, rejected, duplicate, stored, and story counts without logging secrets or article bodies. Aggregate fields include `articles_by_language`, `articles_by_source_country`, `jp_local_article_count`, `source_resolution_method`, `provider_source_targeted_query_count`, `rss_articles_per_source`, and `rss_truncated_description_count`.

Without `DATABASE_URL`, the command still fetches, normalizes, deduplicates, clusters, and prints a dry-run summary. Fixtures are used only when `NEWS_FIXTURES_ENABLED=true` is set explicitly.

The command has no hosting-provider dependency. A later deployment can invoke it from cron, a scheduled function, or a worker. Run only one ingestion job at a time until a distributed lock is added.

## Provider behavior

| Provider | Credentials | Default behavior |
| --- | --- | --- |
| GDELT | None | Opt in with `GDELT_ENABLED=true`. Japan requests retain separate `sourcelang:english` and `sourcelang:japanese` queries. Continuation uses the DOC API's supported `STARTDATETIME`/`ENDDATETIME` window boundary with date-descending results; finite or short windows become exhausted. Selected publishers become exact `domainis:` filters where domains are known. |
| RSS/Atom | None | Reviewed feeds from BBC News, The Guardian, Al Jazeera, CNA, The Straits Times, The Japan Times, NHK, DW, Euronews, France 24, Sky News, and NPR are enabled by default. RSS is a finite snapshot: up to four relevant feeds are fetched per stage, each feed snapshot is visited once per fresh corpus, and articles remain publisher-round-robin. |
| Bing News RSS | None | Bing has no invented numeric pagination. Up to two of ten bounded discovery plans run per stage; completed plan offsets are retained across stages. Japan keeps separate English/Japanese locales, topic variants, and the existing Reuters/AP-focused plans. Selected publishers become `site:` or publisher-name queries. |
| NewsAPI | `NEWSAPI_KEY` | Disabled gracefully when the key is absent. Continuation uses NewsAPI's supported `page` parameter and `totalResults`; page 1 is not repeated within a corpus. Stable selections are pushed into supported `sources` IDs and/or `domains`. Japanese is not forced to English. |
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

Internal pages power infinite continuation only; the normal interface has no numbered-page navigation. Response metadata distinguishes `total`/`materializedStoryCount` (currently materialized matching story clusters) from `articleCount` (individual publisher articles in the live corpus). `hasMore` remains true while cached stories or provider discovery remain, `corpusComplete` becomes true only at real exhaustion or the corpus maximum, and `nextPage` is the internal continuation position. Incremental counts are not presented as an exhaustive count of the internet.

Invalid combinations return a sanitized `400` response. Live responses are `no-store` because requesting continuation can expand the server-side corpus even when an internal page repeats. A best-effort per-instance rate limit remains; multi-instance production should move live corpus and limiter state to shared infrastructure such as Redis or Durable Objects.

## Caching and request control

- Live query corpora are cached for 60 minutes, capped at 40 entries, and keyed by countries, perspective, source IDs, topic, language, period, sort, search, and non-secret provider configuration.
- Provider requests are coalesced while in flight. Successful results are cached for five minutes, empty results for 45 seconds, and failures for 20 seconds, preventing rapid retry amplification.
- Provider caching is capped at 160 entries. The request limiter is capped at 2,000 client windows and trusts the deployment-provided Cloudflare client address before generic proxy headers.
- The cache and limiter expose small store interfaces so a multi-instance deployment can replace process-local state with Redis, Durable Objects, or KV without changing the API contract.
- A single live stage processes no more than `NEWS_LIVE_BATCH_SIZE` new candidates. Provider allocation and RSS feeds are sampled fairly; Bing runs at most two upstream plans per stage and ten over the full finite plan set.
- The browser prefetches cached internal pages until roughly 30–50 stories are ready ahead. When the server-side matching buffer reaches `NEWS_LIVE_LOW_WATER`, one further bounded provider stage can run. Opening the page does not continuously refetch providers while enough cached material remains.

No cache key, log entry, or API response contains provider credentials.

## Theme preferences

The Settings page and every news-page header provide Light, Dark, and System controls. System is the default. A manual selection is stored in browser `localStorage`, never sent to the server, and applies across the country, comparison, and settings pages. A small server-rendered bootstrap runs before page content and resolves the theme before hydration to avoid a light-to-dark flash. Both themes use shared CSS design tokens, preserve map hover/selected states, and respect reduced-motion preferences.

## Ranking and two-country relevance

Ranking is deterministic and politically neutral. Newest sorting uses publication time. Popularity is an explicit coverage proxy—not readership data—and prioritizes story importance, independent-source count, source-country diversity, geographic relevance, and modest recency. Two-country results require both countries through direct article or reviewed country-category signals, reward balanced country relevance and bilateral headline focus, and penalize long incidental country lists. A publisher's home country alone never creates a bilateral match.

Country detection is provider-independent and combines explicit coverage metadata, structured locations, names from twelve language datasets, curated aliases/demonyms/cities, conservative ISO handling, and lower-confidence URL path hints. Japanese data includes Tokyo, Osaka, Kyoto, Hokkaido, Okinawa, Fukuoka, Nagoya, Yokohama, and additional major cities in both native and English forms. Publisher origin remains strictly separate from article subject geography.

Language inference trusts provider/feed metadata first, then high-confidence Kana and Hangul scripts, then a small conservative Latin-language marker classifier. Long Latin-script text is no longer assumed to be English; unsupported or ambiguous text remains `und`, including Han-only text without reliable metadata.

Clustering keeps lexical comparison as a cheap deterministic signal and adds a provider-independent `TextEmbeddingProvider` boundary. The configured OpenAI adapter batches requests, validates vector responses, enforces a timeout, and sends only normalized headline, short description, detected country codes, and topic labels. Candidate generation narrows semantic comparisons by time, country, topic, entity, and lexical overlap. Embeddings use a stable semantic-content hash in a bounded 24-hour process-local cache. Story fingerprints remain based on stable headline/country attributes rather than model vectors. Missing configuration, invalid responses, timeouts, and provider failures all fall back to lexical clustering without interrupting ingestion.

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

- Multilingual country detection now combines structured metadata, aliases, demonyms, cities, ISO codes, and geographic URL hints, but ambiguous geopolitical references and locations outside the curated major-city set remain best-effort.
- Story clustering uses hybrid semantic and lexical similarity when semantic embeddings are explicitly configured and gracefully falls back to deterministic lexical clustering otherwise. The embedding cache is process-local rather than shared or database-backed.
- Publisher-country resolution uses a structured registry, provider identifiers, RSS metadata, registrable domains, and reliable ccTLD signals; truly unknown, globally hosted, or internationally repurposed country-code domains may remain unclassified.
- Cache and rate-limit state are process-local; multi-instance deployments should use a shared implementation.
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

The test suite covers bounded first stages, cached-buffer reuse, low-water discovery, 200+ story accumulation, corpus caps, stable append ordering, cross-stage URL deduplication and clustering, provider continuation/exhaustion/diversity, automatic IntersectionObserver loading, continuation metadata/count semantics, the 20-outlet UI cap, Japanese geography/Unicode/source separation, conservative language inference, stable domainless publisher IDs, RSS fairness/metadata handling, reviewed NHK images, provider failure isolation, database candidate bounds, API validation, rate limiting, and theme persistence. GitHub Actions starts PostgreSQL 17, applies the real migration, and retains integration coverage for persistence and database pagination beyond 250 stories.
