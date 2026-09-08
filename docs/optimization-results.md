# Production optimization and reliability pass

Measurements below distinguish observed local results from source-derived counts. They do not claim production latency or field Web Vitals.

## Baseline (7 September 2026)

- `/country` and `/compare`: server constructs an empty response; hydration triggers one `/api/news` request before any useful stories. Normal API reads join the D1 candidate pool and supplement incomplete coverage with live providers before returning.
- Search uses `useDeferredValue`, which can schedule a server request for each character. No debounce interval exists.
- Twelve visible story cards plus the header mount 13 saved-story hooks: 26 saved-state window listeners and 13 initial storage reads/parses. Each mutation triggers another read in every hook.
- Map wheel events always call `preventDefault`; every view update executes geometry generation for all country paths. Every country is a sequential Tab stop.
- D1 materializes up to 1,000 complete story candidates, with sequential relation queries in chunks of 80 and repeated full-array filtering during reconstruction.
- Recent successful GitHub ingestion runs lasted 58–134 seconds. Run `34001481274` failed on 6 September with HTTP 500 after about 51 seconds in its trigger step. Logs establish the HTTP failure, not its underlying server cause. The workflow exits immediately, without retries or later scopes.
- Both country passes intentionally advance `nextCountryBatch` in D1, alternating priority and regular country lanes. Preserve all three logical invocations.
- Existing dependency override/lockfile edits were present before this work and are preserved.

## Performance results (8 September 2026)

| Probe | Before | After |
| --- | --- | --- |
| Explorer static JavaScript dependency closure | 1,350,623 bytes / 426,014 gzip | 634,005 bytes / 199,634 gzip (53% less gzip) |
| Landing static JavaScript dependency closure | 686,807 bytes / 225,602 gzip | 611,858 bytes / 191,369 gzip (15% less gzip) |
| Global emitted CSS | 518,762 bytes / 104,506 gzip | 133,326 bytes / 27,451 gzip (74% less gzip) |
| D1 full candidate first-page probe, milliseconds | 5,070 / 5,127 / 4,960 | 379 / 332 / 328 |
| D1 bounded display first-page probe, same 1,000 stories | Full materialization above | 390 / 405 / 430 (median 405ms, 92% lower than baseline) |
| Saved state for 12 cards + header | 13 reads/parses, 26 window listeners | One initial read, one storage listener, one root subscription |
| Ten rapid search changes | No debounce; up to one request per change | One request after 400ms; explicit submit immediate |
| Map view changes | Rebuild/reconcile country paths each frame | Precomputed geometry, memoized subtree, rAF transform updates |
| Initial stored stories | Empty HTML, hydrate then API | 12 stories in HTML, no matching hydration API fetch |

The D1 benchmark uses the same Node-to-Miniflare D1 bridge, migrations, synthetic 1,000-story seed and fixed query, timing reads plus application ranking and excluding runtime startup/seed. It asserts exact page equality and traverses all 84 twelve-story pages without missing or duplicate IDs for both newest and popularity order. It verifies actual D1 pages 43 and 84 against the full ranking. Run `npx vitest run tests/d1-performance.test.ts`; set `NEWS_BENCHMARK_OUTPUT` to a local JSON path to capture the samples. Bridge timings are noisy and are not hosted API p95 measurements.

Bundle figures come from production `dist/client/.vite/manifest.json`: recursively sum static imports for the route, browser entry and PWA registration, counting each file once, and gzip each file with Node `zlib.gzipSync`. Deferred map/globe/reader chunks are excluded from this critical dependency total, not from the eventual visit's network cost. The map retains the complete 50m topology, including Singapore. Full map chunk gzip is about 236KB and landing globe about 44KB. The full schema validator adds about 14KB gzip to shared saved state; the net route figures include that cost. Global design CSS remains shared because the largest measured problem was embedded flags; a broad selector rewrite would add risk for much smaller savings.

