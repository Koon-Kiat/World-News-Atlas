"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";

export default function ErrorPage({ retry, reset }: { error: unknown; retry?: () => void; reset?: () => void }) {
  // Next uses retry; the deployed Vinext adapter supplies reset.
  return <main className="recovery-page" id="main-content" tabIndex={-1}>
    <RefreshCw aria-hidden="true" />
    <p className="eyebrow">Worldline</p>
    <h1>We could not load this page.</h1>
    <p>Please try again. Your saved articles and preferences remain in this browser.</p>
    <div className="recovery-actions">
      <button className="ui-primary" type="button" onClick={() => (retry ?? reset)?.()}>Try again</button>
      <Link className="ui-secondary" href="/country">Return to the map</Link>
    </div>
  </main>;
}
