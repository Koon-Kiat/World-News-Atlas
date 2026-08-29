import { KNOWN_SOURCE_SEEDS, type SourceSeed } from "@/config/news-sources";
import { normalizeCountryCode } from "../countries/metadata";
import type { ProviderName, SourceReference, SourceScope } from "../types";
import {
  domainCountrySignal,
  hostnameFromUrl,
  normalizeHostname,
  registrableDomain,
} from "./domain";

function normalizeName(value: string): string {
  return value.toLocaleLowerCase("en").normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function seedToReference(seed: SourceSeed): SourceReference {
  return {
    name: seed.name,
    domain: registrableDomain(seed.domain),
    countryCode: seed.countryCode,
    region: seed.region,
    language: seed.language,
    scope: seed.scope,
    qualityScore: seed.qualityScore,
  };
}

const exactHostRegistry = new Map<string, SourceSeed>();
const canonicalDomainRegistry = new Map<string, SourceSeed>();
const sourceNameRegistry = new Map<string, SourceSeed>();
const providerIdentifierRegistry = new Map<string, SourceSeed>();

for (const source of KNOWN_SOURCE_SEEDS) {
  sourceNameRegistry.set(normalizeName(source.name), source);
  for (const domain of [source.domain, ...source.alternateDomains]) {
    exactHostRegistry.set(normalizeHostname(domain), source);
    canonicalDomainRegistry.set(registrableDomain(domain), source);
  }
  for (const [provider, identifiers] of Object.entries(source.providerIdentifiers)) {
    for (const identifier of identifiers ?? []) {
      providerIdentifierRegistry.set(`${provider}:${identifier.toLocaleLowerCase("en")}`, source);
    }
  }
}

export type SourceResolutionMethod =
  | "registry"
  | "provider"
  | "rss-config"
  | "domain"
  | "cctld"
  | "unknown";

export interface SourceResolution {
  method: SourceResolutionMethod;
  confidence: number;
}

export interface ResolvedSource {
  source: SourceReference;
  resolution: SourceResolution;
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
  metadataOrigin?: "provider" | "rss-config";
}

export function domainFromUrl(value: string): string | null {
  const hostname = hostnameFromUrl(value);
  return hostname ? registrableDomain(hostname) : null;
}

function knownResolution(seed: SourceSeed, method: SourceResolutionMethod, confidence: number): ResolvedSource {
  return {
    source: seedToReference(seed),
    resolution: { method, confidence },
  };
}

export function resolveSourceDetailed(input: ResolveSourceInput): ResolvedSource {
  const hostname = hostnameFromUrl(input.articleUrl);
  const domain = hostname ? registrableDomain(hostname) : null;
  const exactRegistry =
    (hostname ? exactHostRegistry.get(hostname) : undefined) ??
    sourceNameRegistry.get(normalizeName(input.sourceName));
  if (exactRegistry) return knownResolution(exactRegistry, "registry", 1);

  const sourceIdentifier = input.sourceIdentifier?.trim().toLocaleLowerCase("en");
  if (sourceIdentifier) {
    const providerMatch = providerIdentifierRegistry.get(`${input.provider}:${sourceIdentifier}`);
    if (providerMatch) return knownResolution(providerMatch, "provider", 0.98);
  }

  if (domain) {
    const domainMatch = canonicalDomainRegistry.get(domain);
    if (domainMatch) return knownResolution(domainMatch, "domain", 0.96);
  }

  const metadataCountry = normalizeCountryCode(input.sourceCountry ?? "");
  if (metadataCountry) {
    const method = input.metadataOrigin === "rss-config" ? "rss-config" : "provider";
    return {
      source: {
        name: input.sourceName.trim() || domain || "Unknown source",
        domain,
        countryCode: metadataCountry,
        region: input.sourceRegion ?? null,
        language: input.language ?? null,
        scope: input.sourceScope ?? "INTERNATIONAL",
        qualityScore: method === "rss-config" ? 0.78 : 0.72,
      },
      resolution: { method, confidence: method === "rss-config" ? 0.9 : 0.82 },
    };
  }

  if (hostname) {
    const countrySignal = domainCountrySignal(hostname);
    if (countrySignal) {
      return {
        source: {
          name: input.sourceName.trim() || domain || hostname,
          domain,
          countryCode: countrySignal.countryCode,
          region: input.sourceRegion ?? null,
          language: input.language ?? null,
          scope: input.sourceScope ?? "INTERNATIONAL",
          qualityScore: 0.62,
        },
        resolution: { method: "cctld", confidence: countrySignal.confidence },
      };
    }
  }

  return {
    source: {
      name: input.sourceName.trim() || domain || "Unknown source",
      domain,
      countryCode: null,
      region: input.sourceRegion ?? null,
      language: input.language ?? null,
      scope: input.sourceScope ?? "INTERNATIONAL",
      qualityScore: 0.6,
    },
    resolution: { method: "unknown", confidence: 0 },
  };
}

export function resolveSource(input: ResolveSourceInput): SourceReference {
  return resolveSourceDetailed(input).source;
}
