import { readFileSync } from "node:fs";
import { sites } from "@openai/sites-vite-plugin";
import tailwindcss from "@tailwindcss/postcss";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// NEWS_DEPLOY_TARGET=cloudflare builds for the self-hosted Worker in
// wrangler.production.jsonc (real D1 ID, workers.dev behind Cloudflare Access).
// Any other build keeps the Sites-managed placeholder binding.
const cloudflareProduction =
  process.env.NEWS_DEPLOY_TARGET === "cloudflare"
    ? (JSON.parse(readFileSync(new URL("./wrangler.production.jsonc", import.meta.url), "utf8")) as {
        name: string;
        workers_dev: boolean;
        preview_urls: boolean;
        observability: { enabled: boolean };
        d1_databases: { binding: string; database_id: string }[];
      })
    : null;

const productionDatabaseId = cloudflareProduction?.d1_databases.find((database) => database.binding === d1)?.database_id;
if (cloudflareProduction && !productionDatabaseId) {
  throw new Error("wrangler.production.jsonc must declare the DB binding.");
}

const localBindingConfig = {
  main: "vinext/server/app-router-entry",
  compatibility_flags: ["nodejs_compat"],
  ...(cloudflareProduction
    ? {
        name: cloudflareProduction.name,
        workers_dev: cloudflareProduction.workers_dev,
        preview_urls: cloudflareProduction.preview_urls,
        observability: cloudflareProduction.observability,
      }
    : {}),
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "world-news-atlas-d1",
          database_id: productionDatabaseId ?? SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          migrations_dir: "drizzle",
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "world-news-atlas-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    // Keep the complete flag set as individually cached assets, rather than
    // inlining hundreds of SVGs into every route's CSS.
    build: { assetsInlineLimit: 0 },
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        // A plain override concatenates Wrangler binding arrays, declaring DB
        // twice. Mutate the resolved local config to replace those arrays.
        config: (config) => { Object.assign(config, localBindingConfig); },
      }),
    ],
  };
});
