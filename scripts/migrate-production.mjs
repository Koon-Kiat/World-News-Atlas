import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));

export function productionMigrationTarget(configPath) {
  if (!configPath) throw new Error("Set NEWS_PRODUCTION_WRANGLER_CONFIG to the existing production Wrangler JSON config. The checked-in config is local-only; Sites-managed publishing needs no physical database ID.");
  const config = resolve(configPath);
  const hosting = JSON.parse(readFileSync(resolve(root, ".openai/hosting.json"), "utf8"));
  const local = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));
  const production = JSON.parse(readFileSync(config, "utf8"));
  const matches = production.d1_databases?.filter((database) => database.binding === hosting.d1) ?? [];
  const database = matches[0];
  if (matches.length !== 1 || !database.database_name || !database.database_id ||
    !/^[0-9a-f-]{36}$/i.test(database.database_id) ||
    local.d1_databases.some((entry) => entry.database_id === database.database_id)) {
    throw new Error("Production config must identify the existing Sites DB binding with its real database ID, never the local placeholder.");
  }
  if (resolve(dirname(config), database.migrations_dir ?? "migrations") !== resolve(root, "drizzle") || database.migrations_pattern) {
    throw new Error("Production DB migrations_dir must point to this checkout's drizzle directory with the default SQL file pattern.");
  }
  const table = database.migrations_table ?? "d1_migrations";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error("Invalid migration ledger table name.");
  return { config, binding: hosting.d1, table };
}

/** @param {{configPath?: string, verifyOnly?: boolean, run?: (command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding) => {status: number | null, stdout?: string, error?: Error}}} options */
export function migrateProduction({ configPath = process.env.NEWS_PRODUCTION_WRANGLER_CONFIG, verifyOnly = false, run = spawnSync } = {}) {
  const target = productionMigrationTarget(configPath);
  const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
  const invoke = (args, capture = false) => {
    const result = run(process.execPath, [wrangler, ...args, target.binding, "--remote", "--config", target.config], {
      cwd: root, encoding: "utf8", stdio: capture ? "pipe" : "inherit", shell: false,
    });
    if (result.error || result.status !== 0) throw new Error("Production D1 command failed; stop before application deployment.");
    return result.stdout;
  };
  if (!verifyOnly) {
    invoke(["d1", "migrations", "list"]);
    invoke(["d1", "migrations", "apply"]);
  }
  const ledger = JSON.parse(invoke(["d1", "execute", "--json", "--command", `SELECT name FROM "${target.table}"`], true));
  const applied = new Set(ledger.flatMap((result) => result.results ?? []).map((row) => row.name));
  if (readdirSync(resolve(root, "drizzle")).filter((name) => name.endsWith(".sql")).some((name) => !applied.has(name))) {
    throw new Error("Production has unapplied migrations; stop before application deployment.");
  }
  // Also verify the schema contract: a ledger entry alone cannot prove it exists.
  invoke(["d1", "execute", "--command", "SELECT client_key, count, reset_at FROM api_rate_limit LIMIT 0; SELECT attempts, attempt_token, plan_json, terminal_failure, retry_at FROM ingestion_logical_request LIMIT 0; SELECT attempt_token, lease_until FROM ingestion_operation_lock LIMIT 0; SELECT provider, next_request_at, cooldown_until, failures, last_failure_at FROM provider_request_control LIMIT 0;"]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some((argument) => argument !== "--verify")) throw new Error("Only --verify is supported.");
    migrateProduction({ verifyOnly: process.argv.includes("--verify") });
    console.log("Production D1 migrations and required schema verified. Application deployment may proceed.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
