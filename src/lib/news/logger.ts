type LogLevel = "info" | "warn" | "error";

function sanitized(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      /key|secret|token|authorization/i.test(key) ? "[redacted]" : value,
    ]),
  );
}

export function logNews(
  level: LogLevel,
  event: string,
  details: Record<string, unknown> = {},
): void {
  if (process.env.NEWS_DIAGNOSTIC_QUIET === "true") return;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...sanitized(details),
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}