A local production Worker with the same 1,000-story D1 seed returned `/country` in 68ms and `/compare` in 38ms, with 12 story cards in each HTML document (~59KB uncompressed), before browser code executed. These are separate warm local HTTP observations, not comparable to bridge timings. The browser loaded 236 accessible country paths with exactly one Tab stop, opened the lazy reader, and recorded no console warnings/errors. Both Vinext and native Next production HTML had response-matching nonces on every inline framework script on `/country`, `/saved` and `/settings`. Native Next build output confirms dynamic rendering for all document routes.

## Ingestion and security evidence

The previous workflow's observed HTTP 500 does not establish a provider or platform root cause. The replacement preserves all three scopes and uses signed stable logical IDs, three transient transport attempts, fresh nonces, jitter/backoff, capped Retry-After, separate bounded running/busy polling, and a five-minute total budget per scope. Connections time out at 10s, requests at at most 165s (clamped to the remaining scope deadline), and the job at 18 minutes. Later successful scopes retain their summaries and writes; any failed required scope makes the CLI exit nonzero. Tests cover a normal 150s response, polling after a genuine disconnect during 140s work, and timeout clamping to the scope deadline.

Real Miniflare D1 tests verify shared quotas across independent limiter instances, atomic concurrent logical claims, lost-response current/recorded results, body conflicts, nonce replay rejection, lease expiry/recovery, terminal failed keys and record cleanup. Internal/transient failures use `FAILED_RETRYABLE`, with at most three server attempts; permanent provider failures and exhausted attempts use `FAILED_TERMINAL`. A saved country/window plan and unique attempt token preserve checkpoint resume and fence expired workers. The integration regression fails a checkpoint write after stories persist, then retries the same signed logical ID with fresh authentication, skips completed work, and succeeds without duplicate articles/stories. Route tests retain HMAC, expiry, body and terminal no-rerun coverage. `0001_parallel_martin_li.sql` adds only rate-limit, logical-request and lease tables/indexes; `0002_ingestion_retries.sql` adds retry metadata to control tables. Existing news tables and stored coverage are unchanged. See [production deployment order and commands](production-deployment.md).

The production primitive is D1 because it is already exposed by this Sites deployment; no supported configurable edge limiter binding was established for Sites. The local limiter is a cheap first layer, never the only production enforcement. A missing/failed shared limiter returns 503; 429 includes the reset interval. Forwarded headers cannot select an arbitrary quota, and active quotas are not evicted at capacity.

CSP blocks arbitrary inline scripts, script attributes, arbitrary image origins and arbitrary production connections. The same-origin theme bootstrap runs before content. Request nonces cover framework Flight scripts; native Next explicitly renders documents per request. This precludes shared document caching, while database API and static assets retain their own cache policies. Inline styles remain for current React visual effects. Image tests exercise disallowed hosts/ports, redirect revalidation, bad MIME, dishonest lengths, oversized streams and a stalled body; the original allowlists, path restrictions, timeout and graceful fallback remain. Public health is liveness only.

One independent read-only security investigator and one fresh candidate reviewer examined these boundaries. The final reviewer identified the status-polling timing regression and the native Next static nonce mismatch; both were corrected and covered by focused execution. No other concrete bypass was reported in that review.

## Requirement audit

