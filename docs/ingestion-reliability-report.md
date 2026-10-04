# Ingestion reliability and repository audit

## Scope and release status

This work addresses scheduled ingestion, provider execution, durable recovery, scheduling pressure and the surrounding repository. It does not deploy a Worker, apply remote migrations, change secrets, trigger production ingestion, or claim that upstream outages have ended. Production verification follows [the deployment procedure](production-deployment.md).

The starting revision was `8556b5c1a5f9473c126eb102dda5e82329228129`. Inspection covered the workflow → signed scheduler request → logical request/lock → provider stages → persistence/checkpoints → completion → Actions result path before implementation. The broader review covered public routes, URL boundaries, rendering/local storage, caches, clustering and country/source handling, operational scripts, configuration, migrations, dependencies and tests. The security review uses source evidence; a lack of a validated finding is not proof that every deployment or dependency is vulnerability-free.

## Root causes and evidence

1. **Failure semantics conflated two decisions.** A transient provider error could exhaust the third logical attempt and become `FAILED_TERMINAL`/422. The scheduler then treated it as permanent even when other providers had persisted useful data. A budget limit says when this operation must stop, not whether GDELT will recover.
2. **The schedule repeatedly requested historical discovery.** The half-hour job requested `30d`, including multiple discovery branches and two country batches. The second country invocation was intentional rotation, not an accidental duplicate. Repeating historical work this often increased upstream pressure.
3. **Pacing was local to one runtime.** Module-level request spacing did not coordinate live browsing with ingestion or separate Worker isolates. An operation lock serialized ingestion but could not serialize public discovery. Shared D1 control is justified by these real independent callers.
4. **Retry information was lost or shortened.** Provider errors did not consistently carry upstream Retry-After, and the scheduler capped waits at 30 seconds. Live discovery also used a fixed 1.5-second retry interval. Multiple layers could retry before an upstream cooldown ended.
5. **Partial progress and deadlines were incomplete.** Some providers discarded branch errors when another branch succeeded; RSS/Bing could mark failed plans complete. Fetch timeouts ended at headers, and an outer timeout did not cancel underlying work. Partial live results skipped cursor updates.
6. **Recovery had data-integrity gaps.** Re-ingesting a subset of a story could remove untouched article associations. Corrupt cursor JSON silently became a fresh cursor. JavaScript lease checks left a gap before actual data mutations, although plan and final-state writes already checked tokens.

