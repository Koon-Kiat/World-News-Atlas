import countryCodes from "i18n-iso-countries/codes.json";
import enLocale from "i18n-iso-countries/langs/en.json";

type CountryCodeRow = [alpha2: string, alpha3: string, numeric: string, subdivision: string];
type CountryName = string | string[];

const codeRows = countryCodes as CountryCodeRow[];
const countryNames = enLocale.countries as Record<string, CountryName>;
const validCodes = new Set(codeRows.map(([alpha2]) => alpha2));
const numericCodes = new Map(codeRows.map(([alpha2, , numeric]) => [numeric, alpha2]));

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("en");
}

const namesToCodes = new Map<string, string>();
Object.entries(countryNames).forEach(([code, names]) => {
  const variants = Array.isArray(names) ? names : [names];
  variants.forEach((name) => namesToCodes.set(normalizeName(name), code));
});

export function normalizeCountryCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && validCodes.has(code) ? code : null;
}

export function getCountryName(code: string): string {
  const normalized = code.toUpperCase();
  const names = countryNames[normalized];
  return (Array.isArray(names) ? names[0] : names) ?? normalized;
}

export function getCountryNameVariants(code: string): string[] {
  const names = countryNames[code.toUpperCase()];
  if (!names) return [];
  return Array.isArray(names) ? names : [names];
}

export function listCountries(): Array<{ code: string; name: string }> {
  return codeRows
    .map(([code]) => ({ code, name: getCountryName(code) }))
    .sort((first, second) => first.name.localeCompare(second.name, "en"));
}

export function numericCountryIdToCode(id: string | number): string | null {
  const numeric = String(id).padStart(3, "0");
  return numericCodes.get(numeric) ?? null;
}

export function countryNameToCode(name: string | null | undefined): string | null {
  if (!name) return null;
  const direct = normalizeCountryCode(name);
  if (direct) return direct;
  return namesToCodes.get(normalizeName(name)) ?? null;
}
