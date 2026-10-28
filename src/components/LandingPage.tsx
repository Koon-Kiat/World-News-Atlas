"use client";

import { ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpRight, Settings } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { StoryCard } from "@/components/news/StoryCard";
import type { ArticleView, CountryReference, StoryView } from "@/lib/news/types";

const LandingGlobe = dynamic(() => import("./LandingGlobe").then((module) => module.LandingGlobe), {
  ssr: false,
  loading: () => <figure className="landing-globe-interactive" aria-label="Loading interactive globe" />,
});
const StoryGlobe = dynamic(() => import("./LandingGlobe").then((module) => module.LandingGlobe), {
  ssr: false,
  loading: () => <figure className="landing-globe-interactive is-story-globe" aria-label="Loading interactive globe" />,
});

function ArrowUpRightIcon() {
  return <ArrowUpRight aria-hidden="true" />;
}

function CompareIcon() {
  return <ArrowLeftRight aria-hidden="true" />;
}

function ArrowRightIcon() {
  return <ArrowRight aria-hidden="true" />;
}

function SettingsIcon() {
  return <Settings aria-hidden="true" />;
}

const STORY_STEPS = [
  {
    number: "01",
    eyebrow: "Locate the signal",
    title: "A headline starts somewhere.",
    copy: "Live reporting is placed in geographic context, so the location behind the news is visible before the noise around it.",
  },
  {
    number: "02",
    eyebrow: "Choose one country",
    title: "One place brings the story into focus.",
    copy: "See local and international perspectives together, with original publishers kept clear at every step.",
  },
  {
    number: "03",
    eyebrow: "Connect two countries",
    title: "A second place reveals the relationship.",
    copy: "Trade, diplomacy, technology and culture surface as direct links—not incidental mentions in unrelated coverage.",
  },
  {
    number: "04",
    eyebrow: "Read the event",
    title: "Many reports become one coherent story.",
    copy: "Related articles are clustered into a briefing, giving you source diversity without making you read the same event repeatedly.",
  },
] as const;

const STORY_EVIDENCE = [
  {
    label: "Geographic signal",
    headline: "Japan announces a cross-border port data standard",
    source: "Tokyo bureau · Location verified",
    metric: "1 place identified",
  },
  {
    label: "Local context",
    headline: "Singapore operators explain what the standard changes at the port",
    source: "2 local desks · Primary reporting",
    metric: "Local impact added",
  },
  {
    label: "Bilateral connection",
    headline: "Japan and Singapore align the same shipping corridor",
    source: "Trade · Technology · Transport",
    metric: "2 countries connected",
  },
  {
    label: "Source cluster",
    headline: "One development, compared across independent publishers",
    source: "The Japan Times · CNA · Reuters",
    metric: "3 perspectives grouped",
  },
] as const;

const previewCountries: Record<"JP" | "SG", CountryReference> = {
  JP: { code: "JP", name: "Japan", relevanceScore: 0.98 },
  SG: { code: "SG", name: "Singapore", relevanceScore: 0.96 },
};

function previewArticle(
  id: string,
  sourceName: string,
  sourceCountry: "JP" | "SG" | null,
  title: string,
  countries: CountryReference[],
): ArticleView {
  return {
    id,
    provider: "FIXTURE",
    providerArticleId: id,
    title,
    description: "Local reporting adds context, consequences and the voices closest to the development.",
    url: `https://example.com/${id}`,
    canonicalUrl: `https://example.com/${id}`,
    imageUrl: null,
    publishedAt: "2026-08-29T01:30:00.000Z",
    language: "en",
    source: {
      id: `preview:${id}`,
      name: sourceName,
      domain: null,
      countryCode: sourceCountry,
      region: sourceCountry === "SG" ? "Southeast Asia" : sourceCountry === "JP" ? "East Asia" : null,
      language: "en",
      scope: sourceCountry ? "NATIONAL" : "INTERNATIONAL",
      qualityScore: 0.9,
    },
    countries,
    topics: ["transport"],
    importanceScore: 0.82,
    relevanceScore: 0.9,
    isFixture: true,
  };
}

const LOCAL_PREVIEW_STORY: StoryView = {
  id: "landing-local-preview",
  title: "New port rules reshape work along the waterfront",
  summary: "Operators and local officials explain the immediate changes for people working at the port.",
  firstPublishedAt: "2026-08-29T01:30:00.000Z",
  lastUpdatedAt: "2026-08-29T01:30:00.000Z",
  countries: [previewCountries.JP],
  topics: ["transport"],
  importanceScore: 0.82,
  articles: [previewArticle("local-preview", "The Japan Times", "JP", "New port rules reshape work along the waterfront", [previewCountries.JP])],
};

