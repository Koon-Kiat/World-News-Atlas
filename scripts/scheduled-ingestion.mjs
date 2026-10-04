import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { isTransientStatus, parseRetryAfter, retryDelayMs } from "../src/lib/news/retry-policy.mjs";
export { isTransientStatus } from "../src/lib/news/retry-policy.mjs";

export const INGESTION_PASSES = [
  { name: "global-discovery", scope: "global" },
  { name: "country-rotation-first", scope: "countries" },
  { name: "country-rotation-next", scope: "countries" },
];
export const ARCHIVE_SCHEDULE = "17 2,14 * * *";
export const MAX_ATTEMPTS = 3;
export const CONNECT_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 165_000;
export const MAX_SCOPE_DURATION_MS = 300_000;
export const MAX_JOB_DURATION_MS = 15 * 60_000;
export const MAX_STATUS_POLLS = 12;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function scheduledIngestionMode({ eventName, schedule, period } = {}) {
  const selected = eventName === "schedule" ? schedule === ARCHIVE_SCHEDULE ? "30d" : "24h" : period || "24h";
  if (!["latest", "24h", "7d", "30d"].includes(selected)) throw new Error("Invalid ingestion period");
  return { period: selected, mode: ["7d", "30d"].includes(selected) ? "backfill" : "incremental" };
}

export function sendIngestionRequest(url, headers, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let connectTimer;
    const timer = setTimeout(() => request.destroy(new Error("timeout")), timeoutMs);
    const finish = () => { clearTimeout(timer); clearTimeout(connectTimer); };
    const request = httpsRequest(url, { method: "POST", headers }, (response) => {
      clearTimeout(connectTimer);
      let size = 0;
      const chunks = [];
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 128 * 1024) { request.destroy(new Error("response_too_large")); return; }
        chunks.push(chunk);
      });
      response.on("error", () => { finish(); reject(new Error("network")); });
      response.on("end", () => {
        finish();
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
        resolve({ status: response.statusCode ?? 0, retryAfter: response.headers["retry-after"], json });
      });
    });
    connectTimer = setTimeout(() => request.destroy(new Error("connect_timeout")), Math.min(CONNECT_TIMEOUT_MS, timeoutMs));
    request.on("socket", (socket) => {
      if (!socket.connecting) clearTimeout(connectTimer);
      else socket.once("secureConnect", () => clearTimeout(connectTimer));
    });
    request.on("error", (error) => {
      finish();
      reject(new Error(["timeout", "connect_timeout", "response_too_large"].includes(error.message) ? error.message : "network"));
    });
    request.end(body);
  });
}

export function validSummary(value) {
  return value && typeof value === "object" && typeof value.runId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value.runId) && value.persisted === true &&
    ["stagesProcessed", "stored", "storiesUpdated", "providersFailed"].every((field) =>
      Number.isSafeInteger(value[field]) && value[field] >= 0);
}

