import { COUNTRY_SIGNALS, type CountrySignals } from "./aliases";
import { getCountryName, normalizeCountryCode } from "./metadata";
import type { CountryReference } from "../types";

export type CountryDetectionMethod =
  | "provider_coverage"
  | "structured_country"
  | "structured_location"
  | "multilingual_name"
  | "demonym"
  | "city"
  | "iso_code"
  | "url_hint"
  | "english_fallback";

export interface CountryDetectionOptions {
  title: string;
  description?: string | null;
  supplementalText?: string | null;
  coverageCountries?: string[];
  structuredCountryCodes?: string[];
  structuredLocations?: string[];
}

export interface CountryDetectionDetail extends CountryReference {
  methods: CountryDetectionMethod[];
}

interface DetectedSignal {
  score: number;
  methods: Set<CountryDetectionMethod>;
}

interface PreparedText {
  normalized: string;
  lower: string;
  nfkc: string;
}

interface PreparedPhrase {
  compact: boolean;
  lower: string;
}

interface PreparedCountrySignal {
  signal: CountrySignals;
  names: PreparedPhrase[];
  englishNames: PreparedPhrase[];
  demonyms: PreparedPhrase[];
  locations: PreparedPhrase[];
  ambiguousAliases: PreparedPhrase[];
  contextTerms: PreparedPhrase[];
  structuredPhrases: PreparedPhrase[];
  urlPhrases: PreparedPhrase[];
  isoCodes: string[];
}

const UNSAFE_ALPHA2_CODES = new Set([
  "AD", "AM", "AS", "AT", "BE", "BY", "DO", "IN", "IS", "IT", "ME", "MY", "NO", "OR", "SO", "TO",
]);
const UNSAFE_ALPHA3_CODES = new Set(["ARE", "CAN"]);
const COMPACT_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

