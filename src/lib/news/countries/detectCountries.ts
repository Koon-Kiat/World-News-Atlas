import { COUNTRY_SIGNALS } from "./aliases";
import { getCountryName } from "./metadata";
import type { CountryReference } from "../types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(text: string, phrase: string, caseSensitive = false): boolean {
  const flags = caseSensitive ? "u" : "iu";
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}([^\\p{L}\\p{N}]|$)`, flags).test(text);
}

function containsIsoCode(text: string, code: string): boolean {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(code)}(?!\\$)([^\\p{L}\\p{N}]|$)`,
    "u",
  ).test(text);
}

export function detectCountries(
  title: string,
  description: string | null | undefined = null,
  supplementalText: string | null | undefined = null,
): CountryReference[] {
  const text = `${title}\n${description ?? ""}`;
  const supplemental = supplementalText ?? "";
  const detected: CountryReference[] = [];

  for (const signal of COUNTRY_SIGNALS) {
    const nameHits = signal.names.filter((name) => containsPhrase(text, name)).length;
    const locationHits = signal.locations.filter((location) => containsPhrase(text, location)).length;
    const codeHits = (signal.isoCodes ?? []).filter((code) => containsIsoCode(text, code)).length;
    const supplementalNameHits = signal.names.filter((name) => containsPhrase(supplemental, name)).length;
    const supplementalLocationHits = signal.locations.filter((location) => containsPhrase(supplemental, location)).length;
    const total = nameHits + locationHits + codeHits;
    const supplementalTotal = supplementalNameHits + supplementalLocationHits;

    if (total === 0 && supplementalTotal === 0) continue;
    if (signal.ambiguous && nameHits === 0 && locationHits === 0 && supplementalNameHits === 0 && supplementalLocationHits === 0) continue;

    detected.push({
      code: signal.code,
      name: getCountryName(signal.code),
      relevanceScore: total > 0
        ? Math.min(1, 0.48 + total * 0.17 + (nameHits > 0 ? 0.08 : 0))
        : Math.min(0.64, 0.4 + supplementalTotal * 0.12),
    });
  }

  return detected.sort((a, b) => b.relevanceScore - a.relevanceScore);
}
