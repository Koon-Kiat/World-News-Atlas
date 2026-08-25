import isoCountries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";

isoCountries.registerLocale(enLocale);

export function normalizeCountryCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && isoCountries.isValid(code) ? code : null;
}

export function getCountryName(code: string): string {
  return isoCountries.getName(code.toUpperCase(), "en") ?? code.toUpperCase();
}

export function numericCountryIdToCode(id: string | number): string | null {
  const numeric = String(id).padStart(3, "0");
  const code = isoCountries.numericToAlpha2(numeric);
  return code && isoCountries.isValid(code) ? code : null;
}

export function countryNameToCode(name: string | null | undefined): string | null {
  if (!name) return null;
  const direct = normalizeCountryCode(name);
  if (direct) return direct;
  const code = isoCountries.getAlpha2Code(name.trim(), "en");
  return code && isoCountries.isValid(code) ? code : null;
}
