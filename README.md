# Worldline

Worldline (World News Atlas) explores news on a world map: browse global coverage, select one country, or find stories connecting two countries. Visitors need no account, API key, or setup. Coverage comes from configured providers and is not an exhaustive index of news.

The application uses React and the Next.js App Router through Vinext, with OpenAI Sites hosting on Cloudflare Workers and D1. Provider credentials stay on the server. Production should use live stories or an honest empty state; fixtures are an explicit development option.

## Run locally

Use Node.js 24.15.0 or newer and npm. CI uses Node.js 24.15.0.

```powershell
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). Bing News RSS and the configured publisher feeds need no API key. For local D1 migrations and optional configuration, see [development setup](doc/development/setup.md).

## Features

- Global, single-country and two-country views with a keyboard-accessible map.
- Publisher-origin perspectives, outlet selection, topics, languages, time ranges, search and newest/popularity sorting.
- Grouped story coverage with attribution, short descriptions and links to original publishers.
- Bounded infinite scrolling, persistent D1 ingestion and resumable provider discovery.
- Dark interface, browser-local saved stories and a saved default time range.

Coverage depends on provider availability and limits. RSS/Bing snapshots cannot establish a complete historical archive. Saved stories do not sync across devices; the application has no user accounts, automatic translation or full-article storage.

## Documentation

Start with the [documentation index](doc/README.md).

| Area | Guide |
| --- | --- |
| Development | [Setup and validation](doc/development/setup.md) |
| Architecture | [Data flow and persistence](doc/architecture/overview.md), [security and local state](doc/architecture/security.md) |
| Reference | [Configuration](doc/reference/configuration.md), [news API](doc/reference/news-api.md), [providers and content policy](doc/reference/providers.md) |
| Operations | [Ingestion](doc/operations/ingestion.md), [deployment and rollback](doc/operations/deployment.md) |
| Design | [Interface system](doc/design/interface.md), [publisher artwork](doc/design/publisher-marks.md) |

## Validation

```powershell
npm run check
npm run db:check
npm run build
npm audit --audit-level=high
```

CI runs these checks after a clean install. Run `npm run build:next` when checking native Next.js compatibility. Build tooling includes a maintained [braces security backport](vendor/braces/README.md); its regression tests and the full dependency audit remain required.
