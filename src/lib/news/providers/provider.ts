import type {
  ProviderCapabilities,
  ProviderFetchRequest,
  ProviderFetchResult,
  ProviderName,
} from "../types";

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
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
