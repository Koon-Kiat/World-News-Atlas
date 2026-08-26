# Worldline

Worldline is a production-minded MVP for exploring world news through an interactive map. It works immediately for an anonymous visitor: global coverage appears with no setup, one selected country shows stories involving that country, and two selected countries surface stories meaningfully related to both.

Fixture mode is deliberately labelled in the interface. It demonstrates the complete experience without presenting sample stories as live reporting.

## What is implemented

- Responsive D3 world map with hover, click, keyboard selection, deselection, clear selection, and an explicit two-country limit.
- Global, one-country, and two-country exploration.
- Local/international perspective filtering based on publisher country—not article subject.
- Bilateral source filters for first-country, second-country, and outside sources.
- Topic, language, time, and keyword filters.
- Story-first results with grouped publisher coverage and links to original live articles.
- Provider adapters for NewsAPI, GDELT, and administrator-approved RSS/Atom feeds.
- Provider-independent source registry and many-to-one provider identifier mapping.
- Deterministic country detection, topic classification, URL canonicalization, deduplication, story clustering, and ranking.
- PostgreSQL schema, Prisma migration, database seed, manual ingestion command, structured logs, caching, rate limiting, response validation, provider timeouts, and RSS SSRF controls.
- Fixture fallback when the database has no stored stories or is unavailable.

## Architecture

```text
NewsAPI       GDELT       trusted RSS feeds
   \            |             /
        provider adapters
                |
          normalization
                |
  country detection + source registry
                |
    URL deduplication + clustering
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

Requirements: Node.js 20 or newer and npm.

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. The UI and all core interactions use clearly marked fixtures. PostgreSQL and provider credentials are optional for this mode.

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

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | For persistence | PostgreSQL connection string used only on the server. |
| `NEWSAPI_KEY` | No | Enables NewsAPI ingestion. Missing credentials disable only this adapter. |
| `GDELT_ENABLED` | No | Enables credential-free GDELT ingestion; defaults to `true`. |
| `NEWS_FIXTURES_ENABLED` | No | Uses fixtures when every live ingestion provider returns no articles; defaults to `true`. |
| `NEWS_PROVIDER_TIMEOUT_MS` | No | External request timeout, clamped to 2–30 seconds; defaults to 8 seconds. |
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
6. Builds deterministic story clusters.
7. Persists articles, provider references, country/topic relations, and stories when `DATABASE_URL` is set.
8. Logs received, normalized, rejected, duplicate, stored, and story counts without logging secrets.

Without `DATABASE_URL`, the command still fetches, normalizes, deduplicates, clusters, and prints a dry-run summary. If all configured live providers fail or return no articles, fixtures keep the pipeline testable unless `NEWS_FIXTURES_ENABLED=false`.

The command has no hosting-provider dependency. A later deployment can invoke it from cron, a scheduled function, or a worker. Run only one ingestion job at a time until a distributed lock is added.

## Provider behavior

| Provider | Credentials | Default behavior |
| --- | --- | --- |
| GDELT | None | Opt in with `GDELT_ENABLED=true`. Availability and metadata quality can vary. |
| RSS/Atom | None | Publisher-operated world feeds from BBC News, The Guardian, Al Jazeera, and CNA are enabled by default. |
| NewsAPI | `NEWSAPI_KEY` | Disabled gracefully when the key is absent. |
| Fixtures | None | Used for the initial UI and when a live ingestion batch is empty. Clearly labelled as sample content. |

Publisher availability is never assumed. Entries such as BBC, Reuters, AP, NHK, and CNA in the source registry are identity mappings only; they do not claim that a current provider or subscription returns those publishers.

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
    "scope": "NATIONAL"
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
```

Typed values:

- `countries`: zero to two unique ISO 3166-1 alpha-2 codes.
- `sourcePerspective`: `all`; `local` or `international` for one country; `first-country`, `second-country`, or `international` for two countries.
- `period`: `latest`, `24h`, `7d`, or `30d`.
- `source`: repeatable exact news-outlet name; up to 20 outlets.
- `topic`: lowercase topic slug.
- `language`: BCP 47-style short language tag when metadata exists.
- `search`: at most 120 characters.
- `page`: 1–100; `pageSize`: 1–250.

Invalid combinations return a sanitized `400` response. The API uses a short in-memory result cache and a best-effort per-instance rate limit. A multi-instance production deployment should replace both with shared infrastructure such as Redis.

## Ranking and two-country relevance

Ranking is deterministic and politically neutral. The current score combines recency, geographic relevance, story importance, independent source count, and source-country diversity. Two-country results require both countries through direct article signals or a publisher from one selected country reporting on the other, reward balanced country relevance and bilateral headline focus, and penalize long incidental country lists.

These modules are intentionally replaceable. Future entity extraction, embeddings, or human editorial signals can be added without changing provider adapters or UI contracts.

## Security and content handling

- Secrets stay in server environment variables.
- API parameters and provider response shapes are validated.
- Provider calls use bounded timeouts and isolated failure handling.
- RSS ingestion is allow-list only and applies SSRF-oriented URL, DNS, redirect, protocol, and size checks.
- Article/image URLs are restricted to HTTP(S), external article links use safe target attributes, and provider error details are not returned to ordinary users.
- Security headers include CSP, frame denial, content-type protection, a restrictive permissions policy, and a strict referrer policy.
- Full article bodies are never stored or rendered by this MVP. Live cards show attribution, metadata, permitted short descriptions, and original-publisher links.

## Licensing and provider limitations

- NewsAPI plan restrictions and production rights depend on the operator's account and current terms. Verify them before deployment.
- GDELT can supply broad discovery metadata but does not grant rights to republish publisher content. The original publisher's rights still apply.
- RSS availability does not automatically grant permission to archive, reproduce, translate, or commercially reuse full content. Enable only reviewed feeds and retain only permitted metadata/excerpts.
- Images and descriptions may have separate rights or hotlinking restrictions. A production operator should disable or proxy only expressly licensed media according to publisher/provider terms.
- This repository does not include licensed Reuters, AP, or other full-content feeds and does not claim that any named publisher is currently available.

Review the current official terms for every selected provider and publisher before production use.

## Current MVP limitations

- Country detection is conservative and primarily optimized for English metadata.
- Lexical clustering is effective for close headline variants but is not semantic clustering.
- Source-country discovery for unknown domains depends on provider/config metadata and will need an expanded maintained registry.
- Cache and rate-limit state are process-local.
- No automatic translation, accounts, saved stories, admin UI, or full-content storage is implemented.
- Fixture URLs are intentionally non-live and shown as “Sample article” rather than pretending to be publisher links.

## Validation

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

The test suite covers selection limits and deselection, one- and two-country matching, source-country perspectives, country/source distinction, ambiguous country terms, provider normalization, canonical URLs, deduplication, clustering, two-country relevance, provider failure isolation, API validation, and rate limiting.
