// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Exercise the shipped Vite copy: a standalone launch-editor override does not
// replace this bundled dependency. No editor or shell is invoked by these tests.
const bundle = readFileSync(new URL("../node_modules/vite/dist/node/chunks/node.js", import.meta.url), "utf8");
function bundledHelper(name: string, platform = "win32") {
  const start = bundle.indexOf(`var ${name} =`);
  expect(start).toBeGreaterThan(0);
  const source = bundle.slice(start, bundle.indexOf("//#endregion", start));
  const paths = platform === "linux" ? { ...path.posix, resolve: (file: string) => path.posix.resolve("/mnt/c/project", file), relative: (_from: string, to: string) => path.posix.relative("/mnt/c/project", to) } : path.win32;
  return runInNewContext(`${source}; ${name}()`, {
    process: { platform, env: {} },
    __require: (id: string) => id === "path" ? paths : id === "os" ? { release: () => "Microsoft WSL2" } : { fileURLToPath },
    __commonJSMin: (factory: (exports: object, module: { exports: unknown }) => void) => () => {
      const bundledModule = { exports: {} }; factory(bundledModule.exports, bundledModule); return bundledModule.exports;
    },
  });
}

describe("bundled editor dependency security", () => {
  it("normalizes after stripping location so a missing parent segment cannot reach command construction", () => {
    const parse = bundledHelper("require_parse_file");
    const result = parse("C:\\project\\missing-%EDITOR_PROBE%\\..:1:2");
    expect(result.fileName).toBe("C:\\project");
    expect(result.fileName).not.toContain("%EDITOR_PROBE%");
    expect(result).toMatchObject({ lineNumber: "1", columnNumber: "2" });
  });

  it.each(["C:\\project\\%EDITOR_PROBE%.ts", "C:\\project\\line\nbreak.ts", "C:\\project\\line\rbreak.ts"])("rejects unsafe Windows command argument %j", (file) => {
    const construct = bundledHelper("require_construct_windows_launch_command");
    expect(() => construct("code", [file])).toThrow();
  });

  it("rejects percent signs decoded from editor endpoint query parameters", () => {
    const file = new URLSearchParams("file=C%3A%5Cproject%5C%25EDITOR_PROBE%25.ts").get("file");
    expect(() => bundledHelper("require_construct_windows_launch_command")("code", [file])).toThrow();
  });

  it.each(["+command.ts", "--option.ts"])("protects WSL editor filenames %s with and without positions", (file) => {
    const args = bundledHelper("require_get_args", "linux");
    expect(args("vim", file)).toEqual([`./${file}`]);
    expect(args("vim", file, "4", "2")).toEqual(["+call cursor(4, 2)", `./${file}`]);
  });

  it("preserves ordinary file URLs, spaces, routing characters, and editor positions", () => {
    const parse = bundledHelper("require_parse_file");
    const actual = path.resolve("package.json");
    expect(parse(pathToFileURL(actual).href).fileName).toBe(path.win32.resolve(actual));
    const file = "C:\\project\\app folder\\[slug]\\(group)\\+$page.tsx";
    expect(parse(`${file}:4:2`)).toMatchObject({ fileName: file, lineNumber: "4", columnNumber: "2" });
    expect(bundledHelper("require_get_args")("code", file, "4", "2")).toEqual(["-r", "-g", `${file}:4:2`]);
    expect(bundledHelper("require_construct_windows_launch_command")("code", [file])).toContain(file);
  });
});
