import { z } from "zod";
import { getConfiguredNewsStore } from "./configured-store";
import { ingestionAuthHeaders, verifyIngestionAuth } from "./ingest-auth";
import { runNewsIngestion, type IngestionSummary } from "./ingest";
import { logNews } from "./logger";
import type { NewsStore } from "./store";

const MAX_BODY_BYTES = 1_024;
const requestSchema = z.object({
  period: z.enum(["latest", "24h", "7d", "30d"]).default("30d"),
  mode: z.enum(["incremental", "backfill"]).default("incremental"),
  scope: z.enum(["global", "countries"]).default("countries"),
  stageLimit: z.number().int().min(1).max(4).default(4),
}).strict();

interface IngestionHandlerDependencies {
  now?: () => Date;
  secret?: string;
  store?: NewsStore | null;
  run?: typeof runNewsIngestion;
}

function jsonError(status: number, error: string, requestId: string): Response {
  return Response.json({ error, requestId }, { status, headers: { "Cache-Control": "no-store" } });
}

function safeSummary(summary: IngestionSummary): IngestionSummary {
  return { ...summary };
}

export async function handleIngestionRequest(request: Request, dependencies: IngestionHandlerDependencies = {}): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (request.method !== "POST") return jsonError(405, "Method not allowed.", requestId);
  if (process.env.NODE_ENV === "production" && new URL(request.url).protocol !== "https:") return jsonError(400, "Secure transport is required.", requestId);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return jsonError(415, "Unsupported media type.", requestId);
  const statedLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(statedLength) && statedLength > MAX_BODY_BYTES) return jsonError(413, "Request body is too large.", requestId);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return jsonError(413, "Request body is too large.", requestId);
  const secret = dependencies.secret ?? process.env.NEWS_INGEST_HMAC_SECRET ?? "";
  const now = dependencies.now?.() ?? new Date();
  const auth = await verifyIngestionAuth(secret, ingestionAuthHeaders(request.headers), rawBody, now);
  if (!auth) return jsonError(401, "Authentication failed.", requestId);
  let input: z.infer<typeof requestSchema>;
  try { input = requestSchema.parse(JSON.parse(rawBody)); }
  catch { return jsonError(400, "Invalid ingestion request.", requestId); }
  const store = dependencies.store === undefined ? await getConfiguredNewsStore() : dependencies.store;
  if (!store) return jsonError(503, "Ingestion storage is unavailable.", requestId);
  await store.deleteExpiredIngestionNonces(now);
  if (!await store.claimIngestionNonce(auth.nonce, auth.receivedAt, auth.expiresAt)) return jsonError(409, "Request could not be accepted.", requestId);
  try {
    const run = dependencies.run ?? runNewsIngestion;
    const summary = await run({
      period: input.period, mode: input.mode, stageLimit: input.stageLimit,
      countries: input.scope === "global" ? [] : undefined,
      store, stateStore: store, persist: true,
    });
    return Response.json({ requestId, summary: safeSummary(summary) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    logNews("error", "ingestion_request_failed", { requestId });
    return jsonError(500, "Ingestion did not complete.", requestId);
  }
}
