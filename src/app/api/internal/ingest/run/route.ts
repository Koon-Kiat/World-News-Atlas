import { handleIngestionRequest } from "@/lib/news/ingest-route";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleIngestionRequest(request);
}
