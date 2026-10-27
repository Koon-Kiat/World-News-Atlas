/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { Newspaper } from "lucide-react";

export function SourceLabel({ source }: { source: { name: string; domain?: string | null } }) {
  return <span className="source-label"><SourceLogo name={source.name} domain={source.domain} /><span>{source.name}</span></span>;
}

/** Publisher favicons share the country flags' compact, decorative treatment. */
export function SourceLogo({ name, domain }: { name: string; domain?: string | null }) {
  const [failedDomain, setFailedDomain] = useState<string | null>(null);
  const publisherDomain = domain?.replace(/^www\./, "");
  const localLogo = publisherDomain === "channelnewsasia.com" ? "/publishers/cna.svg"
    : publisherDomain === "bbc.com" || publisherDomain === "bbc.co.uk" ? "/publishers/bbc.svg" : null;
  const monochromeFavicon = publisherDomain === "straitstimes.com";
  return <span className={`source-logo${localLogo?.includes("bbc") ? " source-logo-wide" : ""}${monochromeFavicon ? " source-logo-monochrome" : ""}`} aria-hidden="true" title={name}>
    {domain && failedDomain !== domain ? <img
      src={localLogo ?? `/api/source-logo?domain=${encodeURIComponent(domain)}&v=1`}
      alt="" width={16} height={16} loading="lazy" decoding="async"
      onError={() => setFailedDomain(domain)}
    /> : <Newspaper />}
  </span>;
}
