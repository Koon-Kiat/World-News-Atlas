// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: string | { url: string }) => new URL(typeof request === "string" ? request : request.url, "https://example.test").href;
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return { put: async (request: string | { url: string }, response: Response) => { store.set(key(request), response); },
        keys: async () => [...store.keys()], delete: async (request: string) => store.delete(key(request)) };
    },
    async match(request: string | { url: string }) {
      for (const store of stores.values()) { const found = store.get(key(request)); if (found) return found.clone(); }
    }, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name),
  };
  const fetcher = vi.fn<typeof fetch>(async () => new Response("good"));
  runInNewContext(readFileSync("public/sw.js", "utf8"), { URL, Response, caches, fetch: fetcher,
    self: { location: { origin: "https://example.test" }, addEventListener: (type: string, callback: (event: unknown) => void) => listeners.set(type, callback),
      skipWaiting() {}, clients: { claim: async () => {} } } });
  return { stores, fetcher, caches,
    async fetch(path: string, mode = "navigate") {
      let result: Promise<Response> | undefined;
      const pending: Promise<unknown>[] = [];
      listeners.get("fetch")!({ request: { method: "GET", url: `https://example.test${path}`, mode, headers: new Headers() },
        respondWith: (response: Promise<Response>) => { result = response; }, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
      const response = await result; await Promise.all(pending); return response;
    } };
}
it("caches successful navigation, never caches errors, and serves the last successful page offline", async () => {
  const sw = worker();
  await sw.fetch("/country");
  expect(await (await sw.caches.match("/country"))?.text()).toBe("good");
  for (const status of [401, 404, 500, 503]) {
    sw.fetcher.mockResolvedValueOnce(new Response("failure", { status }));
    expect((await sw.fetch("/country"))?.status).toBe(status);
    expect(await (await sw.caches.match("/country"))?.text()).toBe("good");
  }
  sw.fetcher.mockRejectedValueOnce(new Error("offline"));
  expect(await (await sw.fetch("/country"))?.text()).toBe("good");
});
it("excludes API/private/query responses and bounds cached static resources", async () => {
  const sw = worker();
  expect(await sw.fetch("/api/news")).toBeUndefined();
  expect(sw.fetcher).not.toHaveBeenCalled();
  await sw.fetch("/country?search=private");
  expect(await sw.caches.match("/country?search=private")).toBeUndefined();
  sw.fetcher.mockResolvedValueOnce(new Response("private", { headers: { "Cache-Control": "private, no-store" } }));
  await sw.fetch("/saved"); expect(await sw.caches.match("/saved")).toBeUndefined();
  for (let index = 0; index < 85; index++) await sw.fetch(`/_next/static/${index}.js`, "cors");
  expect(sw.stores.get("worldline-assets-v3")?.size).toBe(80);
});
