import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".vinext/**",
    "dist/**",
    ".wrangler/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Preserve the upstream CommonJS source of the tested security backport.
    "vendor/braces/**",
  ]),
]);

export default eslintConfig;
