# Worldline

Worldline is a production-minded MVP for exploring world news through an interactive map. It works immediately for an anonymous visitor: global coverage appears with no setup, one selected country shows stories involving that country, and two selected countries surface stories meaningfully related to both.

Fixture mode is an explicit development option only. Production returns live stories or an honest empty state and never substitutes sample stories for reporting.

## What is implemented

- Responsive D3 world map with hover, click, keyboard selection, deselection, clear selection, and an explicit two-country limit.
- Global, one-country, and two-country exploration.
- Local/international perspective filtering based on publisher country—not article subject.
- Bilateral source filters for first-country, second-country, and outside sources.
- Topic, language, time, outlet, keyword, and newest/popularity sorting controls.
- Story-first results with grouped publisher coverage and links to original live articles.
- Provider adapters for NewsAPI, GDELT, publisher RSS/Atom feeds, and Bing News RSS discovery with original-publisher URL extraction.
- Provider-independent source registry and many-to-one provider identifier mapping.
- Layered multilingual country detection, deterministic topic classification, URL canonicalization, deduplication, hybrid semantic/lexical story clustering, and ranking.
- PostgreSQL schema, Prisma migration, database seed, manual ingestion command, structured logs, caching, rate limiting, response validation, provider timeouts, and RSS SSRF controls.
- Device-local Light, Dark, and System themes with a pre-hydration theme bootstrap to prevent a wrong-theme flash.
- Opt-in fixtures for local development and tests; disabled by default and never required by the production UI.

## Architecture

```text
NewsAPI       GDELT       Bing News RSS       trusted publisher feeds
   \            |              |                       /
        provider adapters
                |
          normalization
                |
  multilingual country/entity signals + layered source resolution
                |
 URL deduplication + hybrid semantic/lexical clustering
                |
             ranking
                |
      PostgreSQL through Prisma
                |
       GET /api/news + cache
                |
        map-driven React UI
```

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

Database reads apply the time range, selected countries, topic, language, and text search in PostgreSQL before mapping records. The final deterministic bilateral relevance and popularity ranking stays in application code. There is no pre-filter 250-story truncation, so newest sorting and pagination remain correct for larger stored datasets.

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
8. Logs received, normalized, rejected, duplicate, stored, and story counts without logging secrets.

Without `DATABASE_URL`, the command still fetches, normalizes, deduplicates, clusters, and prints a dry-run summary. Fixtures are used only when `NEWS_FIXTURES_ENABLED=true` is set explicitly.

The command has no hosting-provider dependency. A later deployment can invoke it from cron, a scheduled function, or a worker. Run only one ingestion job at a time until a distributed lock is added.

## Provider behavior

| Provider | Credentials | Default behavior |
| --- | --- | --- |
| GDELT | None | Opt in with `GDELT_ENABLED=true`. Availability and metadata quality can vary. |
| RSS/Atom | None | Reviewed feeds from BBC News, The Guardian, Al Jazeera, CNA, The Straits Times, The Japan Times, DW, Euronews, France 24, Sky News, and NPR are enabled by default. Country-category feeds carry an explicit coverage signal instead of treating every story from a national publisher as domestic news. |
| Bing News RSS | None | Adds a bounded set of country and bilateral discovery queries—including focused Reuters and AP discovery—then extracts the original publisher URL, source name, excerpt, date, and available thumbnail. This is discovery, not a Reuters/AP content licence. |
| NewsAPI | `NEWSAPI_KEY` | Disabled gracefully when the key is absent. |
| Fixtures | None | Disabled by default. Available only as an explicit local development/testing fallback. |

Publisher availability is never assumed. Entries such as BBC, Reuters, AP, NHK, and CNA in the source registry are identity mappings only; they do not claim that a current provider or subscription returns those publishers.

Publisher identity and country resolution is layered. Maintained registry identities and provider-specific identifiers take precedence, followed by canonical registrable-domain matching, provider metadata, reviewed RSS configuration, and reliable ccTLD signals. Generic domains such as `.com`, `.org`, and `.net` never create a country assignment. Resolution method and confidence are retained internally for logs and tests, while the public API continues to expose the same source shape.

RSS items are accepted only when the publisher supplies a parseable publication time. Missing, invalid, implausibly future, or out-of-range dates are rejected rather than being relabelled as newly published.

### Configuring approved RSS feeds

`RSS_FEEDS_JSON` replaces the default feed list with an operator-reviewed array like this:

```json
[
  {
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
GET /api/news?countries=JP&source=The+Japan+Times&source=Al+Jazeera
GET /api/news?countries=JP&period=30d&sort=newest&page=2
```

Typed values:

- `countries`: zero to two unique ISO 3166-1 alpha-2 codes.
- `sourcePerspective`: `all`; `local` or `international` for one country; `first-country`, `second-country`, or `international` for two countries.
- `period`: `latest`, `24h`, `7d`, or `30d`.
- `sort`: `newest` (strict publication-time order) or `popular` (multi-source coverage and story-importance score).
- `source`: repeatable exact news-outlet name; up to 20 outlets.
- `topic`: lowercase topic slug.
- `language`: BCP 47-style short language tag when metadata exists.
- `search`: at most 120 characters.
- `page`: 1–100; `pageSize`: 1–250.

Invalid combinations return a sanitized `400` response. The API uses a short in-memory result cache and a best-effort per-instance rate limit. A multi-instance production deployment should replace both with shared infrastructure such as Redis.

## Caching and request control

