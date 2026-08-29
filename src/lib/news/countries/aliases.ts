import entitySignals from "@/data/country-entity-signals.json";
import {
  countryCodeToAlpha3,
  getCountryNameVariantsByLocale,
  listCountries,
} from "./metadata";

export interface CountrySignals {
  code: string;
  multilingualNames: string[];
  englishNames: string[];
  aliases: string[];
  demonyms: string[];
  locations: string[];
  isoCodes: string[];
  ambiguousAliases: string[];
  contextTerms: string[];
}

interface CuratedCountrySignal {
  code: string;
  aliases?: string[];
  demonyms?: string[];
  cities?: string[];
  ambiguousAliases?: string[];
  contextTerms?: string[];
}

const curatedByCode = new Map(
  (entitySignals as CuratedCountrySignal[]).map((entry) => [entry.code, entry]),
);

/**
 * Every ISO country is eligible for article tagging by its official English
 * name. Frequently covered countries retain richer hand-curated demonyms,
 * cities and safe abbreviations above.
 */
export const COUNTRY_SIGNALS: CountrySignals[] = listCountries().map(({ code, name }) => {
  const variants = getCountryNameVariantsByLocale(code);
  const curated = curatedByCode.get(code);
  const alpha3 = countryCodeToAlpha3(code);
  return {
    code,
    englishNames: [...new Set(variants.filter(({ locale }) => locale === "en").map(({ name: value }) => value).concat(name))],
    multilingualNames: [...new Set(variants.filter(({ locale }) => locale !== "en").map(({ name: value }) => value))],
    aliases: [...new Set(curated?.aliases ?? [])],
    demonyms: [...new Set(curated?.demonyms ?? [])],
    locations: [...new Set(curated?.cities ?? [])],
    isoCodes: [code, ...(alpha3 ? [alpha3] : [])],
    ambiguousAliases: [...new Set(curated?.ambiguousAliases ?? [])],
    contextTerms: [...new Set(curated?.contextTerms ?? [])],
  };
});
