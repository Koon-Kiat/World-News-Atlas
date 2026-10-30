# Development setup and validation

[Documentation index](../README.md)

## Install and run

Use Node.js 24.15.0 or newer and npm. The lockfile is the reproducible dependency source; CI pins Node.js 24.15.0 and Ubuntu 24.04.

```powershell
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). The default Vinext development server uses the Cloudflare Vite plugin and its local `DB` binding. Initialize local tables before relying on stored data:

```powershell
Copy-Item .env.example .env.local
npm run db:migrate:local
```

Copy the environment template only when creating a new local configuration; preserve an existing `.env.local`. No provider key is required for Bing/RSS. See [configuration](../reference/configuration.md) for optional settings. When storage is unavailable, browsing can use live provider discovery. Fixture fallback requires explicitly setting `NEWS_FIXTURES_ENABLED=true`; keep it disabled in production.

## Commands

| Purpose | Command |
| --- | --- |
| Vinext development / production build / server | `npm run dev` / `npm run build` / `npm start` |
| Native Next.js development / compatibility build | `npm run dev:next` / `npm run build:next` |
| Lint, generated route types, TypeScript and tests | `npm run check` |
| Individual checks | `npm run lint`, `npm run typecheck`, `npm test` |
| Focused test / watch mode | `npx vitest run tests/<name>.test.ts` / `npm run test:watch` |
| Validate migration chain | `npm run db:check` |
| Generate migration after schema changes | `npm run db:generate -- --name=<change>` |
| Apply local migrations | `npm run db:migrate:local` |
| Audit installed dependencies | `npm audit --audit-level=high` |
| Deliberately refresh generated geography | `npm run data:update-countries` |

CI runs `npm ci`, `npm run db:check`, `npm run check`, `npm run build` and the full audit. Use `npm run build:next` for native Next.js compatibility, especially after framework, rendering or security-header changes. Live-provider smoke commands are separate from CI because upstream availability varies; see [ingestion](../operations/ingestion.md).

Applied SQL migrations and matching metadata are immutable. Add migrations after editing `db/schema.ts`; never use the checked-in local database placeholder for remote access. Follow [deployment](../operations/deployment.md) for production.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/app/` | Page/API routes, layout, global and shared interface styles |
| `src/components/`, `src/hooks/` | UI and browser-local state |
| `src/lib/news/` | Discovery, normalization, clustering, ranking, persistence and ingestion |
| `src/config/news-sources.ts`, `src/data/` | Feed definitions, publisher registry and geographic/topic signals |
| `db/schema.ts`, `drizzle/` | D1 schema, generated SQL and migration metadata |
| `scripts/` | Scheduler, ingestion/diagnostic CLIs, migrations and geography updater |
| `tests/` | Deterministic provider, UI, security and real local D1 integration tests |
| `.github/workflows/` | CI and scheduled ingestion |
| `.openai/hosting.json`, `vite.config.ts`, `wrangler.jsonc` | Hosting declaration and local Workers configuration |
| `public/` | Artwork, fonts, theme bootstrap, service worker and offline shell |
| `vendor/braces/` | Maintained dependency backport with its own license and provenance |

[package.json](../../package.json) and the [CI workflow](../../.github/workflows/ci.yml) define the executable commands and versions. React, React DOM and React Server DOM Webpack must remain on the same exact version. Keep the [fork regression tests](../../tests/braces-security.test.ts) and full audit gate when updating dependencies.
