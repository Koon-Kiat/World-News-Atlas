const CACHE_NAME = "worldline-shell-v3";
const ASSET_CACHE = "worldline-assets-v3";
const MAX_ASSETS = 80;
const APP_SHELL = ["/", "/country", "/compare", "/saved", "/settings", "/offline.html", "/theme.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];
let writes = Promise.resolve();

function cacheable(response) {
  return response.ok && !response.redirected &&
    !/\b(?:private|no-store)\b/i.test(response.headers.get("Cache-Control") || "") &&
    !response.headers.has("Set-Cookie");
}
function remember(name, request, response) {
  if (!cacheable(response)) return Promise.resolve();
  // Serialize eviction with writes; cache failures never break network results.
  writes = writes.then(async () => {
    const cache = await caches.open(name);
    await cache.put(request, response);
    if (name === ASSET_CACHE) {
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)));
    }
  }).catch(() => undefined);
  return writes;
}
self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all(APP_SHELL.map(async (url) => {
    try { const response = await fetch(url); await remember(CACHE_NAME, url, response); } catch {}
  })));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith("worldline-") && ![CACHE_NAME, ASSET_CACHE].includes(key))
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/api") return;
  if (request.headers.has("Authorization")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      // Exact known routes only: exclude query strings and private pages.
      if (!url.search && APP_SHELL.includes(url.pathname)) event.waitUntil(remember(CACHE_NAME, request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match("/country")) || (await caches.match("/offline.html")) || Response.error()));
    return;
  }
  const staticAsset = !url.search && (url.pathname.startsWith("/_next/static/") || APP_SHELL.includes(url.pathname));
  if (!staticAsset) return;
  event.respondWith(fetch(request).then((response) => {
    event.waitUntil(remember(ASSET_CACHE, request, response.clone()));
    return response;
  }).catch(async () => (await caches.match(request)) || Response.error()));
});
