import type {
  ProviderCapabilities,
  ProviderFetchRequest,
  ProviderFetchResult,
  ProviderName,
  ProviderFailure,
} from "../types";
import { boundedText } from "@/lib/bounded-stream";
import { retryDelayMs } from "../retry-policy.mjs";
import { ingestionFailureKind } from "../ingestion-outcome";

export interface NewsProvider {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;
  fetchLatest(request?: ProviderFetchRequest): Promise<ProviderFetchResult>;
  search(query: string, request?: ProviderFetchRequest): Promise<ProviderFetchResult>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly code: string,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function providerFailure(provider: ProviderName, error: unknown): ProviderFailure {
  return error instanceof ProviderError
    ? { provider, code: error.code, ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}) }
    : { provider, code: "UNEXPECTED_FAILURE" };
}

export function branchFailures(provider: ProviderName, results: PromiseSettledResult<unknown>[]): ProviderFailure[] {
  return results.flatMap((result) => result.status === "rejected" ? [providerFailure(provider, result.reason)] : []);
}

export function throwBranchFailure(provider: ProviderName, results: PromiseSettledResult<unknown>[]): never {
  const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  const selected = errors.find((error) => ingestionFailureKind(providerFailure(provider, error).code) === "terminal") ??
    errors.find((error) => ingestionFailureKind(providerFailure(provider, error).code) === "retryable_internal") ?? errors[0];
  throw selected ?? new ProviderError(provider, "UNEXPECTED_FAILURE", "Missing provider result");
}

export async function rejectProviderResponse(provider: ProviderName, response: Response): Promise<never> {
  const retryAfterMs = [429, 503].includes(response.status) ? retryDelayMs(response.headers.get("retry-after")) : undefined;
  await response.body?.cancel();
  throw new ProviderError(provider, `HTTP_${response.status}`, "Provider returned an error", retryAfterMs);
}

/** One timeout spans headers and the bounded body; no background body read survives it. */
export async function fetchProviderText(provider: ProviderName, input: string | URL, init: RequestInit, timeoutMs: number, maximum = 2 * 1024 * 1024, onResponse?: (response: Response) => Promise<void>): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(input, { ...init, signal });
    await onResponse?.(response);
    if (!response.ok) await rejectProviderResponse(provider, response);
    let text: string;
    try { text = await boundedText(response.body, maximum, signal); }
    catch {
      throw new ProviderError(provider, signal.aborted ? "STAGE_TIMEOUT" : "RESPONSE_TOO_LARGE", "Provider body could not be accepted");
    }
    return { response, text };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(provider, signal.aborted ? "STAGE_TIMEOUT" : "REQUEST_FAILED", "Provider request failed");
  } finally { clearTimeout(timer); }
}
