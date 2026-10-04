// Shared by the Node scheduler and Worker providers. Delays are milliseconds.
export const MAX_RETRY_AFTER_MS = 15 * 60_000;
export const PROVIDER_BACKOFF_BASE_MS = 30_000;

/** Parse RFC 9110 delay-seconds or HTTP-date; null means absent/invalid. */
export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== "string" || value.length > 128) return null;
  const raw = value.trim();
  if (/^\d+$/.test(raw)) return Math.min(MAX_RETRY_AFTER_MS, Number(raw) * 1000);
  // Date.parse also accepts bare numbers, ISO dates, and garbage prefixes.
  // Only the three HTTP-date wire formats are eligible for date parsing.
  const httpDate = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
  const obsoleteDate = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$/;
  const asctime = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/;
  if (!httpDate.test(raw) && !obsoleteDate.test(raw) && !asctime.test(raw)) return null;
  let at = Date.parse(asctime.test(raw) ? `${raw} GMT` : raw);
  if (!Number.isFinite(at)) return null;
  const date = new Date(at);
  const day = Number(asctime.test(raw) ? raw.slice(8, 10).trim() : raw.split(", ")[1].slice(0, 2));
  const month = raw.match(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/)[0];
  // Date.parse normalizes e.g. 31 February into March. That is malformed input,
  // not a valid upstream minimum. Reject it before computing a delay.
  if (date.getUTCDate() !== day || date.toUTCString().slice(8, 11) !== month) return null;
  if (obsoleteDate.test(raw)) {
    const currentYear = new Date(now).getUTCFullYear();
    let year = Math.floor(currentYear / 100) * 100 + Number(raw.match(/-\d{2} /)[0].slice(1, 3));
    // RFC 9110's rule for an obsolete two-digit year more than 50 years ahead.
    if (year > currentYear + 50) year -= 100;
    date.setUTCFullYear(year);
    if (date.getUTCDate() !== day) return null;
    at = date.getTime();
  }
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - now));
}

/** Positive jitter never shortens an upstream minimum delay. */
export function retryDelayMs(value, { now = Date.now(), attempt = 1, baseMs = PROVIDER_BACKOFF_BASE_MS, random = Math.random } = {}) {
  const minimum = parseRetryAfter(value, now) ?? Math.min(MAX_RETRY_AFTER_MS, baseMs * 2 ** Math.min(10, Math.max(0, attempt - 1)));
  return Math.min(MAX_RETRY_AFTER_MS, minimum + Math.floor(Math.max(0, Math.min(1, random())) * Math.min(1000, minimum * 0.1)));
}

export function isTransientStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}
