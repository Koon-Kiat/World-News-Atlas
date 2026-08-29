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
}

const UNSAFE_ALPHA2_CODES = new Set([
  "AD", "AM", "AS", "AT", "BE", "BY", "DO", "IN", "IS", "IT", "ME", "MY", "NO", "OR", "SO", "TO",
]);
const UNSAFE_ALPHA3_CODES = new Set(["ARE", "CAN"]);
const COMPACT_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

function prepareText(text: string): PreparedText {
  const normalized = normalizeText(text);
  return { normalized, lower: normalized.toLocaleLowerCase() };
}

function containsPhrase(text: PreparedText, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase).trim();
  if (normalizedPhrase.length < 2) return false;
  if (COMPACT_SCRIPT.test(normalizedPhrase)) {
    return text.lower.includes(normalizedPhrase.toLocaleLowerCase());
  }
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedPhrase)}([^\\p{L}\\p{N}]|$)`,
    "iu",
  ).test(text.normalized);
}

function containsIsoCode(text: string, code: string): boolean {
  if (code.length === 2 && UNSAFE_ALPHA2_CODES.has(code)) return false;
  if (code.length === 3 && UNSAFE_ALPHA3_CODES.has(code)) return false;
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(code)}(?!\\$)([^\\p{L}\\p{N}]|$)`,
    "u",
  ).test(text.normalize("NFKC"));
}

function countMatches(text: PreparedText, phrases: string[]): number {
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

function hasAmbiguousContext(signal: CountrySignals, text: PreparedText, hasCorroboration: boolean): boolean {
  return hasCorroboration || signal.contextTerms.some((term) => containsPhrase(text, term));
}

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

  for (const signal of COUNTRY_SIGNALS) {
    const names = safeNames(signal);
    const englishNames = signal.englishNames.filter((value) => !codeLikeAliases(signal).includes(value));
    const multilingualHits = countMatches(preparedPrimary, names);
    const demonymHits = countMatches(preparedPrimary, signal.demonyms);
    const cityHits = countMatches(preparedPrimary, signal.locations);
    const englishHits = countMatches(preparedPrimary, englishNames);
    const isoHits = [...signal.isoCodes, ...codeLikeAliases(signal)].filter((code) => containsIsoCode(primaryText, code)).length;
    const structuredHits = countMatches(
      preparedStructured,
      [...names, ...englishNames, ...signal.demonyms, ...signal.locations],
    );
    const urlHits = countMatches(
      preparedSupplemental,
      [...names, ...englishNames, ...signal.locations],
    );
    const corroborated = multilingualHits + demonymHits + cityHits + structuredHits > 0;
    const ambiguousHits = countMatches(preparedPrimary, signal.ambiguousAliases);

    if (structuredHits > 0) register(signal.code, 0.96, "structured_location");
    if (multilingualHits > 0) register(signal.code, 0.91, "multilingual_name");
    if (demonymHits > 0) register(signal.code, 0.84, "demonym");
    if (cityHits > 0) register(signal.code, 0.79, "city");
    if (isoHits > 0) register(signal.code, 0.69, "iso_code");
    if (urlHits > 0) register(signal.code, 0.52, "url_hint");
    if (englishHits > 0) {
      const isOnlyAmbiguous = signal.ambiguousAliases.some((alias) => containsPhrase(preparedPrimary, alias)) && !corroborated;
      if (!isOnlyAmbiguous) register(signal.code, 0.89, "english_fallback");
    }
    if (ambiguousHits > 0 && hasAmbiguousContext(signal, preparedPrimary, corroborated)) {
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
