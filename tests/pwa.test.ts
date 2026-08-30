import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("progressive web app", () => {
  it("publishes an installable standalone manifest", () => {
    const value = manifest();
    expect(value.name).toBe("World News Atlas");
    expect(value.display).toBe("standalone");
    expect(value.start_url).toBe("/country#top");
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icon-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/icon-512.png", sizes: "512x512" }),
    ]));
  });

  it("keeps news API responses out of the offline cache", async () => {
    const serviceWorker = await readFile(join(process.cwd(), "public", "sw.js"), "utf8");
    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain('caches.match("/country")');
  });
});
