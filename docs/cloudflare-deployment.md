# Self-hosted Cloudflare deployment

Besides OpenAI Sites, the app runs as a Worker on the owner's own Cloudflare
account. Only the owner can open it, and GitHub Actions deploys it and feeds it
news.

| Piece | Value |
| --- | --- |
| Worker | `world-news-atlas` |
| URL | `https://world-news-atlas.world-news-atlas.workers.dev` |
| D1 database | `world-news-atlas-d1` (`bf67c5ae-9f7f-4041-9bf9-11d4e7b00006`, APAC) |
| Config | `wrangler.production.jsonc` |
| Deploy workflow | `.github/workflows/deploy-cloudflare.yml` |

`NEWS_DEPLOY_TARGET=cloudflare npm run build` reads `wrangler.production.jsonc`
and writes the real Worker name and D1 ID into the generated deploy config.
Builds without the variable keep the Sites placeholder binding, so the Sites
path is unchanged. Preview URLs are off, so the `workers.dev` route is the only
way in.

## Privacy: Cloudflare Access

1. In the Cloudflare dashboard, open **Workers & Pages → world-news-atlas →
   Settings → Domains & Routes**.
2. For `workers.dev`, select **Enable Cloudflare Access**, then **Manage
   Cloudflare Access**. Check that the policy allows only the owner's email.
3. In **Zero Trust → Access controls → Service credentials → Service tokens**,
   create a token named `github-ingestion`. Copy its Client ID and Client
   Secret; the secret is shown once.
4. In the Worker's Access application, add a second policy: action **Service
   Auth**, include **Service Token** `github-ingestion`.

Browsers get the Access login page. The ingestion scheduler sends
`CF-Access-Client-Id` and `CF-Access-Client-Secret` alongside its HMAC signature.

## GitHub secrets

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deploys. Create from the **Edit Cloudflare Workers** template and add **Account → D1 → Edit**. |
| `CLOUDFLARE_ACCOUNT_ID` | `9f3377b30c242a86776db4b054da8dd6` |
| `NEWS_INGEST_URL` | `https://world-news-atlas.world-news-atlas.workers.dev/api/internal/ingest/run` |
| `NEWS_INGEST_HMAC_SECRET` | Same value as the Worker secret below |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | The Access service token |

`NEWS_INGEST_URL` and `NEWS_INGEST_HMAC_SECRET` point ingestion at one site.
Switching them from Sites to this Worker means the Sites copy stops receiving
news.

Set the Worker secrets with `npx wrangler secret put <NAME> --config
dist/server/wrangler.json` after a Cloudflare build. `NEWS_INGEST_HMAC_SECRET`
is required; `NEWSAPI_KEY` is optional.

## Deploys

After CI passes on a push to `main`, the deploy workflow builds the Worker.
It applies and verifies D1 migrations with `npm run db:migrate:production`, then
runs `wrangler deploy`. Migrations always land before the code that needs
them. Run it by hand from the Actions tab with **Run workflow**.

To deploy from a workstation, run `npx wrangler login`, then:

```bash
NEWS_DEPLOY_TARGET=cloudflare npm run build
NEWS_PRODUCTION_WRANGLER_CONFIG=wrangler.production.jsonc npm run db:migrate:production
npx wrangler deploy
```
