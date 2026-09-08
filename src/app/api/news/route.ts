import { getNews } from "@/lib/news/news-service.server";
import { logNews } from "@/lib/news/logger";
import { NewsQueryValidationError, parseNewsQuery } from "@/lib/news/query";
import { limitNewsRequest } from "@/lib/news/distributed-rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  let limit;
  try { limit = await limitNewsRequest(request); }
  catch {
    logNews("error", "news_rate_limit_unavailable", { requestId });
    return Response.json({ error: "News is temporarily unavailable.", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "10" } });
  }
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many requests. Please try again shortly.", requestId },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" },
      },
    );
  }

  try {
    const query = parseNewsQuery(new URL(request.url).searchParams);
    const response = await getNews(query);
    return Response.json(response, {
      headers: {
        // Continuation requests can expand the server-side live corpus even
        // when the internal page number repeats, so intermediary response
        // caching must not freeze a partial discovery stage.
        "Cache-Control": response.meta.dataSource === "database" && !query.continuationId
          ? "public, max-age=20, s-maxage=60, stale-while-revalidate=180"
          : "no-store",
        "X-RateLimit-Remaining": String(limit.remaining),
      },
    });
  } catch (error) {
    if (error instanceof NewsQueryValidationError) {
      return Response.json(
        { error: "Invalid news filters.", issues: error.issues, requestId },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    logNews("error", "news_api_failed", { requestId });
    return Response.json(
      { error: "News is temporarily unavailable.", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
