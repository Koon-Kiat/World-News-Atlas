# World News Atlas (Worldline)

A news explorer built on a world map: global coverage, one country, or the stories connecting two countries. It runs on **vinext** (the Vite reimplementation of the Next.js App Router) and is hosted on **OpenAI Sites** (Cloudflare Workers plus a D1 database bound as `DB`). A second, private copy runs on the owner's own Cloudflare account behind Cloudflare Access (`docs/cloudflare-deployment.md`). The README has product behaviour and architecture. `docs/` has deployment and ingestion details.

## Commands

| Task | Command |
| --- | --- |
| Dev server (vinext, port 3000) | `npm run dev` |
| Lint + typecheck + tests (what CI runs) | `npm run check` |
| Single test file | `npx vitest run tests/<name>.test.ts` |
| Production build | `npm run build` |
| Validate D1 migrations | `npm run db:check` |
| Generate a migration after editing `db/schema.ts` | `npm run db:generate` |
| Local D1 migrations | `npm run db:migrate:local` |

CI (`.github/workflows/ci.yml`) runs `npm ci`, `db:check`, `check`, `build` and `npm audit --audit-level=high` on Node 24.15.0.

## Framework notes

- Next is `16.x` with React `19.2.x`, and the APIs differ from older Next versions. Read the relevant guide in `node_modules/next/dist/docs/` before using an unfamiliar API. Route props use generated types such as `LayoutProps<"/">` (`next typegen` runs as part of `typecheck`).
- `react`, `react-dom` and `react-server-dom-webpack` must stay on the same exact version. Dependabot groups them for that reason.
- `agentRules: false` in `next.config.ts` stops `next dev` from recreating `AGENTS.md`. This file is the only agent guidance.

## Layout

- `src/app`: routes (`/`, `/country`, `/compare`, `/saved`, `/settings`), API routes (`/api/news`, `/api/image`, `/api/source-logo`, `/api/internal/ingest/run`, `/api/health`), and the two stylesheets.
- `src/components`: landing page, explorer, map, filters, story cards and reader.
- `src/lib/news`: providers (NewsAPI, GDELT, RSS, Bing), normalisation, country detection, clustering, ranking, D1 store and ingestion state.
- `scripts/scheduled-ingestion.mjs`: the GitHub Actions ingestion client. It runs from the repository checkout, so changes take effect on push, with no Site deploy needed.
- `drizzle/`: generated migrations. These are immutable; add a new migration rather than editing one.

## Interface rules

The site is dark-only (`public/theme.js` forces `data-theme="dark"`). There is no light mode to design or maintain.

- **Tokens:** colors are defined in `:root` at the top of `src/app/globals.css`. Use `var(--token)` and never add new hex/rgba literals to components or CSS. The map, globes and landing story re-scope the same tokens to a deep-ocean "chart" palette through the `:is(.map-layout, …)` block below `:root`.
- **Palette roles:**
  - Atlas blue (`--action-background`, `--signal`) is for actions and accents.
  - Amber (`--marker`) is only for selected places on the chart.
  - Red (`--live`) is only for destructive or error states.
- **Shared rules:** `src/app/interface.css` loads last and holds the shared rules: control sizes (44px targets), radii (`--control-radius` 6px, `--panel-radius` 10px), primary/secondary actions, focus rings, card and banner treatment. It is the place to standardise a component across routes.
- **Type:** headlines use Source Serif 4 (`--display`/`--article`) and interface text uses Source Sans 3 (`--sans`). Labels are sentence case; do not add uppercase or tracked-capital labels.
- **Verification:** check changes in the browser at desktop and 375px widths. `docs/interface-consistency.md` records the design system.

## Ingestion and production

- GitHub Actions (`news-ingestion.yml`) sends HMAC-signed requests to `/api/internal/ingest/run`: `24h` every 30 minutes and `30d` archive at 02:17/14:17 UTC. A single D1 lock (`ingestion_operation_lock`) serialises operations with a 180s renewable lease and a 150s server budget.
- The scheduler must never start a request it cannot wait for in full (165s). An abandoned operation keeps the lock, and the next pass then sees `BUSY`. Keep the per-pass window longer than lease + operation time.
- Outcome classification lives in `src/lib/news/ingestion-outcome.ts`: DEGRADED (transient provider failures with useful stored work) is a success; terminal codes fail the run.
- Merging to `main` deploys the self-hosted Worker (`deploy-cloudflare.yml`, after CI passes; build with `NEWS_DEPLOY_TARGET=cloudflare`). It does **not** deploy the Sites copy. Follow `docs/production-deployment.md`: migrate D1, verify, publish the Site, then enable ingestion changes that need new server code.
- Secrets (`NEWS_INGEST_HMAC_SECRET`, `NEWSAPI_KEY`, `OAI_SITES_BYPASS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`) live in Sites, the Worker and GitHub. Never commit `.env.local`.

## Commits

Do not add `Co-Authored-By` trailers or any AI attribution to commits or PRs in this repository.
