# Security and local state

[Documentation index](../README.md)

The production news limiter uses an atomic D1 counter shared across Workers (90 requests per 60 seconds) behind an inexpensive local limiter. It trusts Cloudflare's canonical `CF-Connecting-IP` only with the Workers D1 binding; conventional forwarded headers are ignored. IP keys are hashed. Storage is bounded to 10,000 keys with indexed expiry cleanup, saturated counters, and no eviction of active quotas. Denials return 429 with `Retry-After`; unavailable distributed storage fails closed with 503 in production. No external service is required.

Document CSP uses a fresh request nonce for framework scripts and a same-origin prepaint theme script. Image and production connection sources are restricted to the application origin (plus data images). Vinext already renders documents on request; the native Next backend explicitly uses `connection()` so prerendered inline scripts cannot violate the nonce policy. Document HTML is not shared-cacheable; API and hashed-asset caching remain independent. Inline styles remain necessary for React's map transforms, progress effects and theme variables. `/api/health` returns only `{"status":"ok"}`. Images stream through the existing reviewed host/path/redirect boundary with a 6MiB running byte bound and a seven-second deadline covering both headers and body.

One root saved-story provider performs one initial storage read and maintains one cross-tab listener. The existing `worldline:saved-stories:v1` key now contains `{ "version": 2, "stories": [...] }`: the complete nested snapshot is validated, bounded to 50 saved stories, and safe legacy arrays are migrated on read. Invalid/corrupt/future data is rejected. Restricted storage or quota failures show a non-blocking status; clear-all offers a ten-second in-memory Undo.

Service-worker caches are explicitly versioned (`v4`). Navigation stays network-first; only successful, non-redirected, non-private, cacheable known routes can be saved. API, authenticated, cross-origin and query-string resources are excluded. Hashed assets have an 80-entry bound. A small static offline page remains available when dynamic/private documents cannot be cached; offline content does not claim to be current news.

## Content and request boundaries

- Secrets stay in server environment variables.
- API parameters and provider response shapes are validated.
- Provider calls use bounded timeouts and isolated failure handling.
- RSS ingestion is allow-list only and applies SSRF-oriented URL, DNS, redirect, protocol, and size checks.
- Article/image URLs are restricted to HTTP(S), external article links use safe target attributes, and provider error details are not returned to ordinary users. A reviewed same-origin media relay resolves missing publisher `og:image` metadata and rejects unapproved article, image, and redirect hosts.
- NHK relay support is narrowly limited to reviewed official news paths on `news.web.nhk`, `imgu.web.nhk`, and `www3.nhk.or.jp`; other NHK or CDN paths still fall back to the placeholder.
- Security headers include CSP, frame denial, content-type protection, a restrictive permissions policy, and a strict referrer policy.
- Full article bodies are never stored or rendered by this MVP. Live cards and Reader show attribution, metadata, permitted short descriptions, and original-publisher links. RSS `content:encoded` is used only as a sanitized, bounded fallback when no publisher summary exists.

## Known boundaries and maintenance

RSS feeds are operator-controlled. URL/address/redirect checks reduce exposure, but DNS lookup and fetch are separate and do not pin the connection to the checked address. Do not treat them as a complete network-level SSRF boundary or allow visitors to supply feed URLs.

Live continuations and embedding caches are process-local. Restarts can reset browsing state; they do not remove the shared D1 news corpus. Stored search history, saved articles and the default time range stay in the visitor's browser. Restricted storage can prevent persistence.

The local [braces backport](../../vendor/braces/README.md) retains upstream provenance and its license. Package audit output alone does not certify local forks; keep its regression tests and the full dependency audit. Dependency versions and previous audit results are not permanent security guarantees.

The [ingestion guide](../operations/ingestion.md) covers HMAC, nonce replay protection, leases and fenced mutations. Neither a healthy endpoint nor a successful build proves the deployed schema or scheduled ingestion is healthy; follow [release verification](../operations/deployment.md).

Implementation: [client identity](../../src/lib/news/client-key.ts), [distributed quota](../../src/lib/news/distributed-rate-limit.ts), [security headers](../../src/proxy.ts), [image route](../../src/app/api/image/route.ts), [saved stories](../../src/hooks/useSavedStories.tsx), [service worker](../../public/sw.js).
