# Providers and content policy

[Documentation index](../README.md)

This describes configured adapters and registry data, not a live availability or licensing audit.

| Provider | Credentials | Default behavior |
| --- | --- | --- |
| GDELT | None | `auto` for 7d/30d country views. Principal local languages get independent `sourcelang:` branches and cursors. Historical requests sample bounded recent, middle, and oldest time windows first, then continue each branch until the requested range is covered. Selected publishers use documented `domainis:`/`sourcecountry:` filters where appropriate. |
| RSS/Atom | None | Reviewed feeds from BBC News, The Guardian, Al Jazeera, CNA, The Straits Times, The Japan Times, NHK, DW, Euronews, France 24, Sky News, and NPR are enabled by default. RSS is a finite snapshot: up to four relevant feeds are fetched per stage, each feed snapshot is visited once per fresh corpus, and articles remain publisher-round-robin. |
| Bing News RSS | None | Bing is a finite discovery snapshot, not an archive. At most two of 18 staged plans run per worker stage; completed plan IDs are retained. Markets/local languages are data-driven, local publisher domains are prioritized, and Reuters/AP remain supplementary lanes. |
| NewsAPI | `NEWSAPI_KEY` | Optional archive-capable provider. Continuation uses `page`/`totalResults`; hosted date-filter incompatibility retries still enforce the publication window locally. Source-country metadata is cached and local-perspective source IDs are pushed upstream where NewsAPI exposes them. Provider-plan/result-limit exhaustion remains distinct from coverage completeness. |
| Fixtures | None | Disabled by default. Available only as an explicit local development/testing fallback. |

Publisher availability is never assumed. A source-registry entry is an identity mapping, not an availability claim. The UI lists only publishers present in the current candidate set plus any publisher the visitor already selected. NHK is additionally enabled through its reviewed default RSS feed; Reuters and AP remain discovery targets rather than bundled feeds.

The checked-in Japanese identity registry also recognizes The Asahi Shimbun, The Yomiuri Shimbun, Nikkei, Kyodo News, The Mainichi, Jiji Press, The Hokkaido Shimbun, and Okinawa Times. These entries improve publisher identity and provider-domain targeting; they do **not** claim a bundled feed. These entries are identity mappings; their presence does not establish feed availability or content reuse permission.

## Japanese publisher registry

| Publisher identity | Configured publisher domain(s) | Default RSS status |
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

## Configuring approved RSS feeds

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

This is administrator configuration, not a visitor-facing feature. Feed URLs must use public, credential-free HTTPS endpoints. The adapter checks local/private addresses and redirects, limits response size, and does not accept arbitrary URLs from API requests. DNS lookup and fetch are separate operations; see the [security limits](../architecture/security.md).

## Content policy

- NewsAPI plan restrictions and production rights depend on the operator's account and current terms. Verify them before deployment.
- Bing News RSS discovery is used only for headline-level, private, non-commercial exploration and links directly to the discovered publisher URL. Review Microsoft's current terms before changing that usage model.
- GDELT can supply broad discovery metadata but does not grant rights to republish publisher content. The original publisher's rights still apply.
- RSS availability does not automatically grant permission to archive, reproduce, translate, or commercially reuse full content. Enable only reviewed feeds and retain only permitted metadata/excerpts. Publishers listed as identity-only are not default feed sources because this project did not verify both a suitable official public endpoint and an appropriate reuse posture.
- Images and descriptions may have separate rights or hotlinking restrictions. A production operator should disable or proxy only expressly licensed media according to publisher/provider terms.
- This repository does not include licensed Reuters, AP, or other full-content feeds and does not claim that any named publisher is currently available.

Review the current official terms for every selected provider and publisher before production use.

Implementation: [default feeds](../../src/config/news-sources.ts), [source registry](../../src/data/source-registry.json), [provider adapters](../../src/lib/news/providers/index.ts).
