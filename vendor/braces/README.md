# Local braces security backport

This private fork replaces the transitive `braces` dependency used by Next.js
ESLint tooling and Vinext's dynamic-import tooling. It keeps the public CommonJS
API and the behavior of `braces@3.0.3` for ordinary patterns.

## Provenance

- Original: [`braces@3.0.3`](https://github.com/micromatch/braces/tree/3.0.3), MIT;
  the original copyright and license are retained in `LICENSE`.
- npm tarball integrity:
  `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`.
- Advisory: [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- Security changes backported from [upstream PR #72](https://github.com/micromatch/braces/pull/72),
  pinned for review to commit `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`.
  The proposal was unmerged and no fixed npm release existed on 5 October 2026.

Only the depth/cycle guards in `lib/constants.js`, `lib/parse.js`,
`lib/compile.js`, `lib/expand.js`, and `lib/stringify.js` are backported.
`index.js` and `lib/utils.js` are unchanged from the published package. Unrelated
parser changes on upstream's default branch are deliberately excluded.

## Bounds and installation

Brace and parenthesis nesting share a maximum depth of 100. Compilation,
expansion and stringification enforce the same bound for direct AST inputs.
`maxDepth` may lower the bound; larger or non-finite values cannot disable it.
Expansion also rejects cycles in AST parent links. Excessive input raises a
descriptive `SyntaxError` or `RangeError` before exhausting the stack.

The root development dependency `braces: file:vendor/braces` and the `$braces`
override route every transitive caller to this committed source. Both are
required: a relative file override alone can resolve against the caller's
directory. There is no install-time patch script or external fork download.

The fork's distinct name/version identify our maintained code; they are not an
upstream release. npm audit and Dependabot do not certify the contents of local
forks. Keep the full npm audit gate and `tests/braces-security.test.ts`: it checks
installed dependency resolution, malicious strings and ASTs, depth boundaries,
cycles, normal glob expansion, and the actual micromatch/fast-glob callers.

## Returning to upstream

When a fixed upstream release is available, remove the local development
dependency and override, update the lockfile, and verify the installed source
closes all entry points tested here. Run clean installation, the security
regressions (adapting only the fork-resolution assertion), the full project
checks, both builds and the full dependency audit before removing this folder.
