export function relativeTime(value: string, referenceTime: string): string {
  const elapsed = new Date(referenceTime).getTime() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return "Date unavailable";
  const hours = Math.max(0, Math.round(elapsed / 3_600_000));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
