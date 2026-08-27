const MAX_FUTURE_SKEW_MS = 5 * 60_000;

export function trustedPublicationDate(
  candidates: Array<string | null | undefined>,
  now = Date.now(),
): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (!Number.isFinite(timestamp) || timestamp > now + MAX_FUTURE_SKEW_MS) continue;
    return new Date(timestamp).toISOString();
  }
  return null;
}

export function publicationDateInRange(
  publishedAt: string,
  from?: Date,
  to?: Date,
): boolean {
  const timestamp = Date.parse(publishedAt);
  return (
    Number.isFinite(timestamp) &&
    (!from || timestamp >= from.getTime()) &&
    (!to || timestamp <= to.getTime())
  );
}
