import { normalizeCountryCode } from "@/lib/news/countries/metadata";
import { Globe2 } from "lucide-react";

export function CountryFlag({ code, className = "" }: { code: string; className?: string }) {
  const normalized = normalizeCountryCode(code);
  if (!normalized) return <Globe2 className={`country-flag-fallback ${className}`.trim()} aria-hidden="true" />;
  return (
    <span
      className={`country-flag fi fi-${normalized.toLowerCase()} ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
