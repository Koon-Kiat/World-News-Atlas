import { z } from "zod";
import { createHash } from "node:crypto";
import { boundedText } from "@/lib/bounded-stream";
import { getConfiguredNewsStore } from "./configured-store";
import { ingestionAuthHeaders, verifyIngestionAuth } from "./ingest-auth";
import { runNewsIngestion } from "./ingest";
import { logNews } from "./logger";
import type { NewsStore } from "./store";

const MAX_BODY_BYTES = 1_024;
const requestSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional(),
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

export async function handleIngestionRequest(request: Request, dependencies: IngestionHandlerDependencies = {}): Promise<Response> {
  let requestId: string = crypto.randomUUID();
  if (request.method !== "POST") return jsonError(405, "Method not allowed.", requestId);
  if (process.env.NODE_ENV === "production" && new URL(request.url).protocol !== "https:") return jsonError(400, "Secure transport is required.", requestId);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return jsonError(415, "Unsupported media type.", requestId);
  const statedLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(statedLength) && statedLength > MAX_BODY_BYTES) return jsonError(413, "Request body is too large.", requestId);
  let rawBody: string;
  try { rawBody = await boundedText(request.body, MAX_BODY_BYTES, AbortSignal.timeout(10_000)); }
  catch { return jsonError(413, "Request body could not be accepted.", requestId); }
  const secret = dependencies.secret ?? process.env.NEWS_INGEST_HMAC_SECRET ?? "";
  const now = dependencies.now?.() ?? new Date();
  const auth = await verifyIngestionAuth(secret, ingestionAuthHeaders(request.headers), rawBody, now);
  if (!auth) return jsonError(401, "Authentication failed.", requestId);
  let input: z.infer<typeof requestSchema>;
  try { input = requestSchema.parse(JSON.parse(rawBody)); }
  catch { return jsonError(400, "Invalid ingestion request.", requestId); }
  // The stable identifier is in the HMAC-authenticated body. Legacy callers
  // remain accepted, but only the new protocol can safely retry with fresh nonces.
  requestId = input.requestId ?? auth.nonce;
  let store: NewsStore;
  try {
    const configured = dependencies.store === undefined ? await getConfiguredNewsStore() : dependencies.store;
    if (!configured) return jsonError(503, "Ingestion storage is unavailable.", requestId);
    store = configured;
    await store.deleteExpiredIngestionNonces(now);
    if (!await store.claimIngestionNonce(auth.nonce, auth.receivedAt, auth.expiresAt)) return jsonError(409, "Request could not be accepted.", requestId);
    const digest = createHash("sha256").update(rawBody).digest("hex");
    const claim = await store.ingestionRequests.claim(requestId, digest, now);
    if (claim.state === "CONFLICT") return jsonError(409, "Logical request does not match the accepted operation.", requestId);
    if (claim.state === "SUCCEEDED") return Response.json({ requestId, state: claim.state, summary: claim.summary }, { headers: { "Cache-Control": "no-store" } });
    if (claim.state === "FAILED") return Response.json({ requestId, state: claim.state, error: "The accepted operation failed. A later scheduled run can resume saved checkpoints.", summary: claim.summary }, { status: 422, headers: { "Cache-Control": "no-store" } });
    if (claim.state === "RUNNING" || claim.state === "BUSY") return Response.json({ requestId, state: claim.state }, {
      status: 202, headers: { "Cache-Control": "no-store", "Retry-After": "15" },
    });
  } catch {
    logNews("error", "ingestion_request_storage_failed", { requestId });
    return jsonError(503, "Ingestion storage is temporarily unavailable.", requestId);
  }
  const deadline = Date.now() + 150_000;
  let nextRenewalAt = 0;
  const currentTime = () => dependencies.now?.() ?? new Date();
  const beforeWork = async () => {
    if (Date.now() >= deadline) throw new Error("Ingestion deadline exceeded");
    if (Date.now() < nextRenewalAt) return;
    if (!await store.ingestionRequests.renew(requestId, currentTime())) throw new Error("Ingestion lease expired");
    nextRenewalAt = Date.now() + 10_000;
  };
  try {
    await beforeWork();
    const run = dependencies.run ?? runNewsIngestion;
    const summary = await run({
      period: input.period, mode: input.mode, stageLimit: input.stageLimit,
      countries: input.scope === "global" ? [] : undefined,
      store, stateStore: store, persist: true, beforeWork,
    });
    await beforeWork();
    const state = summary.providersFailed > 0 ? "FAILED" : "SUCCEEDED";
    await store.ingestionRequests.finish(requestId, state, summary, currentTime());
    return Response.json({ requestId, state, summary }, { status: state === "SUCCEEDED" ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch {
    try { await store.ingestionRequests.finish(requestId, "FAILED", null, currentTime()); } catch {}
    logNews("error", "ingestion_request_failed", { requestId });
    return jsonError(500, "Ingestion did not complete.", requestId);
  }
}
