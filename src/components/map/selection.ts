export function updateCountrySelection(current: string[], countryCode: string): string[] {
  if (current.includes(countryCode)) {
    return current.filter((code) => code !== countryCode);
  }
  if (current.length < 2) return [...current, countryCode];
  return [current[1], countryCode];
}
