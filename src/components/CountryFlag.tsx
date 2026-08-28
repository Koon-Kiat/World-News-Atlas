import { normalizeCountryCode } from "@/lib/news/countries/metadata";

export function CountryFlag({ code, className = "" }: { code: string; className?: string }) {
  const normalized = normalizeCountryCode(code);
  if (!normalized) return <span className={`country-flag-fallback ${className}`.trim()} aria-hidden="true">🌐</span>;
  return (
    <span
      className={`country-flag fi fi-${normalized.toLowerCase()} ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
