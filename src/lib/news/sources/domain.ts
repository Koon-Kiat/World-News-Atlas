import domainCountrySignals from "@/data/domain-country-signals.json";

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "ac.uk", "co.uk", "gov.uk", "org.uk",
  "co.jp", "ne.jp", "or.jp",
  "com.au", "net.au", "org.au",
  "co.kr", "co.nz", "co.za", "co.in",
  "com.sg", "com.br", "com.mx", "com.tr",
  "com.cn", "com.hk", "com.tw", "com.ar",
]);
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
  const labels = normalized.split(".").filter(Boolean);
  if (labels.length <= 2 || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) {
    return normalized;
  }
  const lastTwo = labels.slice(-2).join(".");
  const suffixLength = MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo) ? 2 : 1;
  return labels.slice(-(suffixLength + 1)).join(".");
}

export function domainCountrySignal(hostname: string): DomainCountrySignal | null {
  const normalized = normalizeHostname(hostname);
  const match = DOMAIN_COUNTRY_SIGNALS.find(
    ({ suffix }) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
  return match ?? null;
}
