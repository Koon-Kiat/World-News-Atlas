import { getNews } from "@/lib/news/news-service.server";
import { clientKey } from "@/lib/news/client-key";
import { logNews } from "@/lib/news/logger";
import { NewsQueryValidationError, parseNewsQuery } from "@/lib/news/query";
import { checkRateLimit } from "@/lib/news/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const limit = checkRateLimit(clientKey(request), { limit: 90, windowMs: 60_000 });
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
        "Cache-Control": response.meta.dataSource === "fixtures"
          ? "no-store"
          : "public, max-age=20, s-maxage=60, stale-while-revalidate=180",
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