const GLOBAL_PREVIEW_STORY: StoryView = {
  id: "landing-global-preview",
  title: "Japan and Singapore align on a cross-border port standard",
  summary: "Independent publishers connect the domestic policy change to a wider regional shipping corridor.",
  firstPublishedAt: "2026-08-29T01:30:00.000Z",
  lastUpdatedAt: "2026-08-29T02:15:00.000Z",
  countries: [previewCountries.JP, previewCountries.SG],
  topics: ["transport"],
  importanceScore: 0.9,
  articles: [
    previewArticle("global-preview-jp", "The Japan Times", "JP", "Japan publishes a new port data standard", [previewCountries.JP, previewCountries.SG]),
    previewArticle("global-preview-sg", "CNA", "SG", "Singapore operators prepare for the shared standard", [previewCountries.JP, previewCountries.SG]),
    previewArticle("global-preview-world", "Reuters", null, "Regional ports move toward shared data rules", [previewCountries.JP, previewCountries.SG]),
  ],
};

export function LandingPage() {
  const storyRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState(0);

  // Scroll-driven story: the stage pins while the section scrolls past, and
  // progress through the section selects the step and drives the parallax.
  // CSS turns the pin off on small screens and for reduced motion, where the
  // same progress maths still selects the step nearest the reader.
  useEffect(() => {
    const story = storyRef.current;
    if (!story) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Scroll events are already frame-aligned; updating directly avoids a
    // stalled requestAnimationFrame freezing the story in background tabs.
    const update = () => {
      const box = story.getBoundingClientRect();
      const viewport = window.innerHeight;
      const range = box.height > viewport * 1.5 ? box.height - viewport : box.height + viewport * 0.5;
      const offset = box.height > viewport * 1.5 ? -box.top : viewport * 0.75 - box.top;
      const progress = Math.min(1, Math.max(0, offset / Math.max(1, range)));
      story.style.setProperty("--story-progress", reducedMotion ? "0" : progress.toFixed(4));
      const next = Math.min(STORY_STEPS.length - 1, Math.floor(progress * STORY_STEPS.length));
      setActiveStep((current) => current === next ? current : next);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Step buttons scroll to that chapter, so keyboard users can move through
  // the story without relying on scroll position alone.
  const goToStep = (index: number) => {
    const story = storyRef.current;
    if (!story) return;
    const range = story.offsetHeight - window.innerHeight;
    if (range <= window.innerHeight * 0.5) { setActiveStep(index); return; }
    const top = story.getBoundingClientRect().top + window.scrollY;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: top + range * ((index + 0.5) / STORY_STEPS.length), behavior: smooth ? "smooth" : "auto" });
  };

  return (
    <div className="site-frame landing-page" id="top">
      <header className="site-header landing-utility-header">
        <Link className="brand" href="/" aria-label="World News Atlas home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>WORLDLINE</span>
        </Link>
        <p>World news, mapped by connection</p>
        <Link className="latest-link" href="/country#stories">
          Latest briefing <ArrowRight aria-hidden="true" />
        </Link>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="eyebrow">World News Atlas</p>
            <h1 id="landing-title">The world is not a list. <em>It is a living story.</em></h1>
            <p>
              Follow one country. Connect two. See how reporting moves across borders,
              publishers and perspectives.
            </p>
            <div className="landing-actions">
              <Link href="/country#top">Explore one country <ArrowUpRightIcon /></Link>
              <Link href="/compare#top">Compare two countries <CompareIcon /></Link>
            </div>
            <dl className="landing-facts">
              <div><dt>Coverage</dt><dd>Every country on the map</dd></div>
              <div><dt>Sources</dt><dd>Publisher feeds, NewsAPI and GDELT</dd></div>
              <div><dt>Account</dt><dd>None needed</dd></div>
            </dl>
          </div>
          <LandingGlobe />
        </section>

        <section id="story" ref={storyRef} className="landing-story" aria-labelledby="story-title"
          style={{ "--story-steps": STORY_STEPS.length } as CSSProperties}>
          <div className="landing-story-stage">
            <div className="landing-story-inner">
              <div className="story-copy-intro">
                <p className="eyebrow">How a briefing comes together</p>
                <h2 id="story-title">Watch one signal become a world story.</h2>
              </div>
              <div className="landing-story-layout">
                <div className="story-steps-wrap">
                  <div className="story-progress-rail" aria-hidden="true"><span /></div>
                  <ol className="story-steps">
                    {STORY_STEPS.map((step, index) => (
                      <li key={step.number} className={activeStep === index ? "active" : ""} aria-current={activeStep === index ? "step" : undefined}>
                        <span className="story-step-number" aria-hidden="true">{step.number}</span>
                        <div>
                          <p className="eyebrow">{step.eyebrow}</p>
                          <h3><button type="button" className="story-step-button" onClick={() => goToStep(index)}>{step.title}</button></h3>
                          <p className="story-step-copy">{step.copy}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className={`story-visual story-visual-step-${activeStep + 1}`}>
                  <div className="story-orbit story-orbit-one" aria-hidden="true" />
                  <div className="story-orbit story-orbit-two" aria-hidden="true" />
                  <div className="story-globe-parallax">
                    <StoryGlobe compact activeStep={activeStep} />
                  </div>
                  <article className="story-evidence-card" key={activeStep} aria-label={`Example for step ${activeStep + 1}`}>
                    <span>{STORY_EVIDENCE[activeStep].label}</span>
                    <strong>{STORY_EVIDENCE[activeStep].headline}</strong>
                    <small>{STORY_EVIDENCE[activeStep].source}</small>
                    <b>{STORY_EVIDENCE[activeStep].metric}</b>
                  </article>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-depth" aria-labelledby="depth-title">
          <div className="depth-copy">
            <p className="eyebrow">Perspective creates depth</p>
            <h2 id="depth-title">Move beyond the headline.</h2>
            <p>
              Local, regional and international reporting each add a different layer of meaning.
              Worldline keeps them side by side, and every source links back to its publisher.
            </p>
          </div>
          <div className="depth-comparison">
            <div className="depth-card depth-card-local">
              <h3>Local perspective</h3>
              <p>Reporting from inside the country explains the direct human and policy impact.</p>
              <div className="depth-story-preview" aria-hidden="true" inert>
                <StoryCard story={LOCAL_PREVIEW_STORY} previewImage="/landing/port-waterfront.svg" />
              </div>
            </div>
            <div className="depth-card depth-card-global">
              <h3>Global perspective</h3>
              <p>International coverage reveals different priorities, framing and consequences.</p>
              <div className="depth-story-preview" aria-hidden="true" inert>
                <StoryCard story={GLOBAL_PREVIEW_STORY} previewImage="/landing/shipping-corridor.svg" />
              </div>
            </div>
          </div>
        </section>

        <div className="landing-finale">
        <section className="landing-journeys" aria-labelledby="journeys-title">
          <div className="landing-journeys-heading">
            <p className="eyebrow">Choose your lens</p>
            <h2 id="journeys-title">Start anywhere.</h2>
            <p>No setup, provider choices or account required.</p>
          </div>
          <div className="journey-grid">
            <Link href="/country#top" className="journey-card journey-country">
              <span>One country</span>
              <h3>Follow one place.</h3>
              <p>Choose a country and see reporting that involves it, wherever the story was published.</p>
              <strong>Open the country map <ArrowUpRightIcon /></strong>
            </Link>
            <Link href="/compare#top" className="journey-card journey-compare">
              <span>Compare two</span>
              <h3>Find the shared story.</h3>
              <p>Select two countries and surface the reporting signals that connect them directly.</p>
              <strong>Build a comparison <CompareIcon /></strong>
            </Link>
          </div>
        </section>

        <section className="landing-closing" aria-labelledby="closing-title">
          <h2 id="closing-title">See where the story meets.</h2>
          <p>Open the map, pick a country, and the briefing updates as coverage arrives.</p>
          <div className="landing-actions">
            <Link href="/country#top">Enter World News Atlas <ArrowRightIcon /></Link>
            <Link href="/settings">Set your reading range <SettingsIcon /></Link>
          </div>
        </section>
        </div>
      </main>

      <footer className="site-footer landing-footer">
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><span /></span><span>WORLDLINE</span></div>
        <p>Headlines, permitted excerpts and metadata only. Every live article links to its original publisher.</p>
        <a className="back-to-top-link" href="#top" aria-label="Back to top" title="Back to top">
          <ArrowUp aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
