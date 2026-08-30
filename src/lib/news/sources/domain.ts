import domainCountrySignals from "@/data/domain-country-signals.json";
import { getDomain } from "tldts";
const DOMAIN_COUNTRY_SIGNALS = [...(domainCountrySignals as DomainCountrySignal[])]
  .sort((first, second) => second.suffix.length - first.suffix.length);

export interface DomainCountrySignal {
  countryCode: string;
  confidence: number;
  suffix: string;
}

export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

export function hostnameFromUrl(value: string): string | null {
  try {
    return normalizeHostname(new URL(value).hostname);
  } catch {
    return null;
  }
}

export function registrableDomain(hostname: string): string {
  const normalized = normalizeHostname(hostname);
  if (!normalized || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) {
    return normalized;
  }
  return getDomain(normalized, { allowPrivateDomains: true }) ?? normalized;
}

export function domainCountrySignal(hostname: string): DomainCountrySignal | null {
  const normalized = normalizeHostname(hostname);
  const match = DOMAIN_COUNTRY_SIGNALS.find(
    ({ suffix }) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
  return match ?? null;
}