function normalizeText(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

function prepareText(text: string): PreparedText {
  const normalized = normalizeText(text);
  return {
    normalized,
    lower: normalized.toLocaleLowerCase(),
    nfkc: text.normalize("NFKC"),
  };
}

function preparePhrase(phrase: string): PreparedPhrase | null {
  const normalizedPhrase = normalizeText(phrase).trim();
  if (normalizedPhrase.length < 2) return null;
  return {
    compact: COMPACT_SCRIPT.test(normalizedPhrase),
    lower: normalizedPhrase.toLocaleLowerCase(),
  };
}

function preparePhrases(phrases: string[]): PreparedPhrase[] {
  const prepared = new Map<string, PreparedPhrase>();
  for (const phrase of phrases) {
    const value = preparePhrase(phrase);
    if (value) prepared.set(`${value.compact}:${value.lower}`, value);
  }
  return [...prepared.values()];
}

function codePointBefore(value: string, index: number): string {
  if (index <= 0) return "";
  let start = index - 1;
  const unit = value.charCodeAt(start);
  if (unit >= 0xdc00 && unit <= 0xdfff && start > 0) start -= 1;
  const point = value.codePointAt(start);
  return point === undefined ? "" : String.fromCodePoint(point);
}

function codePointAt(value: string, index: number): string {
  if (index >= value.length) return "";
  const point = value.codePointAt(index);
  return point === undefined ? "" : String.fromCodePoint(point);
}

function containsBounded(text: string, phrase: string, rejectDollarSuffix = false): boolean {
  let offset = 0;
  while (offset <= text.length - phrase.length) {
    const index = text.indexOf(phrase, offset);
    if (index < 0) return false;
    const before = codePointBefore(text, index);
    const after = codePointAt(text, index + phrase.length);
    if (
      (!before || !LETTER_OR_NUMBER.test(before)) &&
      (!after || !LETTER_OR_NUMBER.test(after)) &&
      (!rejectDollarSuffix || after !== "$")
    ) return true;
    offset = index + Math.max(1, phrase.length);
  }
  return false;
}

function containsPhrase(text: PreparedText, phrase: PreparedPhrase): boolean {
  return phrase.compact
    ? text.lower.includes(phrase.lower)
    : containsBounded(text.lower, phrase.lower);
}

function countMatches(text: PreparedText, phrases: PreparedPhrase[]): number {
  return phrases.filter((phrase) => containsPhrase(text, phrase)).length;
}

function codeLikeAliases(signal: CountrySignals): string[] {
  return [...signal.englishNames, ...signal.multilingualNames, ...signal.aliases].filter((value) =>
    /^[A-Z](?:[A-Z.]|&){1,4}$/.test(value),
  );
}

function safeNames(signal: CountrySignals): string[] {
  const ambiguous = new Set(signal.ambiguousAliases.map((value) => normalizeText(value).toLocaleLowerCase()));
  const codeLike = new Set(codeLikeAliases(signal));
  return [...signal.multilingualNames, ...signal.aliases].filter(
    (value) => !ambiguous.has(normalizeText(value).toLocaleLowerCase()) && !codeLike.has(value),
  );
}

function prepareIsoCodes(codes: string[]): string[] {
  return [...new Set(codes)].filter((code) => {
    if (code.length === 2 && UNSAFE_ALPHA2_CODES.has(code)) return false;
    if (code.length === 3 && UNSAFE_ALPHA3_CODES.has(code)) return false;
    return true;
  });
}

const PREPARED_COUNTRY_SIGNALS: PreparedCountrySignal[] = COUNTRY_SIGNALS.map((signal) => {
  const aliases = codeLikeAliases(signal);
  const names = safeNames(signal);
  const englishNames = signal.englishNames.filter((value) => !aliases.includes(value));
  return {
    signal,
    names: preparePhrases(names),
    englishNames: preparePhrases(englishNames),
    demonyms: preparePhrases(signal.demonyms),
    locations: preparePhrases(signal.locations),
    ambiguousAliases: preparePhrases(signal.ambiguousAliases),
    contextTerms: preparePhrases(signal.contextTerms),
    structuredPhrases: preparePhrases([
      ...names,
      ...englishNames,
      ...signal.demonyms,
      ...signal.locations,
    ]),
    urlPhrases: preparePhrases([...names, ...englishNames, ...signal.locations]),
    isoCodes: prepareIsoCodes([...signal.isoCodes, ...aliases]),
  };
});

export function detectCountrySignals(options: CountryDetectionOptions): CountryDetectionDetail[] {
  const primaryText = `${options.title}\n${options.description ?? ""}`;
  const supplementalText = options.supplementalText ?? "";
  const structuredText = (options.structuredLocations ?? []).join("\n");
  const preparedPrimary = prepareText(primaryText);
  const preparedSupplemental = prepareText(supplementalText);
  const preparedStructured = prepareText(structuredText);
  const detected = new Map<string, DetectedSignal>();

  const register = (rawCode: string, score: number, method: CountryDetectionMethod): void => {
    const code = normalizeCountryCode(rawCode);
    if (!code) return;
    const current = detected.get(code) ?? { score: 0, methods: new Set<CountryDetectionMethod>() };
    current.methods.add(method);
    current.score = Math.min(1, Math.max(current.score, score) + Math.min(0.06, (current.methods.size - 1) * 0.02));
    detected.set(code, current);
  };

  for (const code of options.coverageCountries ?? []) register(code, 1, "provider_coverage");
  for (const code of options.structuredCountryCodes ?? []) register(code, 0.98, "structured_country");

  for (const prepared of PREPARED_COUNTRY_SIGNALS) {
    const { signal } = prepared;
    const multilingualHits = countMatches(preparedPrimary, prepared.names);
    const demonymHits = countMatches(preparedPrimary, prepared.demonyms);
    const cityHits = countMatches(preparedPrimary, prepared.locations);
    const englishHits = countMatches(preparedPrimary, prepared.englishNames);
    const isoHits = prepared.isoCodes.filter((code) =>
      containsBounded(preparedPrimary.nfkc, code, true)
    ).length;
    const structuredHits = countMatches(preparedStructured, prepared.structuredPhrases);
    const urlHits = countMatches(preparedSupplemental, prepared.urlPhrases);
    const corroborated = multilingualHits + demonymHits + cityHits + structuredHits > 0;
    const ambiguousHits = countMatches(preparedPrimary, prepared.ambiguousAliases);

    if (structuredHits > 0) register(signal.code, 0.96, "structured_location");
    if (multilingualHits > 0) register(signal.code, 0.91, "multilingual_name");
    if (demonymHits > 0) register(signal.code, 0.84, "demonym");
    if (cityHits > 0) register(signal.code, 0.79, "city");
    if (isoHits > 0) register(signal.code, 0.69, "iso_code");
    if (urlHits > 0) register(signal.code, 0.52, "url_hint");
    if (englishHits > 0) {
      const isOnlyAmbiguous = prepared.ambiguousAliases.some((alias) =>
        containsPhrase(preparedPrimary, alias)
      ) && !corroborated;
      if (!isOnlyAmbiguous) register(signal.code, 0.89, "english_fallback");
    }
    if (
      ambiguousHits > 0 &&
      (corroborated || prepared.contextTerms.some((term) => containsPhrase(preparedPrimary, term)))
    ) {
      register(signal.code, corroborated ? 0.82 : 0.64, "multilingual_name");
    }
  }

  return [...detected.entries()]
    .map(([code, signal]) => ({
      code,
      name: getCountryName(code),
      relevanceScore: Number(signal.score.toFixed(3)),
      methods: [...signal.methods],
    }))
    .sort((first, second) => second.relevanceScore - first.relevanceScore || first.code.localeCompare(second.code));
}

export function detectCountries(
  title: string,
  description: string | null | undefined = null,
  supplementalText: string | null | undefined = null,
): CountryReference[] {
  return detectCountrySignals({ title, description, supplementalText }).map(
    ({ code, name, relevanceScore }) => ({ code, name, relevanceScore }),
  );
}
