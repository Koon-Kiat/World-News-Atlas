export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(
    {
      status: "ok",
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      providers: {
        newsApi: Boolean(process.env.NEWSAPI_KEY),
        gdelt: process.env.GDELT_ENABLED?.toLowerCase() !== "false",
        rss: Boolean(process.env.RSS_FEEDS_JSON && process.env.RSS_FEEDS_JSON !== "[]"),
        fixtureFallback: process.env.NEWS_FIXTURES_ENABLED?.toLowerCase() !== "false",
      },
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
