import Link from "next/link";
import { Map } from "lucide-react";

export default function NotFound() {
  return <main className="recovery-page" id="main-content" tabIndex={-1}>
    <Map aria-hidden="true" />
    <p className="eyebrow">Worldline · 404</p>
    <h1>This page could not be found.</h1>
    <p>The address may have changed. Return to the map to find your next story.</p>
    <Link className="ui-primary" href="/country">Explore the news</Link>
  </main>;
}
