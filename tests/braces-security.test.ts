// @vitest-environment node
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Ast = { type: string; value?: string; nodes?: Ast[]; parent?: Ast };
type Options = { maxDepth?: number; keepEscaping?: boolean; escapeInvalid?: boolean; nodupes?: boolean };
type Braces = {
  (pattern: string | string[], options?: Options): string[];
  parse(pattern: string, options?: Options): Ast;
  compile(input: string | Ast, options?: Options): string;
  expand(input: string | Ast, options?: Options): string[];
  stringify(input: string | Ast, options?: Options): string;
};
const require = createRequire(import.meta.url);
const braces: Braces = require("braces");
const walkers = ["compile", "expand", "stringify"] as const;
const nested = (depth: number, open = "{", close = "}") => open.repeat(depth) + "a" + close.repeat(depth);
function nestedAst(depth: number): Ast {
  const ast: Ast = { type: "root", nodes: [] };
  let node = ast;
  for (let index = 0; index < depth; index++) {
    const child: Ast = { type: "paren", nodes: [], parent: node };
    node.nodes!.push(child);
    node = child;
  }
  node.nodes!.push({ type: "text", value: "a", parent: node });
  return ast;
}

describe("braces security backport", () => {
  it("routes every installed micromatch and braces copy to the maintained fork", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { resolved?: string; link?: boolean }>;
    };
    const fork = realpathSync(resolve("vendor/braces/index.js"));
    const bracePaths = Object.keys(lock.packages).filter(path => path.endsWith("node_modules/braces"));
    expect(bracePaths.length).toBeGreaterThan(0);
    for (const path of bracePaths) {
      expect(realpathSync(require.resolve(resolve(path)))).toBe(fork);
      expect(lock.packages[path]).toMatchObject({ link: true, resolved: "vendor/braces" });
    }
    const callers = Object.keys(lock.packages).filter(path => path.endsWith("node_modules/micromatch"));
    expect(callers.length).toBeGreaterThan(0);
    for (const caller of callers) {
      const callerRequire = createRequire(resolve(caller, "index.js"));
      expect(realpathSync(callerRequire.resolve("braces"))).toBe(fork);
    }
  });

  for (const method of ["parse", ...walkers] as const) {
    it(`${method} rejects excessive brace, parenthesis, mixed and unfinished nesting`, () => {
      for (const pattern of [nested(101), nested(101, "(", ")"), nested(51, "({", "})"), "{".repeat(101), "(".repeat(101), nested(4998)]) {
        expect(() => braces[method](pattern)).toThrow(/exceeds max depth/);
      }
    });
    it(`${method} permits the depth boundary and ordinary sibling groups`, () => {
      for (const pattern of [nested(100), nested(100, "(", ")"), "{a}".repeat(150)]) {
        expect(() => braces[method](pattern)).not.toThrow();
      }
    });
    it(`${method} cannot disable the limit with large or non-finite options`, () => {
      for (const maxDepth of [100000, Infinity, -Infinity, NaN]) {
        expect(() => braces[method](nested(101), { maxDepth })).toThrow(/exceeds max depth/);
      }
      expect(() => braces[method](nested(2), { maxDepth: 2 })).not.toThrow();
      expect(() => braces[method](nested(3), { maxDepth: 2 })).toThrow(/exceeds max depth/);
      expect(() => braces[method](nested(2), { maxDepth: 1.5 })).toThrow(/exceeds max depth/);
    });
  }

  for (const method of walkers) {
    it(`${method} bounds direct AST input and child cycles without relying on the parser`, () => {
      expect(() => braces[method](nestedAst(20000))).toThrow(/AST depth.*exceeds max depth/);
      expect(() => braces[method](nestedAst(101), { maxDepth: Infinity })).toThrow(/exceeds max depth/);
      expect(() => braces[method](nestedAst(100))).not.toThrow();
      const cycle: Ast = { type: "root", nodes: [] };
      cycle.nodes!.push(cycle);
      expect(() => braces[method](cycle)).toThrow(/exceeds max depth/);
    });
  }

  it("rejects cyclic parent links during expansion without hanging", () => {
    for (const multiNode of [false, true]) {
      const ast: Ast = { type: "paren", nodes: [{ type: "text", value: "a" }] };
      ast.parent = multiNode ? { type: "paren", parent: ast } : ast;
      expect(() => runInNewContext("expand(ast)", { expand: braces.expand, ast }, { timeout: 500 }))
        .toThrow(/AST parent chain contains a cycle/);
    }
  });

  it("preserves glob sets, ranges, parentheses, escaping and invalid braces", () => {
    expect(braces.expand("src/{app,lib}/**/*.{ts,tsx}")).toEqual([
      "src/app/**/*.ts", "src/app/**/*.tsx", "src/lib/**/*.ts", "src/lib/**/*.tsx",
    ]);
    expect(braces.expand("file-{01..05..2}.{js,ts}")).toEqual([
      "file-01.js", "file-01.ts", "file-03.js", "file-03.ts", "file-05.js", "file-05.ts",
    ]);
    expect(braces.expand("foo/({a,b})")).toEqual(["foo/(a)", "foo/(b)"]);
    expect(braces.compile("a/{b,c}/d")).toBe("a/(b|c)/d");
    expect(braces.stringify(braces.parse("a{b,{c,d}}e"), { escapeInvalid: true })).toBe("a{b,{c,d}}e");
    expect(braces.expand("{unfinished")).toEqual(["{unfinished"]);
    expect(braces.expand("${a,b}")).toEqual(["${a,b}"]);
    expect(braces.expand("{a,a,b}", { nodupes: true })).toEqual(["a", "b"]);
    const literals = "{".repeat(150);
    expect(braces.expand('"' + literals + '"')).toEqual([literals]);
    expect(braces.expand("\\{".repeat(150))).toEqual([literals]);
    expect(braces.expand("[" + literals + "]")).toEqual(["[" + literals + "]"]);
  });

  it("retains character and expansion limits", () => {
    expect(() => braces.parse("a".repeat(10001))).toThrow(/exceeds max characters/);
    expect(() => braces.expand("{1..10000}")).toThrow(/range limit/);
    expect(braces(["a/{b,c}", "{1..2}"])).toEqual(["a/(b|c)", "(1|2)"]);
  });

  it("preserves the consuming glob tools and rejects malicious patterns through them", () => {
    const globRequire = createRequire(require.resolve("fast-glob"));
    const micromatch = globRequire("micromatch") as { braces: (pattern: string, options: { expand: boolean }) => string[] };
    expect(micromatch.braces("{app,lib}/*.{ts,tsx}", { expand: true })).toEqual([
      "app/*.ts", "app/*.tsx", "lib/*.ts", "lib/*.tsx",
    ]);
    expect(() => micromatch.braces(nested(4998), { expand: true })).toThrow(/exceeds max depth/);
    const glob = require("fast-glob") as { sync: (pattern: string, options: { cwd: string }) => string[] };
    expect(glob.sync("{package,package-lock}.json", { cwd: process.cwd() }).sort()).toEqual([
      "package-lock.json", "package.json",
    ]);
    expect(() => glob.sync(nested(4998), { cwd: process.cwd() })).toThrow(/exceeds max depth/);
  });
});