The historical symptom supplied with the task was `http_422 (GDELT: HTTP_429)`. Current investigation also inspected [Actions run 37112777920](https://github.com/Koon-Kiat/World-News-Atlas/actions/runs/37112777920): its global pass stored 96 articles/95 stories but failed after three attempts with `OTHER: REQUEST_FAILED`; the country passes eventually succeeded. This supports fixing the general outcome/retry model, rather than special-casing only one GDELT code.

## Architecture and outcomes

`ingestion-outcome.ts` owns failure classification and acceptance. Explicit transient HTTP statuses are 408, 425, 429, 500, 502, 503 and 504. Network/stage timeouts and provider cooldown/busy conditions are transient. Storage, lost lease and operation deadline failures are internal retryable failures and cannot produce DEGRADED success. Unknown errors, malformed responses, invalid configuration/state/invariants, query rejection, credentials and other terminal provider errors fail closed.

| Outcome | Required evidence | Durable state and transport | Actions |
|---|---|---|---|
| SUCCESS | Storage succeeded; useful accepted work or a legitimate empty/completed stage; no provider failures | SUCCEEDED, 200 | Success |
| DEGRADED | Same storage/invariant/usefulness requirements; only transient optional provider failures remain | DEGRADED, 200, safe cooldown metadata | Success with explicit degraded summary |
| RETRYABLE_FAILURE | Work cannot currently satisfy acceptance, including no useful providers or storage/runtime failure | FAILED_RETRYABLE, 503 | Bounded retry; nonzero if unresolved |
| Retry budget exhausted | Third retryable operation attempt or expired third attempt | RETRY_BUDGET_EXHAUSTED, 503, retryEligible=false | Stop this logical operation; nonzero |
| TERMINAL_FAILURE | Configuration/authentication/query/schema/state/invariant failure or malformed response | FAILED_TERMINAL, 422 after acceptance; validation/auth failures use their existing 4xx | Nonzero, no retry |

Completed logical records retain their original result for seven days. A fresh scheduler run has fresh logical IDs and can recover after an exhausted operation. A rerun of the same workflow run retains the same pass IDs and does not duplicate completed operations. Body-digest conflicts are rejected. Successful empty stages count as legitimate work; unaccepted raw articles alone do not.

## Retry ownership and deadlines

| Layer | Responsibility and limit |
|---|---|
| Provider | One transient request attempt; classify errors, bound/cancel headers and bodies, retain successful branch cursors. NewsAPI alone retains one existing semantic HTTP-400 fallback that removes hosted date parameters. |
| GDELT coordination | One D1 row shared by live and scheduled callers; atomic 5.5-second start spacing, 429/503 cooldown, bounded exponential fallback, no persistent reservation queue. |
| Ingestion | Pin country plan and snapshot, resume incomplete checkpoints, skip completed ones, at most three logical attempts; 150-second operation budget, 32-second provider stage, existing 180-second renewable lease. |
| Scheduler | Three failed transport/operation responses per pass and separate 12-response running/busy poll ceiling; five minutes per pass, 15 minutes overall, ten-second connection timeout, request timeout at most 165 seconds clamped to remaining time. |
| Actions | One serialized ingestion job, cancel-in-progress=false, unchanged 18-minute timeout including setup. No continue-on-error and no workflow retry loop. |

The reusable parser in `retry-policy.mjs` handles delay-seconds and the HTTP-date wire formats described by [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after). It rejects malformed and normalized impossible dates, clamps past dates to zero and caps delays at 15 minutes. Missing or invalid headers use exponential backoff from 30 seconds, with up to one second of positive jitter. Jitter never shortens a valid minimum. The GDELT failure streak is shared and resets after a 15-minute quiet interval. The documented cap deliberately limits unreasonable upstream values; it is not a promise that the provider is ready when it expires.

Provider errors carry retryAfterMs; the route aggregates and rounds the header up to seconds; the scheduler uses the same parser. A wait that cannot fit the remaining budget ends the pass without an early retry. Retry exhaustion remains separate from terminality. In-flight provider requests are retained rather than evicted at capacity, and timeout cancellation prevents late work from populating a success cache. A shorter coalesced caller deadline does not cancel another caller's shared operation.

## Scheduling and coverage

| Trigger | Period/mode | Purpose |
|---|---|---|
| `*/30 * * * *` UTC | 24h / incremental | Recent stories with overlap for delayed publication |
| `17 2,14 * * *` UTC | 30d / backfill | Historical reconciliation twice daily; 10:17/22:17 Singapore time |
| Manual latest or 24h | Selected period / incremental | Operator-controlled recent discovery |
| Manual 7d or 30d | Selected period / backfill | Operator-controlled archive discovery |

One workflow/job handles all triggers. The named passes are global-discovery, country-rotation-first and country-rotation-next. Country batches are reserved atomically; backfill has its own counter, and single-country batches alternate high-volume and other countries. GDELT remains available under the existing auto/on/off policy. Its branches now run sequentially within the existing 31-second budget; a failure prevents further branch starts, while successful branch cursors remain durable. Provider-limited archive coverage stays explicitly incomplete. The finite rotating schedule cannot promise exhaustive coverage of every country/publisher; operators can use the documented targeted backfill CLI for larger reconciliation work.

## Database, idempotency and fencing

- `0003_provider_rate_control.sql` adds the single-provider pacing/cooldown table.
- `0004_ingestion_retry_deadline.sql` adds a zero-default retry_at column. Existing data and request history are retained.
- Existing migrations remain immutable. Repeated migration-command execution uses the ledger; direct SQL-file replay is not supported. Fresh installation and populated legacy upgrade are tested.
- Lock acquisition, country reservation, cooldown extension and request transitions use D1 atomic operations. [D1 batch execution](https://developers.cloudflare.com/d1/worker-api/d1-database/) rolls back the sequence on a statement failure.
- A production ingestion store binds request ID and attempt token to every data/checkpoint/stage/rotation batch. Its guard checks the lock against the database clock inside the transaction. A stale guard deliberately violates the lock's existing request_id NOT NULL constraint, so the whole batch rolls back. This reuses the existing schema rather than introducing another coordination table.
- HMAC, strict body validation, fresh nonce claims, request digest binding, lock expiry/renewal and fenced completion remain intact. Tests cover old-token rejection, expired/missing locks, duplicate and conflicting requests, replay and interrupted checkpoint recovery.
- Re-clustering moves only incoming article memberships. Both source and destination story filters, dates and representative metadata are rebuilt from actual membership atomically; unrelated members survive. Empty touched stories are removed without scanning/deleting all empty stories globally.

The schema is additive, but old Workers do not understand the new outcome states, retry deadline or shared cooldown. Pause ingestion during behavioral rollback; preserve new columns/history and restore compatible Worker/scheduler versions before resuming. The migration verifier now checks the new table and column as well as the ledger. Production application remains unverified until release.

## Technical-debt decisions

| Priority | Area | Finding | Resolution |
|---|---|---|---|
| P1 | Ingestion semantics | Transient retry exhaustion became terminal; useful persistence could still make Actions red | Central outcome policy and explicit retry-budget state; degraded acceptance requires evidence |
| P1 | Upstream load | Frequent archive scans, process-local GDELT pacing and shortened cooldowns | Separate schedules, shared atomic cooldown, bounded sequential branches, shared parser |
| P1 | Persistence | Partial re-ingestion removed unrelated story members | Reproduced failing regression, then fixed membership-specific writes and metadata reconciliation |
| P1 | Stale workers | Data writes were separated from ownership checks | Transactional token/lease guard on every ingestion mutation; real D1 rejection tests |
| P1 | Cancellation | Provider/body reads could outlive advertised deadlines | Signals cover pacing, metadata, redirects and bounded bodies; active work cannot be evicted into duplicate requests |
| P2 | Continuation | Failed RSS/Bing plans and partial live branches lost recovery state | Complete only fulfilled plans; retain partial cursors and honor cooldown during live discovery |
| P2 | State/configuration | Corrupt cursor and invalid RSS/GDELT config silently fell back | Explicit terminal state/configuration errors with deterministic tests |
| P2 | Embeddings | Optional reads lost timeout protection after headers and had no body bound | One deadline across batches/body, 8MiB streaming limit, cancellation tests; lexical fallback retained |
| P2 | Browser storage | Search submission could throw when localStorage writes failed | Search/history state remains usable; quota/security-error UI test |
| P2 | Metrics/tests | Duplicate counts were counted twice; timing test advanced before binding discovery; logging test depended on ambient quiet mode | Correct count; synchronize on request start; explicitly set logging environment |
| P2 | Dependencies | Published advisories in Next.js, Undici, brace-expansion and fast-uri | Patch/same-major dependency updates and both builds; no blind major downgrade |
| P2 | Operations/docs | Migration probes and retry/schedule documentation were stale | New schema probes, explicit operator policy and rollback guidance |

No validated exploitable P0 security finding is asserted. Remaining decisions:

- **Locally maintained development dependency:** braces 3.0.3 has [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), with no published patch as of 5 October 2026. It reaches ESLint and Vinext build-time glob handling through fast-glob/micromatch. No public runtime input-to-pattern path was established. The final change replaces it with the committed, MIT-licensed `@world-news-atlas/braces@3.0.3-wna.1` backport described below. The full audit gate remains unchanged. Maintaining this fork, testing it, and returning to a verified upstream release are explicit responsibilities; an audit result alone cannot certify local source.
- **RSS DNS binding:** feeds are operator-configured, and redirects/address checks exist, but lookup and fetch are separate and IPv6 filtering is incomplete. No visitor-controlled feed or reachable malicious redirect path was established. A network-level allowlist or pinned DNS connection needs a platform-specific design; no speculative SSRF rewrite or exploitability claim is made.
- **Existing bounds and algorithms:** bounded quadratic clustering/deduplication, heuristic country/language/source inference, capped candidate windows and article upsert round trips remain. There is no reproduced production bottleneck justifying an algorithm/index rewrite. Rankings and heuristic accuracy are not claimed to be exhaustive.
- **Developer tooling:** Drizzle's esbuild-kit dependencies and ESLint 9 emit deprecation notices. Existing esbuild protection remains. Broad major migrations are deferred rather than mixed into ingestion remediation. The pinned, manually invoked geography updater is not a production request path; it still merits a separate bounded-download/schema-validation improvement.
- **Live state:** browsing cursors remain isolate-local and may reset after restart. This is an existing explicit contract. Historical coverage can be incomplete under upstream caps or prolonged outages. No platform cron service, new database, queue or account system was introduced.

## Security, performance and observability

Reviewed security boundaries include HMAC/nonces/locks, parameterized SQL, safe HTTP links and React text rendering, image host/path/redirect checks, RSS feed configuration, response limits, production distributed quotas, service-worker cache restrictions and secret-bearing workflow events. Both workflows retain contents:read, immutable action SHAs and bounded timeouts; ingestion secrets do not run on pull-request events. No approval/security control was weakened to make a job green.

Load reductions come from avoiding half-hour archive discovery, stopping GDELT branch fan-out after failure, shared cooldowns, completed-checkpoint reuse and preserved live continuations. Fencing adds an indexed lock check inside existing write batches, without an extra network round trip. The persistence fix avoids global empty-story cleanup. No production latency or throughput improvement is claimed without deployment measurement.

Structured summaries expose outcome, pass, provider/code, requests/attempts, counts, duration and cooldown. They do not print HMAC payloads, credentials, provider bodies or raw SQL/internal exceptions. DEGRADED is operationally accepted and visibly different from SUCCESS. Internal/storage/state errors remain failures.

## Dependabot remediation

The authenticated GitHub alert inventory on 5 October 2026 contained 32 open
alerts against the original `main` revision. All affected dependency families
are addressed in this change:

| Package | Open alerts before merge | Installed remediation |
|---|---:|---|
| Next.js | 1 | 16.3.8, above the advisory's 16.3.6 fix |
| Undici | 21 | 7.29.1 and 8.11.2; both major-version paths updated |
| fast-uri | 3 | 3.1.8 |
| brace-expansion | 6 | 1.1.21 and 5.0.12 |
| braces | 1 | Local `@world-news-atlas/braces@3.0.3-wna.1` fork |

The original braces package exhausted the stack on a 9,997-character nested
brace pattern in compile/expand and on a 20,000-level direct AST in all three
recursive public walkers. Ordinary glob expansion succeeded in the same
baseline. The backport caps combined brace/parenthesis nesting at 100, enforces
the bound independently in compile/expand/stringify, and detects cyclic AST
parent links during expansion. Oversized and non-finite `maxDepth` options cannot
disable the bound. Errors are explicit; malformed inputs are not silently
truncated or accepted.

Source provenance, upstream commit, original tarball integrity, installation
requirements and removal procedure are in [the fork README](../vendor/braces/README.md).
The root file dependency and override install the same committed source for all
callers without a postinstall patch. Registry advisory matching does not inspect
local forks, so the 20 project regression cases also verify every installed
braces/micromatch resolution and exercise the real glob callers. No alert is
dismissed and no audit exclusion is added.

The upstream core compatibility command (`mocha 'test/braces.*.js'
test/minimatch.js test/multiples.js test/readme.js test/regression.js`) passes all
148 cases in an isolated validation copy. A broader 904-case upstream suite
was compared against the original npm package: failures decrease from 50 to 42,
with all eight previously failing security tests repaired and **no new failed
cases**. The remaining 42 legacy Bash-compatibility expectations fail identically
on the original package and are outside this security backport; this is not a
claim that the entire upstream suite passes.

## Tests and validation

Deterministic coverage includes numeric/date/malformed/past/large/missing Retry-After, GDELT success/429/recovery/repeated429/503/query rejection/timeout/malformed/partial branches/cursors, success/degraded/terminal/internal outcomes, retry exhaustion, cooldown eligibility, corrupted plans/cursors, lease expiry/stale tokens, same/conflicting logical requests, replay, cross-instance pacing/rotation, fresh/legacy migrations and checkpoint loss recovery. Scheduler tests cover every mode, explicit pass names, cooldowns longer than 30 seconds, insufficient deadline, bounded retries/polls and degraded/nonzero outcomes. Additional tests cover partial-story preservation, partial live progress, metadata corruption, embedding stream bounds and localStorage failures.

Final local validation on 5 October 2026: **398 tests in 46 files, lint, TypeScript, both production builds and migration checks pass after a clean `npm ci`.** Both production-only and full dependency audits report zero vulnerabilities. The earlier 4 October validation passed 378 tests but failed the full audit on eight package entries arising from the single braces advisory; the subsequent backport resolves that gate without changing its command. GitHub CI must also pass on the PR's final commit before squash merge.

The following is the command ledger for validation and dependency changes. Repeated identical commands are consolidated; earlier failures are retained. Redirection to local logs and shell exit-code plumbing are omitted. Raw logs are retained under `work/validation/` and excluded from Git.

| Command | Result |
|---|---|
| `npm ci` | PASS, including clean reinstall after all dependency changes; deprecation notices remain |
| `npm run check` | Final PASS: lint, type generation/TypeScript and 398 tests. Initial run: 357 passed, two failed because of ambient quiet logging and fake-clock ordering; both repaired and rerun |
| `npm run lint` | PASS; also included in final check |
| `npx tsc --noEmit --pretty false` | PASS during implementation; final check also runs canonical `npm run typecheck` |
| `npm run build` | PASS on final source; Vinext emits its existing static route-classification limitation |
| `npm run build:next` | PASS on final source; dynamic document routes confirmed |
| `npm run db:generate -- --name=provider_rate_control` | PASS; generated additive 0003 migration and metadata |
| `npm run db:generate -- --name=ingestion_retry_deadline` | PASS; generated additive 0004 migration and metadata |
| `npm run db:check` | PASS, including final migration chain |
| `npm audit --json` | Nonzero before the braces backport; each remaining dependency path evaluated |
| `npm audit --omit=dev --audit-level=high` | PASS, zero vulnerabilities |
| `npm audit --audit-level=high` | Final PASS, zero vulnerabilities; previously failed on eight braces-related entries; gate preserved |
| `npm --version` | PASS, environment inspection |
| `npm view next@16.3 version` | PASS, patch availability checked |
| `npm view braces version` | PASS, published version checked against advisory |
| `npm view miniflare version` | PASS, same-major prerelease update evaluated |
| `npm ls brace-expansion fast-uri undici --depth=6` | PASS, transitive ownership traced |
| `npm ls undici` | PASS, remaining nested copy located |
| `npm install --save-exact next@16.3.8 eslint-config-next@16.3.8` | PASS; matching patch versions |
| `npm update brace-expansion fast-uri undici wrangler '@cloudflare/vite-plugin'` | PASS; existing manifest ranges retained |
| `npm install --save-dev 'miniflare@^5.20261001.0-alpha'` | PASS; existing 5.x prerelease line retained |
| `npm update undici --depth=10` | PASS; nested copies updated within dependency ranges |
| `git diff --check` (with `core.safecrlf=false` for inspection) | PASS; no whitespace errors |
| `npm install --ignore-scripts --no-audit` | PASS; regenerated lockfile for the local fork. Initial override-only resolution was invalid; corrected with a root file dependency plus `$braces` override and verified by clean install |
| `npx vitest run tests/braces-security.test.ts` | PASS, 20 cases; initial setup exposed the file-resolution issue and one incorrect expected regex string, both corrected |
| `node --check` for every vendored JavaScript file | PASS |
| Upstream core Mocha command listed above | PASS, 148 cases |
| Upstream `mocha 'test/*.js' --reporter json`, original versus backport | Comparison PASS: zero new failed cases, eight security cases repaired. Broad suite itself still has 42 inherited failures, as detailed above |

`npm run check` invokes `npm run lint`, `npm run typecheck` (`next typegen && tsc --noEmit`) and `npm test` (`vitest run`). These are the repository's canonical commands, not substituted partial checks. Focused test commands were:

```text
npx vitest run tests/gdelt-provider.test.ts tests/ingest-route.test.ts tests/database.integration.test.ts tests/ingestion-continuation.test.ts tests/news-ingestion-workflow.test.ts tests/provider-failure.test.ts tests/newsapi-provider.test.ts tests/rss-provider.test.ts tests/bing-news-provider.test.ts --reporter=dot
  INITIAL FAIL: 75 passed, 7 failed during implementation; repaired before the following focused runs and final suite.
npx vitest run tests/retry-policy.test.ts tests/ingestion-outcome.test.ts tests/gdelt-provider.test.ts tests/ingest-route.test.ts tests/ingestion-continuation.test.ts tests/news-ingestion-workflow.test.ts tests/provider-failure.test.ts tests/newsapi-provider.test.ts tests/rss-provider.test.ts tests/bing-news-provider.test.ts --reporter=dot
  PASS: 115 tests.
npx vitest run tests/database.integration.test.ts --reporter=dot
  PASS: 21 tests at that stage; subsequent additions are included in the final suite.
npx vitest run tests/database.integration.test.ts -t 'preserves untouched'
  EXPECTED FAIL before the fix: a two-member story lost its untouched member.
npx vitest run tests/database.integration.test.ts -t 'preserves untouched|persists and reclusters'
  PASS: both persistence regressions after the fix.
npx vitest run tests/provider-configuration.test.ts tests/normalization-deduplication.test.ts
  PASS: 16 tests after clock/logging repairs.
npx vitest run tests/embeddings.test.ts tests/search-history.test.tsx tests/live-corpus.test.ts
  PASS: 21 tests.
npx vitest run tests/provider-configuration.test.ts tests/newsapi-provider.test.ts tests/retry-policy.test.ts tests/ingest-route.test.ts
  PASS: 42 tests before the final metadata cases were added.
npx vitest run tests/database.integration.test.ts -t 'resumes a signed|preserves untouched|persists and reclusters'
  PASS: 3 tests.
npx vitest run tests/database.integration.test.ts -t 'fences every|corrupt stored|resumes a signed'
  PASS: 3 tests.
```

Read-only inspection also used `git status`, `git diff`, `git log`, `git show`, `git ls-files`, `rg`, PowerShell file reads and `gh run view 37112777920 --log-failed`. Source and advisory inspection informed the audit; these are not substitutes for executed tests. No live provider/API credential was required by the deterministic suite. No remote migration or deployment command was executed.

## Changed files

Paths are repository-relative. The inventory includes the dependency commit as well as the subsequent implementation, test and documentation commits.

| File | Purpose |
|---|---|
| `.github/workflows/news-ingestion.yml` | Select recent versus archive schedule in one job; retain manual periods and security controls |
| `README.md` | Current architecture, schedules, retry/outcome semantics, limits and diagnostics |
| `db/schema.ts` | Provider control table and request retry deadline |
| `docs/ingestion-reliability-report.md` | Root causes, decisions, evidence, command ledger, risks and file inventory |
| `docs/optimization-results.md` | Mark September evidence as historical and link current policy |
| `docs/production-deployment.md` | New migration probes, release order and behavioral rollback compatibility |
| `eslint.config.mjs` | Exclude preserved upstream CommonJS source from application lint rules; security regressions exercise it |
| `drizzle/0003_provider_rate_control.sql` | Add shared provider control table |
| `drizzle/0004_ingestion_retry_deadline.sql` | Add retry_at without rewriting history |
| `drizzle/meta/0003_snapshot.json` | Generated schema snapshot for 0003 |
| `drizzle/meta/0004_snapshot.json` | Generated schema snapshot for 0004 |
| `drizzle/meta/_journal.json` | Register the two forward migrations |
| `package.json` | Available security patch versions, Miniflare update within its major line and reproducible local braces override |
| `package-lock.json` | Reproducible patched dependency graph |
| `scripts/migrate-production.mjs` | Verify new provider-control and retry-deadline columns |
| `scripts/scheduled-ingestion.mjs` | Named passes, schedule selection, stable IDs, shared delays and explicit summaries |
| `src/hooks/useSearchHistory.ts` | Keep search usable when browser storage writes fail |
| `src/lib/news/d1-store.ts` | Atomic write fencing/rotation, strict checkpoint state, preserve partial story membership |
| `src/lib/news/data-store.ts` | Central retry classification and partial live continuation/coverage recovery |
| `src/lib/news/embeddings.ts` | Bound total timeout and streamed response size across embedding batches |
| `src/lib/news/ingest-route.ts` | Explicit outcomes, cooldown responses, scoped fenced writer and safe failure logging |
| `src/lib/news/ingest.ts` | Acceptance evidence, resumable checkpoints, shared terminality, stage deadlines and accurate duplicate counts |
| `src/lib/news/ingestion-outcome.ts` | Canonical failure taxonomy, acceptance policy and retry-delay aggregation |
| `src/lib/news/ingestion-requests.ts` | Separate retry exhaustion, cooldown eligibility, strict persisted plans/summaries and fenced transitions |
| `src/lib/news/ingestion-state.ts` | Independent archive rotation and fair single-country lane selection |
| `src/lib/news/providers/bing-news.ts` | Bounded cancellable body reads and truthful partial branch completion |
| `src/lib/news/providers/gdelt.ts` | Sequential paced branches, durable cooldown, response validation and failure/cursor preservation |
| `src/lib/news/providers/gdelt-rate-control.ts` | Atomic D1 pacing/cooldown with bounded development fallback |
| `src/lib/news/providers/index.ts` | Strict operator configuration, bounded active work, cancellation and failed-cache handling |
| `src/lib/news/providers/newsapi.ts` | Cancellable bounded requests, strict metadata and retained terminal/partial failures |
| `src/lib/news/providers/provider.ts` | Shared provider error/delay/body utilities; remove unused header-only timeout helper |
| `src/lib/news/providers/rss.ts` | Retain redirect safeguards while bounding total work and preserving failed feed plans |
| `src/lib/news/retry-policy.mjs` | Shared Retry-After parsing, bounds, jitter/backoff and transient HTTP statuses |
| `src/lib/news/store.ts` | Optional immutable ingestion-scoped store binding |
| `src/lib/news/types.ts` | Cancellation and structured partial provider failures |
| `tests/database.integration.test.ts` | Real D1 cooldown/rotation, migration preservation, retry states, corrupt state, story membership and all-write fencing |
| `tests/braces-security.test.ts` | Malicious strings/ASTs, depth boundaries, cycles, compatibility and installed transitive glob resolution |
| `tests/embeddings.test.ts` | Stalled-body cancellation and oversized response rejection |
| `tests/gdelt-provider.test.ts` | Throttling/recovery, shared delays, sequential partial results and terminal failures |
| `tests/ingest-route.test.ts` | Degraded status/cooldown with authentication and replay regressions retained |
| `tests/ingestion-continuation.test.ts` | Safe cursor reuse and truthful failure/exhaustion behavior |
| `tests/ingestion-outcome.test.ts` | Success, degraded, all-provider outage and terminal/internal policy matrix |
| `tests/live-corpus.test.ts` | Partial live cursor recovery and cooldown-aware retries |
| `tests/news-ingestion-workflow.test.ts` | Schedule/mode/pass mapping, deadlines, retry/poll ceilings and exit semantics |
| `tests/newsapi-provider.test.ts` | Malformed source metadata rejection |
| `tests/normalization-deduplication.test.ts` | Explicit logging environment for deterministic diagnostics assertions |
| `tests/production-migrations.test.ts` | New schema verifier probes; existing operator-config validation retained |
| `tests/provider-configuration.test.ts` | Invalid operator config and synchronized deadline tests |
| `tests/retry-policy.test.ts` | Numeric and HTTP dates, malformed/impossible dates, bounds and jitter |
| `tests/search-history.test.tsx` | Storage quota/security failures do not break search/history UI |
| `vendor/braces/LICENSE` | Preserve the upstream MIT license and copyright |
| `vendor/braces/README.md` | Fork provenance, bounds, installation and return-to-upstream procedure |
| `vendor/braces/package.json` | Identify the private fork and its audited fill-range dependency |
| `vendor/braces/index.js` | Preserve the upstream public API |
| `vendor/braces/lib/constants.js` | Define the hard maximum nesting depth |
| `vendor/braces/lib/parse.js` | Bound combined brace and parenthesis nesting before allocating deeper AST nodes |
| `vendor/braces/lib/compile.js` | Bound compilation of caller-supplied ASTs |
| `vendor/braces/lib/expand.js` | Bound expansion and reject cyclic parent chains |
| `vendor/braces/lib/stringify.js` | Bound stringification of caller-supplied ASTs |
| `vendor/braces/lib/utils.js` | Preserve upstream compatibility helpers |

## Remaining operational verification

Apply and verify migrations before publishing the matching Worker and enabling its workflow. Check all three pass summaries in manual recent discovery and the first archive run. Confirm shared cooldown behavior across live and scheduled traffic, then observe subsequent successful/DEGRADED runs. A later 401, invalid query/schema or zero-useful-provider outage must still make Actions fail. GitHub schedule timing and provider capacity are external constraints; no implementation can guarantee permanent upstream availability.

## Delivery

Changes are based on `8556b5c` and delivered through [PR #5](https://github.com/Koon-Kiat/World-News-Atlas/pull/5). The branch is `codex/ingestion-squash`; the merge must use squash after every PR check passes. Implementation commits are grouped by behavior:

- `b7a8e24` — Update dependencies with available security fixes.
- `720880c` — Make ingestion outcomes and recovery durable; includes provider coordination, additive migrations and corresponding tests because their contracts change together.
- `76dd889` — Separate recent ingestion from archive reconciliation.
- `4715777` — Preserve live discovery progress through provider failures.
- `885691c` — Bound embedding response reads and total execution time.
- `b61bc34` — Keep search usable when browser storage is unavailable.
- `436aaf2` records the original report and operator guidance.
- The security follow-up adds the maintained braces backport, regression coverage and updated evidence.

The GitHub delivery does not publish the production Worker or apply remote migrations. Those remain governed by the deployment order above.
