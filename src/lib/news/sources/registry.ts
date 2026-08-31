import { KNOWN_SOURCE_SEEDS, type SourceSeed } from "@/config/news-sources";
import { normalizeCountryCode } from "../countries/metadata";
import type {
  ProviderName,
  ProviderSourceTarget,
  SourceReference,
  SourceScope,
} from "../types";
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
    id: seed.id,
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
const sourceIdRegistry = new Map<string, SourceSeed>();

for (const source of KNOWN_SOURCE_SEEDS) {
  sourceIdRegistry.set(source.id, source);
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

function slug(value: string): string {
  return normalizeName(value).replace(/\s+/g, "-").slice(0, 64) || "unknown";
}

export function parseDomainlessSourceId(selection: string): {
  id: string;
  name: string;
  countryCode: string | null;
} | null {
  const match = selection.trim().match(/^name:([a-z0-9-]+):([a-z]{2}|global)$/);
  if (!match) return null;
  return {
    id: selection.trim(),
    name: match[1].split("-").filter(Boolean).map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(" "),
    countryCode: match[2] === "global" ? null : normalizeCountryCode(match[2]),
  };
}

export function canonicalSourceId(source: Pick<SourceReference, "name" | "domain" | "countryCode">): string {
  if (source.domain) {
    const known = canonicalDomainRegistry.get(registrableDomain(source.domain));
    return known?.id ?? `domain:${registrableDomain(source.domain)}`;
  }
  const known = sourceNameRegistry.get(normalizeName(source.name));
  return known?.id ?? `name:${slug(source.name)}:${source.countryCode?.toLowerCase() ?? "global"}`;
}

export function sourceSeedForSelection(selection: string): SourceSeed | null {
  const normalized = selection.trim();
  if (!normalized) return null;
  return (
    sourceIdRegistry.get(normalized) ??
    sourceNameRegistry.get(normalizeName(normalized)) ??
    (normalized.startsWith("domain:")
      ? canonicalDomainRegistry.get(registrableDomain(normalized.slice("domain:".length)))
      : undefined) ??
    null
  );
}

export function sourceTargetsFromSelections(selections: string[]): ProviderSourceTarget[] {
  const targets = new Map<string, ProviderSourceTarget>();
  for (const selection of selections) {
    const seed = sourceSeedForSelection(selection);
    if (seed) {
      targets.set(seed.id, {
        id: seed.id,
        name: seed.name,
        domains: [...new Set([seed.domain, ...seed.alternateDomains].map(normalizeHostname))],
        providerIdentifiers: seed.providerIdentifiers,
      });
      continue;
    }
    if (selection.startsWith("domain:")) {
      const domain = registrableDomain(selection.slice("domain:".length));
      if (domain) {
        targets.set(selection, {
          id: selection,
          name: domain,
          domains: [domain],
          providerIdentifiers: {},
        });
      }
      continue;
    }
    const domainless = parseDomainlessSourceId(selection);
    if (domainless) {
      targets.set(domainless.id, {
        id: domainless.id,
        name: domainless.name,
        domains: [],
        providerIdentifiers: {},
      });
    }
  }
  return [...targets.values()];
}

export function sourceReferenceForSelection(selection: string): SourceReference {
  const seed = sourceSeedForSelection(selection);
  if (seed) return seedToReference(seed);
  const domainless = parseDomainlessSourceId(selection);
  if (domainless) {
    return {
      ...domainless,
      domain: null,
      region: null,
      language: null,
      scope: "INTERNATIONAL",
      qualityScore: 0,
    };
  }
  const domain = selection.startsWith("domain:")
    ? registrableDomain(selection.slice("domain:".length))
    : null;
  return {
    id: selection,
    name: domain ?? selection,
    domain,
    countryCode: null,
    region: null,
    language: null,
    scope: "INTERNATIONAL",
    qualityScore: 0,
  };
}

export function sourceMatchesSelection(source: SourceReference, selection: string): boolean {
  const normalized = selection.trim();
  if (!normalized) return false;
  if (source.id === normalized || normalizeName(source.name) === normalizeName(normalized)) return true;
  if (normalized.startsWith("domain:")) {
    return source.domain === registrableDomain(normalized.slice("domain:".length));
  }
  const seed = sourceSeedForSelection(normalized);
  return seed ? source.id === seed.id : false;
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
        id: canonicalSourceId({
          name: input.sourceName.trim() || domain || "Unknown source",
          domain,
          countryCode: metadataCountry,
        }),
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
          id: canonicalSourceId({
            name: input.sourceName.trim() || domain || hostname,
            domain,
            countryCode: countrySignal.countryCode,
          }),
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
      id: canonicalSourceId({
        name: input.sourceName.trim() || domain || "Unknown source",
        domain,
        countryCode: null,
      }),
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
