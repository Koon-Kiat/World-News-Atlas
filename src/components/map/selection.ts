export function updateCountrySelection(
  current: string[],
  countryCode: string,
  limit: 1 | 2 = 2,
): string[] {
  if (current.includes(countryCode)) {
    return current.filter((code) => code !== countryCode);
  }
  if (limit === 1) return [countryCode];
  if (current.length < limit) return [...current, countryCode];
  return [current[1], countryCode];
}
