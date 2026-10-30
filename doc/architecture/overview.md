# Architecture and data flow

[Documentation index](../README.md)

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

The browser obtains news through this application's `/api/news` route rather than calling providers directly. Provider credentials and RSS configuration are never exposed through public environment variables or client components.

## Initial rendering and progressive coverage

`/country` and `/compare` render up to 12 stored stories in the initial HTML. The server gives D1 1.2 seconds to return useful data; unavailable, empty or slow storage returns the normal shell and lets client/live discovery recover. External providers never run on this HTML path. Hydration reuses matching stored results. Partial stored coverage establishes a live/hybrid continuation when the list approaches the viewport, keeping the initial stories visible.

D1 ranks the full configured candidate pool using compact article metadata, then retrieves display text/URLs only for the selected page. Complete database-backed API responses use the same bounded display query. Batched relations and grouped reconstruction replace serial per-chunk reads; hybrid reconciliation still loads full candidates for cross-provider clustering. Default corpus/candidate limits, ranking, source diversity, country rotation and time windows are unchanged. Pagination retains one request at a time, aborts on filter changes, prefetches within 500px, deduplicates and sorts results, bounds automatic no-growth retries, and always permits a manual retry. Searches debounce for 400ms; Enter/Search submits immediately.

Ordinary database responses retain the API's public HTTP cache policy. The browser no longer forces every request to bypass that cache. Live responses and explicit continuations use `no-store`; an active continuation is not replaced by a newly complete database window. The map, landing globe and reader have separate client chunks and reserved placeholders. Complete flag geography remains available, with flags emitted as separate cached SVG assets instead of embedded into global CSS.

## Persistence

The normalized schema includes the news entities plus provider runs, checkpoints, scheduler state, and one-time request nonces. Checkpoints record the discovery key, country/language shard, fixed window, cursor, covered boundaries, completion state, counts, and last successful update. Story count alone is never treated as proof of coverage.

D1 reads apply the time range, selected countries, topic, language, source, and text search before mapping records. The final deterministic bilateral relevance and popularity ranking stays in application code. Candidate loading is bounded to 1,000 matching stories by default (operator-configurable from 300 to 5,000) after the database sort.

Article/story persistence is transactional and idempotent. Ingestion persists after every bounded provider stage, so a stopped worker resumes its cursor instead of restarting page 1 or the newest date window. A repeated fixed backfill snapshot skips checkpoints that already cover it; a later snapshot requests only the uncovered time edge and merges that coverage into the existing watermark.

The scheduled GitHub workflow never receives database credentials. It makes several small sequential requests to the Sites ingestion endpoint, which performs provider work and writes through the server-only D1 binding. Requests use HMAC-SHA256 over the exact timestamp, nonce, and body; D1 records each nonce atomically to reject replay.

## Caching and request control

- Live query corpora are cached for 60 minutes, capped at 40 entries, and keyed by countries, perspective, source IDs, topic, language, period, sort, search, and non-secret provider configuration.
- Provider requests are coalesced while in flight. Successful results are cached for five minutes, empty results for 45 seconds, and failures for 20 seconds, preventing rapid retry amplification.
- Provider caching is capped at 160 entries. The local limiter retains at most 2,000 windows; production also enforces a D1-backed quota with at most 10,000 keys. Only a trusted Cloudflare address is used; generic proxy headers are ignored. See [security](security.md).
- The live cache exposes a small store interface for a future shared implementation. The production limiter already uses the supported Sites D1 binding; no Redis, Durable Object or paid dependency is required.
- A single live stage processes no more than `NEWS_LIVE_BATCH_SIZE` candidates. Raw provider round-robin is preserved, but only query-relevant articles consume period-aware corpus capacity. Bing runs at most two upstream plans per stage and 18 over the finite plan set.
- The browser prefetches cached internal pages until roughly 30–50 stories are ready ahead. When the server-side matching buffer reaches `NEWS_LIVE_LOW_WATER`, one further bounded provider stage can run. Opening the page does not continuously refetch providers while enough cached material remains.

No cache key, log entry, or API response contains provider credentials.

## Ranking, country detection and clustering

Ranking uses deterministic coverage and relevance signals. Newest sorting uses publication time. Popularity is a coverage proxy and prioritizes story importance, independent-source count, source-country diversity, geographic relevance, and modest recency; it does not measure readership. Two-country results require both countries through direct article or reviewed country-category signals, reward balanced country relevance and bilateral headline focus, and penalize long incidental country lists. A publisher's home country alone never creates a bilateral match.

Country detection is provider-independent and combines explicit coverage metadata, structured locations, names from twelve language datasets, a compact generated geography file, reviewed aliases/subdivisions/institutions, conservative ISO handling, and lower-confidence URL hints. The generated file comes from the ODbL-1.0 `mledoze/countries` dataset pinned to commit `9eff32e4eef26715aa59d99b200127d1ef150e7a`; `npm run data:update-countries` refreshes it deliberately. Ambiguous capitals are excluded from automatic signals. All detection remains server-side, and publisher origin remains separate from article subject geography.

Language inference trusts provider/feed metadata first, then high-confidence Kana and Hangul scripts, then a small conservative Latin-language marker classifier. Long Latin-script text is no longer assumed to be English; unsupported or ambiguous text remains `und`, including Han-only text without reliable metadata.

Clustering keeps lexical comparison as a cheap deterministic signal and an optional provider-independent embedding boundary. New members must match the stable representative and, for deeper clusters, supporting members; single-link A≈B≈C chains no longer merge when A and C are different events. Cross-language reports can still merge when semantic evidence matches the representative. Embeddings remain optional; deterministic lexical clustering is fully functional without API credits.

## Limits

- Coverage remains limited by configured provider availability, provider/API result limits, publisher metadata quality, and licensing. RSS/Bing snapshots cannot prove a complete historical archive; GDELT/NewsAPI can broaden discovery but still do not guarantee every publisher or event.
- Story clustering uses hybrid semantic and lexical similarity when semantic embeddings are explicitly configured and gracefully falls back to deterministic lexical clustering otherwise. The embedding cache is process-local rather than shared or database-backed.
- Publisher-country resolution uses a structured registry, provider identifiers, RSS metadata, registrable domains, and reliable ccTLD signals; truly unknown, globally hosted, or internationally repurposed country-code domains may remain unclassified.
- The durable article corpus, ingestion checkpoints, scheduler state, and replay nonces are shared in D1. Live browsing continuation remains process-local and resets honestly after an isolate restart; production request quotas and GDELT cooldowns are shared in D1.
- Live-provider browsing is finite for the chosen time range and provider result windows. Infinite scroll can progressively accumulate 200+ stories where providers supply enough unique coverage, but it stops at the configured corpus maximum and never crawls publisher sites or bypasses provider/API limits.
- No automatic translation, user accounts, admin UI, or full-content storage is implemented. Saved articles use browser-local storage and do not sync across devices.
- Fixture URLs are intentionally non-live and shown as “Sample article” rather than pretending to be publisher links.

Implementation: [initial rendering](../../src/lib/news/initial-news.server.ts), [live and hybrid discovery](../../src/lib/news/data-store.ts), [D1 store](../../src/lib/news/d1-store.ts), [ranking](../../src/lib/news/ranking.ts), [clustering](../../src/lib/news/cluster.ts). For schedules and recovery, see [ingestion](../operations/ingestion.md).
