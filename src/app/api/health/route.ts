import { DEFAULT_RSS_FEEDS } from "@/config/news-sources";

export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(
    {
      status: "ok",
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      providers: {
        bingNews: true,
        newsApi: Boolean(process.env.NEWSAPI_KEY),
        gdelt: process.env.GDELT_ENABLED?.toLowerCase() === "true",
        rss: process.env.RSS_FEEDS_JSON
          ? process.env.RSS_FEEDS_JSON !== "[]"
          : DEFAULT_RSS_FEEDS.length > 0,
        fixtureFallback: process.env.NEWS_FIXTURES_ENABLED?.toLowerCase() === "true",
      },
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
