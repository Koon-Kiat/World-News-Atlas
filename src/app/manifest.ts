import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "World News Atlas",
    short_name: "Worldline",
    description: "Explore world news by country and follow stories across borders.",
    start_url: "/country#top",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["news", "education"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "One country", short_name: "Country", url: "/country#top", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Compare two countries", short_name: "Compare", url: "/compare#top", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Saved articles", short_name: "Saved", url: "/saved", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
