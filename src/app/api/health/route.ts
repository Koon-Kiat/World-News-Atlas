import { DEFAULT_RSS_FEEDS } from "@/config/news-sources";
import { getSitesD1Binding } from "@/lib/db/d1";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const database = await getSitesD1Binding();
  return Response.json(
    {
      status: "ok",
      databaseConfigured: Boolean(database),
      storage: database ? "d1" : "live-fallback",
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
