// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateProduction, productionMigrationTarget } from "../scripts/migrate-production.mjs";

const paths: string[] = [];
function config(overrides = {}) {
  mkdirSync(resolve("work"), { recursive: true });
  const directory = mkdtempSync(resolve("work/migration-test-"));
  paths.push(directory);
  const path = join(directory, "wrangler.json");
  writeFileSync(path, JSON.stringify({ d1_databases: [{ binding: "DB", database_name: "existing-production-test",
    database_id: "11111111-1111-4111-8111-111111111111", migrations_dir: resolve("drizzle"), ...overrides }] }));
  return path;
}
afterEach(() => {
  for (const path of paths.splice(0)) {
    if (!resolve(path).startsWith(resolve("work") + sep)) throw new Error("Unexpected test directory");
    rmSync(path, { recursive: true, force: true });
  }
});

describe("production migration gate", () => {
  it("refuses absent production mapping, the local placeholder, another binding, and another migration chain", () => {
    expect(() => productionMigrationTarget(undefined)).toThrow("existing production");
    expect(() => productionMigrationTarget(resolve("wrangler.jsonc"))).toThrow("local placeholder");
    expect(() => productionMigrationTarget(config({ binding: "ANOTHER_DB" }))).toThrow("existing Sites DB");
    expect(() => productionMigrationTarget(config({ migrations_dir: "other-migrations" }))).toThrow("drizzle directory");
  });
  it("applies with Wrangler to the existing remote binding then verifies the ledger and schema", () => {
    const configPath = config();
    const run = vi.fn((_executable, args: string[]) => ({ status: 0, stdout: args.includes("--json")
      ? JSON.stringify([{ success: true, results: readdirSync("drizzle").filter((name) => name.endsWith(".sql")).map((name) => ({ name })) }]) : "" }));
    migrateProduction({ configPath, run });
    expect(run.mock.calls.map((call) => call[1].slice(1, 4))).toEqual([
      ["d1", "migrations", "list"], ["d1", "migrations", "apply"], ["d1", "execute", "--json"], ["d1", "execute", "--command"],
    ]);
    const schemaCheck = run.mock.calls.at(-1)![1].join(" ");
    expect(schemaCheck).toContain("retry_at");
    expect(schemaCheck).toContain("provider_request_control");
    for (const [, args] of run.mock.calls) {
      expect(args.slice(-4)).toEqual(["DB", "--remote", "--config", configPath]);
      expect(args).not.toContain("--local");
    }
  });
  it("stops on migration failure or an incomplete ledger, and supports read-only verification", () => {
    const configPath = config();
    const failed = vi.fn(() => ({ status: 1 }));
    expect(() => migrateProduction({ configPath, run: failed })).toThrow("stop before application deployment");
    expect(failed).toHaveBeenCalledOnce();
    const missing = vi.fn(() => ({ status: 0, stdout: '[{"results":[]}]' }));
    expect(() => migrateProduction({ configPath, verifyOnly: true, run: missing })).toThrow("unapplied migrations");
    expect(missing).toHaveBeenCalledOnce();
  });
});