- API responses are cached per normalized query for 30 seconds in a bounded in-memory cache.
- Provider requests are coalesced while in flight. Successful results are cached for five minutes, empty results for 45 seconds, and failures for 20 seconds, preventing rapid retry amplification.
- Provider caching is capped at 160 entries. The request limiter is capped at 2,000 client windows and trusts the deployment-provided Cloudflare client address before generic proxy headers.
- The cache and limiter expose small store interfaces so a multi-instance deployment can replace process-local state with Redis, Durable Objects, or KV without changing the API contract.
- Bing country discovery uses at most eight upstream searches per focused request, including Reuters and AP discovery.

No cache key, log entry, or API response contains provider credentials.

## Theme preferences

The Settings page and every news-page header provide Light, Dark, and System controls. System is the default. A manual selection is stored in browser `localStorage`, never sent to the server, and applies across the country, comparison, and settings pages. A small server-rendered bootstrap runs before page content and resolves the theme before hydration to avoid a light-to-dark flash. Both themes use shared CSS design tokens, preserve map hover/selected states, and respect reduced-motion preferences.

## Ranking and two-country relevance

Ranking is deterministic and politically neutral. Newest sorting uses publication time. Popularity is an explicit coverage proxy—not readership data—and prioritizes story importance, independent-source count, source-country diversity, geographic relevance, and modest recency. Two-country results require both countries through direct article or reviewed country-category signals, reward balanced country relevance and bilateral headline focus, and penalize long incidental country lists. A publisher's home country alone never creates a bilateral match.

Country detection is provider-independent and combines explicit coverage metadata, structured locations, names from twelve language datasets, curated aliases/demonyms/cities, conservative ISO handling, and lower-confidence URL path hints. Publisher origin remains strictly separate from article subject geography.

Clustering keeps lexical comparison as a cheap deterministic signal and adds a provider-independent `TextEmbeddingProvider` boundary. The configured OpenAI adapter batches requests, validates vector responses, enforces a timeout, and sends only normalized headline, short description, detected country codes, and topic labels. Candidate generation narrows semantic comparisons by time, country, topic, entity, and lexical overlap. Embeddings use a stable semantic-content hash in a bounded 24-hour process-local cache. Story fingerprints remain based on stable headline/country attributes rather than model vectors. Missing configuration, invalid responses, timeouts, and provider failures all fall back to lexical clustering without interrupting ingestion.

## Security and content handling

- Secrets stay in server environment variables.
- API parameters and provider response shapes are validated.
- Provider calls use bounded timeouts and isolated failure handling.
- RSS ingestion is allow-list only and applies SSRF-oriented URL, DNS, redirect, protocol, and size checks.
- Article/image URLs are restricted to HTTP(S), external article links use safe target attributes, and provider error details are not returned to ordinary users. A reviewed same-origin media relay resolves missing publisher `og:image` metadata and rejects unapproved article, image, and redirect hosts.
- Security headers include CSP, frame denial, content-type protection, a restrictive permissions policy, and a strict referrer policy.
- Full article bodies are never stored or rendered by this MVP. Live cards show attribution, metadata, permitted short descriptions, and original-publisher links.

## Licensing and provider limitations

- NewsAPI plan restrictions and production rights depend on the operator's account and current terms. Verify them before deployment.
- Bing News RSS discovery is used only for headline-level, private, non-commercial exploration and links directly to the discovered publisher URL. Review Microsoft's current terms before changing that usage model.
- GDELT can supply broad discovery metadata but does not grant rights to republish publisher content. The original publisher's rights still apply.
- RSS availability does not automatically grant permission to archive, reproduce, translate, or commercially reuse full content. Enable only reviewed feeds and retain only permitted metadata/excerpts.
- Images and descriptions may have separate rights or hotlinking restrictions. A production operator should disable or proxy only expressly licensed media according to publisher/provider terms.
- This repository does not include licensed Reuters, AP, or other full-content feeds and does not claim that any named publisher is currently available.

Review the current official terms for every selected provider and publisher before production use.

## Current MVP limitations

- Multilingual country detection now combines structured metadata, aliases, demonyms, cities, ISO codes, and geographic URL hints, but ambiguous geopolitical references and locations outside the curated major-city set remain best-effort.
- Story clustering uses hybrid semantic and lexical similarity when semantic embeddings are explicitly configured and gracefully falls back to deterministic lexical clustering otherwise. The embedding cache is process-local rather than shared or database-backed.
- Publisher-country resolution uses a structured registry, provider identifiers, RSS metadata, registrable domains, and reliable ccTLD signals; truly unknown, globally hosted, or internationally repurposed country-code domains may remain unclassified.
- Cache and rate-limit state are process-local; multi-instance deployments should use a shared implementation.
- Live-provider browsing is finite for the chosen time range and provider result windows. Infinite scroll paginates the complete candidate set; it does not crawl publisher sites or bypass provider/API limits.
- No automatic translation, accounts, saved stories, admin UI, or full-content storage is implemented.
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

The test suite covers selection limits and deselection, one- and two-country matching, source-country perspectives, multilingual country/entity signals, ambiguous country terms and ISO false positives, layered publisher/domain/ccTLD resolution, provider normalization, canonical URLs, deduplication, hybrid semantic clustering, embedding batching/caching/timeouts/fallback, two-country relevance, provider failure isolation and coalescing, RSS publication dates, API validation, bounded rate limiting, progressive pagination, and theme persistence. GitHub Actions starts PostgreSQL 17, applies the real migration, and runs integration tests for persistence, repeated ingestion, reclustering, stale-story cleanup, database filtering, newest ordering, two-country results, and pagination beyond 250 stories.
