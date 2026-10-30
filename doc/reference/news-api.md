# News API

[Documentation index](../README.md)

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
- `period`: `latest` (default, past 72 hours), `24h`, `7d`, or `30d`.
- `sort`: `newest` (strict publication-time order) or `popular` (multi-source coverage and story-importance score).
- `source`: repeatable stable publisher ID; up to 20 outlets. Maintained display names remain accepted for compatibility.
- `topic`: lowercase topic slug. The shared UI/backend set is politics, business, technology, society, climate, defence, transport, culture, and sports.
- `language`: BCP 47-style short language tag when metadata exists.
- `search`: at most 120 characters.
- `page`: 1–100, default 1; `pageSize`: 1–250, default 12.
- `continuation`: server-issued live corpus identifier, 16–64 hexadecimal characters; reuse with matching filters.

Internal pages power infinite continuation only; the normal interface has no numbered-page navigation. Response metadata separates materialized story clusters from individual articles and distinguishes `hasMore`, `discoveryExhausted`, `archiveCoverageComplete`, `coverageComplete`, `coverageDegraded`, `coverageStatus`, and `corpusLimitReached`. A finite Bing/RSS stop or safety cap can make `hasMore=false` without claiming complete 30-day coverage. The UI labels such counts as discovered/currently available coverage. If process-local state disappears between scroll requests, the continuation ID is rejected explicitly and the interface replaces the stale feed with a fresh first page instead of silently appending a restarted corpus.

Invalid combinations return a sanitized `400` response. Live responses and explicit continuations are `no-store` because requesting continuation can expand the server-side corpus even when an internal page repeats. D1 enforces production quotas across instances. Live continuation corpora remain process-local; expired or unavailable continuations return an explicit reset and recover through the existing discovery path.

The parser accepts syntactically valid topic slugs; the listed topics are the UI vocabulary, not a parser enum. Unknown slugs can return no matches. Sources are limited to 80 characters each and languages to 12 characters.

Implementation: [query validation](../../src/lib/news/query.ts), [response types](../../src/lib/news/types.ts), [API route](../../src/app/api/news/route.ts).
