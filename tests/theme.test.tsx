// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
const bootstrap = readFileSync("public/theme.js", "utf8");
describe("permanent dark appearance", () => {
  it.each(["light", "system", "dark", null])("replaces legacy preference %s without consulting the OS", (stored) => {
    const root = { dataset: { theme: "light" }, style: { colorScheme: "light" } };
    let preference = stored;
    runInNewContext(bootstrap, { document: { documentElement: root }, window: {
      localStorage: { setItem: (_key: string, value: string) => { preference = value; } },
      matchMedia: () => { throw new Error("Dark mode must not depend on the system"); },
    } });
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(preference).toBe("dark");
  });
  it("stays dark when browser storage is unavailable", () => {
    const root = { dataset: {}, style: { colorScheme: "" } };
    runInNewContext(bootstrap, { document: { documentElement: root }, window: {
      localStorage: { setItem: () => { throw new Error("Storage disabled"); } },
    } });
    expect(root.dataset).toEqual({ theme: "dark" });
    expect(root.style.colorScheme).toBe("dark");
  });
});
