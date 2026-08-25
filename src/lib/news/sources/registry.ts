import { KNOWN_SOURCE_SEEDS, type SourceSeed } from "@/config/news-sources";
import type { ProviderName, SourceReference, SourceScope } from "../types";

function normalizeDomain(value: string): string {
  return value.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function domainFromUrl(value: string): string | null {
  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return null;
  }
}

function seedToReference(seed: SourceSeed): SourceReference {
  return {
    name: seed.name,
    domain: seed.domain,
    countryCode: seed.countryCode,
    region: seed.region,
    language: seed.language,
    scope: seed.scope,
    qualityScore: seed.qualityScore,
  };
}

export interface ResolveSourceInput {
  provider: ProviderName;
  sourceName: string;
  sourceIdentifier?: string | null;
  articleUrl: string;
  sourceCountry?: string | null;
  sourceScope?: SourceScope | null;
  sourceRegion?: string | null;
  language?: string | null;
}

export function resolveSource(input: ResolveSourceInput): SourceReference {
  const domain = domainFromUrl(input.articleUrl);
  const sourceIdentifier = input.sourceIdentifier?.toLowerCase();
  const known = KNOWN_SOURCE_SEEDS.find((source) => {
    const identifiers = source.providerIdentifiers[input.provider] ?? [];
    return (
      (domain !== null && normalizeDomain(source.domain) === domain) ||
      (sourceIdentifier !== undefined &&
        identifiers.some((identifier) => identifier.toLowerCase() === sourceIdentifier)) ||
      normalizeName(source.name) === normalizeName(input.sourceName)
    );
  });

  if (known) return seedToReference(known);

  return {
    name: input.sourceName.trim() || domain || "Unknown source",
    domain,
    countryCode: input.sourceCountry?.toUpperCase() ?? null,
    region: input.sourceRegion ?? null,
    language: input.language ?? null,
    scope: input.sourceScope ?? "INTERNATIONAL",
    qualityScore: 0.65,
  };
}
