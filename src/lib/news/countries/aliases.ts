import entitySignals from "@/data/country-entity-signals.json";
import geographyData from "@/data/country-geography.json";
import signalOverrides from "@/data/country-signal-overrides.json";
import {
  countryCodeToAlpha3,
  getCountryNameVariantsByLocale,
  listCountries,
} from "./metadata";

export interface CountrySignals {
  code: string;
  multilingualNames: string[];
  nativeNames: string[];
  englishNames: string[];
  aliases: string[];
  demonyms: string[];
  locations: string[];
  institutions: string[];
  languages: string[];
  isoCodes: string[];
  ambiguousAliases: string[];
  contextTerms: string[];
}

interface CuratedCountrySignal {
  code: string;
  aliases?: string[];
  demonyms?: string[];
  cities?: string[];
  institutions?: string[];
  ambiguousAliases?: string[];
  contextTerms?: string[];
}

interface GeographyCountrySignal {
  officialNames: string[];
  nativeNames: string[];
  alternativeNames: string[];
  capitals: string[];
  demonyms: string[];
  languages: string[];
}

const AMBIGUOUS_GLOBAL_LOCATIONS = new Set([
  "adamstown", "bridgetown", "georgetown", "george town", "hamilton", "jamestown",
  "kingston", "monaco", "panama city", "port louis", "roseau", "san jose", "san josé",
  "santiago", "saint george's", "st. george's", "victoria",
]);

function normalizedSignal(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("en");
}

function safeCapital(value: string): boolean {
  return value.trim().length >= 3 && !AMBIGUOUS_GLOBAL_LOCATIONS.has(normalizedSignal(value));
}

const curatedByCode = new Map(
  (entitySignals as CuratedCountrySignal[]).map((entry) => [entry.code, entry]),
);
const overridesByCode = new Map(
  (signalOverrides as CuratedCountrySignal[]).map((entry) => [entry.code, entry]),
);
const geographyByCode = (geographyData as { countries: Record<string, GeographyCountrySignal> }).countries;

const curatedDemonymOwners = new Map<string, Set<string>>();
const geographyDemonymOwners = new Map<string, Set<string>>();

function registerDemonymOwner(index: Map<string, Set<string>>, code: string, value: string): void {
  const key = normalizedSignal(value);
  const owners = index.get(key) ?? new Set<string>();
  owners.add(code);
  index.set(key, owners);
}

for (const [code, entry] of [...curatedByCode, ...overridesByCode]) {
  for (const demonym of entry.demonyms ?? []) registerDemonymOwner(curatedDemonymOwners, code, demonym);
}
for (const [code, entry] of Object.entries(geographyByCode)) {
  for (const demonym of entry.demonyms ?? []) registerDemonymOwner(geographyDemonymOwners, code, demonym);
}

function safeGeneratedDemonym(code: string, value: string): boolean {
  const key = normalizedSignal(value);
  const reviewedOwners = curatedDemonymOwners.get(key);
  if (reviewedOwners?.size) return reviewedOwners.has(code);
  return geographyDemonymOwners.get(key)?.size === 1;
}

/**
 * Every ISO country is eligible for article tagging by its official English
 * name. Frequently covered countries retain richer hand-curated demonyms,
 * cities and safe abbreviations above.
 */
export const COUNTRY_SIGNALS: CountrySignals[] = listCountries().map(({ code, name }) => {
  const variants = getCountryNameVariantsByLocale(code);
  const curated = curatedByCode.get(code);
  const override = overridesByCode.get(code);
  const geography = geographyByCode[code];
  const alpha3 = countryCodeToAlpha3(code);
  return {
    code,
    englishNames: [...new Set([
      ...variants.filter(({ locale }) => locale === "en").map(({ name: value }) => value),
      ...(geography?.officialNames ?? []),
      name,
    ])],
    multilingualNames: [...new Set([
      ...variants.filter(({ locale }) => locale !== "en").map(({ name: value }) => value),
      ...(geography?.nativeNames ?? []),
    ])],
    nativeNames: [...new Set(geography?.nativeNames ?? [])],
    aliases: [...new Set([
      ...(curated?.aliases ?? []),
      ...(override?.aliases ?? []),
      ...(geography?.alternativeNames ?? []),
    ])],
    demonyms: [...new Set([
      ...(geography?.demonyms ?? []).filter((value) => safeGeneratedDemonym(code, value)),
      ...(curated?.demonyms ?? []),
      ...(override?.demonyms ?? []),
    ])],
    locations: [...new Set([
      ...(geography?.capitals ?? []).filter(safeCapital),
      ...(curated?.cities ?? []),
      ...(override?.cities ?? []),
    ])],
    institutions: [...new Set([...(curated?.institutions ?? []), ...(override?.institutions ?? [])])],
    languages: [...new Set(geography?.languages ?? [])],
    isoCodes: [code, ...(alpha3 ? [alpha3] : [])],
    ambiguousAliases: [...new Set([...(curated?.ambiguousAliases ?? []), ...(override?.ambiguousAliases ?? [])])],
    contextTerms: [...new Set([
      ...(curated?.contextTerms ?? []),
      ...(override?.contextTerms ?? []),
      ...(curated?.institutions ?? []),
      ...(override?.institutions ?? []),
    ])],
  };
});
