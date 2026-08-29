import countryCodes from "i18n-iso-countries/codes.json";
import arLocale from "i18n-iso-countries/langs/ar.json";
import deLocale from "i18n-iso-countries/langs/de.json";
import enLocale from "i18n-iso-countries/langs/en.json";
import esLocale from "i18n-iso-countries/langs/es.json";
import frLocale from "i18n-iso-countries/langs/fr.json";
import itLocale from "i18n-iso-countries/langs/it.json";
import jaLocale from "i18n-iso-countries/langs/ja.json";
import koLocale from "i18n-iso-countries/langs/ko.json";
import nlLocale from "i18n-iso-countries/langs/nl.json";
import ptLocale from "i18n-iso-countries/langs/pt.json";
import ruLocale from "i18n-iso-countries/langs/ru.json";
import zhLocale from "i18n-iso-countries/langs/zh.json";

type CountryCodeRow = [alpha2: string, alpha3: string, numeric: string, subdivision: string];
type CountryName = string | string[];
type CountryLocale = { locale: string; countries: Record<string, CountryName> };

const codeRows = countryCodes as CountryCodeRow[];
const countryNames = enLocale.countries as Record<string, CountryName>;
const countryLocales: CountryLocale[] = [
  enLocale,
  jaLocale,
  zhLocale,
  koLocale,
  deLocale,
  frLocale,
  esLocale,
  ptLocale,
  itLocale,
  nlLocale,
  arLocale,
  ruLocale,
] as CountryLocale[];
const validCodes = new Set(codeRows.map(([alpha2]) => alpha2));
const numericCodes = new Map(codeRows.map(([alpha2, , numeric]) => [numeric, alpha2]));
const alpha3Codes = new Map(codeRows.map(([alpha2, alpha3]) => [alpha2, alpha3]));

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("en");
}

const namesToCodes = new Map<string, string>();
countryLocales.forEach((locale) => {
  Object.entries(locale.countries).forEach(([code, names]) => {
    const variants = Array.isArray(names) ? names : [names];
    variants.forEach((name) => {
      const normalized = normalizeName(name);
      if (!namesToCodes.has(normalized)) namesToCodes.set(normalized, code);
    });
  });
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

export function getCountryFlag(code: string): string {
  const normalized = normalizeCountryCode(code);
  if (!normalized) return "🌐";
  return String.fromCodePoint(
    ...normalized.split("").map((character) => 127397 + character.charCodeAt(0)),
  );
}

export function getCountryNameVariants(code: string): string[] {
  return [...new Set(getCountryNameVariantsByLocale(code).map(({ name }) => name))];
}

export function getCountryNameVariantsByLocale(code: string): Array<{ locale: string; name: string }> {
  const normalized = code.toUpperCase();
  return countryLocales.flatMap((locale) => {
    const names = locale.countries[normalized];
    if (!names) return [];
    return (Array.isArray(names) ? names : [names]).map((name) => ({
      locale: locale.locale,
      name,
    }));
  });
}

export function countryCodeToAlpha3(code: string): string | null {
  return alpha3Codes.get(code.toUpperCase()) ?? null;
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
