import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const SCOPES = ["global", "countries", "countries"];
export const MAX_ATTEMPTS = 3;
export const CONNECT_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 90_000;
export const MAX_SCOPE_DURATION_MS = 300_000;
export const MAX_STATUS_POLLS = 12;
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);
export const isTransientStatus = (status) => TRANSIENT.has(status);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

export async function runScheduledIngestion({ url, secret, bypassToken = "", period = "30d", runKey = randomUUID(),
  send = sendIngestionRequest, wait = sleep, random = Math.random, now = Date.now }) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || secret.length < 32 ||
    !["latest", "24h", "7d", "30d"].includes(period)) throw new Error("Invalid ingestion configuration");
  const results = [];
  for (const [index, scope] of SCOPES.entries()) {
    const startedAt = now();
    const requestId = createHash("sha256").update(`${runKey}:${index}:${scope}`).digest("hex").slice(0, 40);
    const body = JSON.stringify({ requestId, period, mode: "incremental", scope, stageLimit: 4 });
    const result = { scope, invocation: index + 1, success: false, attempts: 0, category: "unknown", status: 0, summary: null, durationMs: 0 };
    let failures = 0;
    let polls = 0;
    const deadline = startedAt + MAX_SCOPE_DURATION_MS;
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
        if (validSummary(json?.summary)) result.summary = json.summary;
        if (response.status >= 200 && response.status < 300) {
          if (json?.requestId === requestId && json.state === "SUCCEEDED" && validSummary(json.summary) && json.summary.providersFailed === 0) {
            result.success = true; result.category = "success"; break;
          }
          const pending = response.status === 202 && json?.requestId === requestId && ["RUNNING", "BUSY"].includes(json.state);
          result.category = pending ? json.state.toLowerCase() : "invalid_response";
          if (pending) polls++; else failures++;
          retry = true;
        } else { result.category = `http_${response.status}`; retry = isTransientStatus(response.status); failures++; }
        const retrySeconds = Number(response.retryAfter);
        const retryDate = Date.parse(response.retryAfter ?? "");
        retryAfterMs = Number.isFinite(retrySeconds) ? retrySeconds * 1000 : Number.isFinite(retryDate) ? retryDate - now() : 0;
      } catch (error) {
        result.category = ["timeout", "connect_timeout", "response_too_large"].includes(error?.message) ? error.message : "network";
        failures++;
        retry = true;
      }
      if (!retry || failures >= MAX_ATTEMPTS || polls >= MAX_STATUS_POLLS) break;
      // A running operation is not another failed transport attempt. Poll it
      // within a separate wall-clock budget, long enough for its 150s lease work.
      const delay = Math.max(result.category === "running" || result.category === "busy" ? 15_000
        : 1000 * 2 ** Math.max(0, failures - 1) + Math.floor(random() * 500), Math.min(30_000, Math.max(0, retryAfterMs)));
      await wait(Math.min(delay, Math.max(0, deadline - now())));
    }
    result.durationMs = Math.max(0, now() - startedAt);
    results.push(result);
  }
  return { results, success: results.every((result) => result.success) };
}

export function ingestionMarkdown(results) {
  const lines = ["| Scope | Result | Attempts | Run | Stages | Stored | Stories | Duration | Detail |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- |"];
  for (const result of results) {
    const summary = result.summary;
    lines.push(`| ${result.scope} (${result.invocation}) | ${result.success ? "Success" : "Failed"} | ${result.attempts} | ${summary?.runId ?? "—"} | ${summary?.stagesProcessed ?? "—"} | ${summary?.stored ?? "—"} | ${summary?.storiesUpdated ?? "—"} | ${(result.durationMs / 1000).toFixed(1)}s | ${result.category} |`);
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
      bypassToken: process.env.OAI_SITES_BYPASS_TOKEN, period: process.env.PERIOD,
      runKey: `${process.env.GITHUB_RUN_ID ?? randomUUID()}:${process.env.GITHUB_RUN_ATTEMPT ?? "1"}` }, async (report) => {
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
      console.info(report);
    });
  } catch {
    const message = "Ingestion runner failed: check required configuration and repository access.\n";
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, message);
    console.error(message); process.exitCode = 1;
  }
}