export async function runScheduledIngestion({ url, secret, bypassToken = "", period = "24h", runKey = randomUUID(),
  send = sendIngestionRequest, wait = sleep, random = Math.random, now = Date.now }) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || secret.length < 32 ||
    !["latest", "24h", "7d", "30d"].includes(period)) throw new Error("Invalid ingestion configuration");
  const results = [];
  const jobDeadline = now() + MAX_JOB_DURATION_MS;
  const { mode } = scheduledIngestionMode({ period });
  for (const [index, pass] of INGESTION_PASSES.entries()) {
    const { scope, name } = pass;
    const startedAt = now();
    const requestId = createHash("sha256").update(`${runKey}:${name}:${period}`).digest("hex").slice(0, 40);
    const body = JSON.stringify({ requestId, period, mode, scope, stageLimit: 4 });
    const result = { scope, name, invocation: index + 1, success: false, outcome: "FAILED", attempts: 0, operationAttempts: 0,
      category: "unknown", status: 0, summary: null, durationMs: 0, retryAfterMs: 0 };
    let failures = 0;
    let polls = 0;
    const deadline = Math.min(startedAt + MAX_SCOPE_DURATION_MS, jobDeadline);
    for (let attempt = 1; failures < MAX_ATTEMPTS && polls < MAX_STATUS_POLLS; attempt++) {
      if (now() >= deadline) { result.category = "operation_timeout"; break; }
      result.attempts = attempt;
      const timestamp = String(Math.floor(now() / 1000));
      const nonce = randomBytes(24).toString("hex");
      const signature = createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
      const headers = { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)),
        "X-Ingest-Timestamp": timestamp, "X-Ingest-Nonce": nonce, "X-Ingest-Signature": signature,
        ...(bypassToken ? { "OAI-Sites-Authorization": `Bearer ${bypassToken}` } : {}) };
      let retry = false;
      let retryAfterMs = 0;
      try {
        const response = await send(url, headers, body, Math.min(REQUEST_TIMEOUT_MS, deadline - now()));
        result.status = response.status;
        const json = response.json;
        if (json?.requestId === requestId && validSummary(json?.summary)) result.summary = json.summary;
        if (json?.requestId === requestId && Number.isSafeInteger(json.attempts) && json.attempts >= 0) result.operationAttempts = json.attempts;
        if (response.status >= 200 && response.status < 300) {
          const succeeded = json?.state === "SUCCEEDED" && json.summary?.providersFailed === 0;
          const degraded = json?.state === "DEGRADED" && json.outcome === "DEGRADED" && json.summary?.providersFailed > 0 &&
            (json.summary.stored > 0 || json.summary.usefulStages > 0) && Array.isArray(json.summary.providerFailures) &&
            json.summary.providerFailures.length === json.summary.providersFailed;
          if (response.status === 200 && json?.requestId === requestId && validSummary(json.summary) && (succeeded || degraded)) {
            result.success = true; result.outcome = degraded ? "DEGRADED" : "SUCCESS";
            result.category = degraded ? "degraded" : "success";
            result.retryAfterMs = parseRetryAfter(response.retryAfter, now()) ?? 0;
            break;
          }
          const pending = response.status === 202 && json?.requestId === requestId && ["RUNNING", "BUSY"].includes(json.state);
          result.category = pending ? json.state.toLowerCase() : "invalid_response";
          if (pending) polls++; else failures++;
          retry = true;
        } else {
          result.category = `http_${response.status}`;
          retry = isTransientStatus(response.status);
          if (json?.requestId === requestId && (json.state === "RETRY_BUDGET_EXHAUSTED" || json.state === "FAILED_TERMINAL")) {
            result.category = json.state.toLowerCase(); retry = false;
          }
          failures++;
        }
        retryAfterMs = parseRetryAfter(response.retryAfter, now()) ?? 0;
        result.retryAfterMs = retryAfterMs;
      } catch (error) {
        result.category = ["timeout", "connect_timeout", "response_too_large"].includes(error?.message) ? error.message : "network";
        failures++;
        retry = true;
      }
      if (!retry || failures >= MAX_ATTEMPTS || polls >= MAX_STATUS_POLLS) break;
      // A running operation is not another failed transport attempt. Poll it
      // within a separate wall-clock budget, long enough for its 150s lease work.
      const delay = Math.max(result.category === "running" || result.category === "busy" ? 15_000
        : retryDelayMs(undefined, { attempt: failures, baseMs: 1000, random }), retryAfterMs);
      if (delay >= deadline - now()) { result.category = "cooldown_exceeds_deadline"; break; }
      await wait(delay);
    }
    result.durationMs = Math.max(0, now() - startedAt);
    results.push(result);
  }
  return { results, success: results.every((result) => result.success) };
}

export function ingestionMarkdown(results) {
  const outcome = results.some((result) => !result.success) ? "FAILED" : results.some((result) => result.outcome === "DEGRADED") ? "DEGRADED" : "SUCCESS";
  const lines = [`**Outcome: ${outcome}**`, "", "| Scope / pass | Result | Requests / operations | Run | Stages | Stored | Stories | Duration | Cooldown | Detail |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |"];
  for (const result of results) {
    const summary = result.summary;
    const failures = Array.isArray(summary?.providerFailures) ? summary.providerFailures.slice(0, 4)
      .filter((failure) => ["NEWSAPI", "GDELT", "RSS", "OTHER"].includes(failure?.provider) && /^[A-Z][A-Z0-9_]{0,63}$/.test(failure?.code ?? ""))
      .map((failure) => `${failure.provider}: ${failure.code}`).join(", ") : "";
    lines.push(`| ${result.name ?? result.scope} | ${result.outcome ?? (result.success ? "SUCCESS" : "FAILED")} | ${result.attempts} / ${result.operationAttempts ?? "—"} | ${summary?.runId ?? "—"} | ${summary?.stagesProcessed ?? "—"} | ${summary?.stored ?? "—"} | ${summary?.storiesUpdated ?? "—"} | ${(result.durationMs / 1000).toFixed(1)}s | ${Math.ceil((result.retryAfterMs ?? 0) / 1000)}s | ${result.category}${failures ? ` (${failures})` : ""} |`);
  }
  return `${lines.join("\n")}\n`;
}

export async function ingestionExitCode(options, report) {
  const outcome = await runScheduledIngestion(options);
  await report(ingestionMarkdown(outcome.results));
  return outcome.success ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await ingestionExitCode({ url: process.env.NEWS_INGEST_URL, secret: process.env.NEWS_INGEST_HMAC_SECRET ?? "",
      bypassToken: process.env.OAI_SITES_BYPASS_TOKEN, ...scheduledIngestionMode({ eventName: process.env.GITHUB_EVENT_NAME,
        schedule: process.env.INGESTION_SCHEDULE, period: process.env.PERIOD }),
      runKey: process.env.GITHUB_RUN_ID ?? randomUUID() }, async (report) => {
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
      console.info(report);
    });
  } catch {
    const message = "Ingestion runner failed: check required configuration and repository access.\n";
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, message);
    console.error(message); process.exitCode = 1;
  }
}
