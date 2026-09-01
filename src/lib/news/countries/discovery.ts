import { KNOWN_SOURCE_SEEDS } from "@/config/news-sources";
import { COUNTRY_SIGNALS } from "./aliases";
import { getCountryName, getCountryNameVariantsByLocale, normalizeCountryCode } from "./metadata";
import type { ProviderSourceTarget } from "../types";

export interface ProviderLocale {
  market: string;
  language: string;
  role: "international" | "local";
  fallback: boolean;
}

export interface CountryDiscoveryProfile {
  countryCode: string;
  primaryNames: string[];
  localNames: string[];
  demonyms: string[];
  highConfidenceLocations: string[];
  highConfidenceInstitutions: string[];
  discoveryLocales: ProviderLocale[];
  gdeltLanguages: string[];
  localPublisherDomains: string[];
}

interface MarketLane {
  market: string;
  language: string;
}

/**
 * Reviewed Bing News Search markets from Microsoft's published market-code
 * table. Countries absent from this map use the documented en-US fallback.
 */
export const BING_NEWS_MARKETS_BY_COUNTRY: Readonly<Record<string, readonly MarketLane[]>> = {
  AU: [{ market: "en-AU", language: "en" }],
  AT: [{ market: "de-AT", language: "de" }],
  BE: [{ market: "nl-BE", language: "nl" }, { market: "fr-BE", language: "fr" }],
  BR: [{ market: "pt-BR", language: "pt" }],
  CA: [{ market: "en-CA", language: "en" }, { market: "fr-CA", language: "fr" }],
  CL: [{ market: "es-CL", language: "es" }],
  DK: [{ market: "da-DK", language: "da" }],
  FI: [{ market: "fi-FI", language: "fi" }],
  FR: [{ market: "fr-FR", language: "fr" }],
  DE: [{ market: "de-DE", language: "de" }],
  HK: [{ market: "zh-HK", language: "zh" }],
  IN: [{ market: "en-IN", language: "en" }],
  ID: [{ market: "en-ID", language: "en" }],
  IT: [{ market: "it-IT", language: "it" }],
  JP: [{ market: "ja-JP", language: "ja" }],
  KR: [{ market: "ko-KR", language: "ko" }],
  MY: [{ market: "en-MY", language: "en" }],
  MX: [{ market: "es-MX", language: "es" }],
  NL: [{ market: "nl-NL", language: "nl" }],
  NZ: [{ market: "en-NZ", language: "en" }],
  NO: [{ market: "no-NO", language: "no" }],
  CN: [{ market: "zh-CN", language: "zh" }],
  PL: [{ market: "pl-PL", language: "pl" }],
  PH: [{ market: "en-PH", language: "en" }],
  RU: [{ market: "ru-RU", language: "ru" }],
  ZA: [{ market: "en-ZA", language: "en" }],
  ES: [{ market: "es-ES", language: "es" }],
  SE: [{ market: "sv-SE", language: "sv" }],
  CH: [{ market: "de-CH", language: "de" }, { market: "fr-CH", language: "fr" }],
  TW: [{ market: "zh-TW", language: "zh" }],
  TR: [{ market: "tr-TR", language: "tr" }],
  GB: [{ market: "en-GB", language: "en" }],
  US: [{ market: "en-US", language: "en" }, { market: "es-US", language: "es" }],
};

const FALLBACK_MARKET: MarketLane = { market: "en-US", language: "en" };
const COUNTRY_NAME_LOCALE_BY_LANGUAGE: Readonly<Record<string, string>> = {
  arabic: "ar", chinese: "zh", dutch: "nl", english: "en", french: "fr",
  german: "de", italian: "it", japanese: "ja", korean: "ko", portuguese: "pt",
  russian: "ru", spanish: "es",
};

const GDELT_LANGUAGE_BY_NAME: Readonly<Record<string, string>> = {
  afrikaans: "afrikaans", albanian: "albanian", arabic: "arabic", armenian: "armenian",
  azerbaijani: "azerbaijani", bengali: "bengali", bosnian: "bosnian", bulgarian: "bulgarian",
  catalan: "catalan", chinese: "chinese", croatian: "croatian", czech: "czech",
  danish: "danish", dutch: "dutch", english: "english", estonian: "estonian",
  finnish: "finnish", french: "french", galician: "galician", georgian: "georgian",
  german: "german", greek: "greek", gujarati: "gujarati", hebrew: "hebrew",
  hindi: "hindi", hungarian: "hungarian", icelandic: "icelandic", indonesian: "indonesian",
  italian: "italian", japanese: "japanese", kannada: "kannada", kazakh: "kazakh",
  korean: "korean", latvian: "latvian", lithuanian: "lithuanian", macedonian: "macedonian",
  malay: "malay", malayalam: "malayalam", marathi: "marathi", mongolian: "mongolian",
  nepali: "nepali", norwegian: "norwegian", persian: "persian", polish: "polish",
  portuguese: "portuguese", punjabi: "punjabi", romanian: "romanian", russian: "russian",
  serbian: "serbian", sinhalese: "sinhalese", slovak: "slovak", slovenian: "slovenian",
  somali: "somali", spanish: "spanish", swahili: "swahili", swedish: "swedish",
  tamil: "tamil", telugu: "telugu", thai: "thai", turkish: "turkish",
  ukrainian: "ukrainian", vietnamese: "vietnamese",
};