| Request items | Implementation and evidence |
| --- | --- |
| 1: inspect/trace/baseline/logs | Baseline above; original request/render/ingestion paths traced; GitHub run 34001481274 inspected; no invented root cause. |
| 2–4: corpus, SSR, D1 | `initial-news.server.ts`, `d1-store.ts`, paged complete API path; bounded 1.2s stored-only SSR; batch joins/grouped reconstruction; D1 performance and initial-news tests. |
| 5–6: search/cache | 400ms debounce and immediate submit; abort guards; ordinary HTTP cache permitted, live/continuation no-store; search/initial-render and HTTP security tests. |
| 7: distributed limits | Atomic bounded D1 limiter; canonical trusted identity; shared-instance, reset, header, 429 and fail-closed tests. |
| 8–11: map/picker/filters | Ctrl/Cmd-wheel with uncaptured normal scrolling, zoom/reset/pointer drag; roving map focus; active-descendant comboboxes; keyboard-controls tests. |
| 12–14: saved state | Shared provider, complete versioned validation/migration, safe failures, cross-tab sync and ten-second Undo; six saved-story tests. |
| 15–16: PWA | Versioned network-first known shell, successful/cacheable responses only, 80 hashed assets, API/private exclusion, static offline fallback; deterministic CacheStorage tests. |
| 17–18: CSP/health | Nonce framework scripts/external theme; narrowed sources; liveness-only response; response tests and actual production HTML verification. |
| 19–21: rendering/bundles/CSS | Static geometry memoization/rAF; map/globe/reader splitting and stable placeholders; flag asset extraction; measured totals above. |
| 22, 30: image/security preservation | Bounded body streaming and cancellation through the unchanged reviewed URL boundary; security-trigger and legitimate-image tests; HMAC/nonce and safe external links retained. |
| 23–28: scheduled ingestion | Built-in Node runner; D1 idempotency/expiring operation lock; response validation; sanitized scope summaries; continue-after-failure and nonzero-exit tests. |
| 29: provider resilience | Bounded 32s provider batches, independent failures, checkpoint/persistence guards and partial results; ingestion/provider tests. |
| 31–33: time/races/progressive pages | Stable server reference time; obsolete request and pagination abort guards; snapshot continuation retained across completed ingestion; one fetch at a time, manual retry and no-growth backoff tests. |
| 34–35: checks/migrations | Full required check suite, focused security/UI/ingestion tests, both builds, generated migration validation and local D1 application. Final command results recorded below. |
| 36–37: performance/coverage | Measured table, 12-card HTML, exact 1,000-story traversal and unchanged corpus defaults; no provider/country/window removed. |
| 38–39: code/docs | Existing dependencies/native APIs; cohesive helpers, no framework/storage replacement, no redesign; README documents all changed architectures. |
| 40: delivery/constraints | Concise final report plus this evidence file. No branch-rule or repository-secret modifications. Existing dependency edits preserved. |

## Verification commands

- `npm ci`: passed, zero reported installation vulnerabilities.
- `npm run db:generate`: passed; generated migration and snapshot/journal.
- `npm run db:check`: passed.
- `npm run db:migrate:local`: all three migrations applied successfully; a second application reported no pending migrations. Real D1 tests also verify an upgrade preserves populated news tables.
- `npm run check`: lint/typecheck/full 43-file, 287-test suite passed after the ingestion retry follow-up. The focused ingestion/idempotency/migration run passed all 32 tests before adding one further missing-credential terminal regression, also covered by the final full suite.
- `npm run build`: passed; native `npm run build:next` also passed and verified nonce-compatible dynamic documents.
- Focused D1, image, HTTP, PWA, saved-state, keyboard, search/race, ingestion/workflow and progressive tests passed during development. A lazy globe test was updated to await the asynchronous chunk under full-suite load.
- Local `npm run dev` startup and production Worker startup passed after replacing duplicate merged D1 bindings in Vite configuration.
- `npm audit --audit-level=high`: passed, zero vulnerabilities. `git diff --check`: passed.

## Limits of the evidence

Lighthouse is not installed in this environment. LCP, INP, CLS and a numeric accessibility score were not measured; no field-score claim is made. The initial map/globe placeholders reserve layout space, and keyboard behavior has focused tests and browser confirmation.

Live discovery snapshots remain process-local (the existing explicit reset behavior survives Worker eviction). D1 quotas and ingestion state are shared and durable. Provider outages, finite upstream archives and platform restarts can still cause honest partial coverage or a visibly failed schedule. The workflow reports these failures; it cannot guarantee an upstream provider's availability. Real hosted end-to-end ingestion latency remains deployment-dependent.