const GDELT_LANGUAGE_BY_LOCALE: Readonly<Record<string, string>> = {
  ar: "arabic", da: "danish", de: "german", en: "english", es: "spanish", fi: "finnish",
  fr: "french", hi: "hindi", id: "indonesian", it: "italian", ja: "japanese",
  ko: "korean", ms: "malay", nl: "dutch", no: "norwegian", pl: "polish",
  pt: "portuguese", ru: "russian", sv: "swedish", tr: "turkish", uk: "ukrainian",
  vi: "vietnamese", zh: "chinese",
};

function unique(values: string[], limit = Number.POSITIVE_INFINITY): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.replace(/["\\]/g, " ").replace(/\s+/gu, " ").trim();
    const key = normalized.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en");
    if (normalized.length < 2 || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function sourceTargets(countryCode: string): ProviderSourceTarget[] {
  return KNOWN_SOURCE_SEEDS
    .filter((source) => source.countryCode === countryCode)
    .map((source) => ({
      id: source.id,
      name: source.name,
      domains: unique([source.domain, ...source.alternateDomains], 4),
      providerIdentifiers: source.providerIdentifiers,
    }));
}

export function localPublisherTargetsForCountries(countryCodes: string[]): ProviderSourceTarget[] {
  const targets = new Map<string, ProviderSourceTarget>();
  for (const code of countryCodes) {
    for (const target of sourceTargets(code)) targets.set(target.id, target);
  }
  return [...targets.values()];
}

export function buildCountryDiscoveryProfile(rawCode: string): CountryDiscoveryProfile {
  const countryCode = normalizeCountryCode(rawCode);
  if (!countryCode) throw new Error(`Invalid country code for discovery: ${rawCode}`);
  const signal = COUNTRY_SIGNALS.find(({ code }) => code === countryCode);
  if (!signal) throw new Error(`Country discovery metadata is missing for ${countryCode}`);

  const primaryName = getCountryName(countryCode);
  const primaryNames = unique([
    primaryName,
    ...signal.englishNames,
    ...signal.aliases.filter((alias) => /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u.test(alias)),
  ], 4);
  const localLocales = unique(signal.languages.map((language) =>
    COUNTRY_NAME_LOCALE_BY_LANGUAGE[language.toLocaleLowerCase("en")] ?? ""
  ), 2);
  const localizedVariants = getCountryNameVariantsByLocale(countryCode)
    .filter(({ locale }) => localLocales.includes(locale) && locale !== "en")
    .map(({ name }) => name);
  const localNames = unique([
    ...localizedVariants,
    ...signal.nativeNames,
    ...signal.aliases.filter((alias) => !primaryNames.includes(alias)),
  ], 4);

  const configuredMarkets = BING_NEWS_MARKETS_BY_COUNTRY[countryCode];
  const localMarkets = configuredMarkets?.slice(0, 2) ?? [];
  const hasEnglishMarket = localMarkets.some(({ language }) => language === "en");
  const discoveryLocales: ProviderLocale[] = uniqueLocaleLanes([
    ...(!hasEnglishMarket ? [{ ...FALLBACK_MARKET, role: "international" as const, fallback: !configuredMarkets }] : []),
    ...localMarkets.map((locale) => ({ ...locale, role: "local" as const, fallback: false })),
    ...(localMarkets.length === 0 ? [{ ...FALLBACK_MARKET, role: "international" as const, fallback: true }] : []),
  ]).slice(0, 3);

  const localGdeltLanguages = unique([
    ...signal.languages.map((language) => GDELT_LANGUAGE_BY_NAME[language.toLocaleLowerCase("en")] ?? ""),
    ...localLocales.map((locale) => GDELT_LANGUAGE_BY_LOCALE[locale] ?? ""),
  ], 2);
  const targets = sourceTargets(countryCode);
  return {
    countryCode,
    primaryNames,
    localNames,
    demonyms: unique(signal.demonyms, 4),
    highConfidenceLocations: unique(signal.locations, 10),
    highConfidenceInstitutions: unique(signal.institutions, 5),
    discoveryLocales,
    gdeltLanguages: unique(["english", ...localGdeltLanguages], 3),
    localPublisherDomains: unique(targets.flatMap(({ domains }) => domains), 8),
  };
}

function uniqueLocaleLanes(locales: ProviderLocale[]): ProviderLocale[] {
  const uniqueLocales = new Map<string, ProviderLocale>();
  for (const locale of locales) uniqueLocales.set(`${locale.market}|${locale.language}`, locale);
  return [...uniqueLocales.values()];
}

function quotedGroup(terms: string[]): string {
  const values = unique(terms, 4).map((term) => `"${term}"`);
  return values.length === 1 ? values[0] : `(${values.join(" OR ")})`;
}

export type CountryDiscoveryLane = "canonical" | "local" | "demonym" | "location" | "institution";

export function buildCountryDiscoveryQuery(
  countryCodes: string[],
  lane: CountryDiscoveryLane = "canonical",
): string | undefined {
  if (countryCodes.length === 0) return undefined;
  const profiles = countryCodes.map(buildCountryDiscoveryProfile);
  const groups = profiles.map((profile) => {
    const terms = lane === "local"
      ? profile.localNames
      : lane === "demonym"
        ? profile.demonyms
        : lane === "location"
          ? profile.highConfidenceLocations
          : lane === "institution"
            ? profile.highConfidenceInstitutions
            : [...profile.primaryNames.slice(0, 2), ...profile.localNames.slice(0, 2)];
    return terms.length > 0 ? quotedGroup(terms) : quotedGroup(profile.primaryNames);
  });
  return groups.join(" AND ");
}

export function discoveryProfilesForCountries(countryCodes: string[]): CountryDiscoveryProfile[] {
  return countryCodes.map(buildCountryDiscoveryProfile);
}
