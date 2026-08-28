"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

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

export function LandingPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const page = pageRef.current;
    const story = storyRef.current;
    if (!page || !story) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const updateProgress = () => {
      frame = 0;
      const pageRange = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const pageProgress = Math.min(1, Math.max(0, window.scrollY / pageRange));
      const storyTop = story.getBoundingClientRect().top + window.scrollY;
      const storyRange = Math.max(1, story.offsetHeight - window.innerHeight);
      const storyProgress = Math.min(1, Math.max(0, (window.scrollY - storyTop) / storyRange));
      page.style.setProperty("--landing-progress", reducedMotion ? "0" : String(pageProgress));
      page.style.setProperty("--story-progress", reducedMotion ? "1" : String(storyProgress));
      page.style.setProperty("--story-offset", reducedMotion ? "0px" : `${(0.5 - storyProgress) * 34}px`);
      page.style.setProperty("--story-grid-offset", reducedMotion ? "0px" : `${storyProgress * -84}px`);
      page.style.setProperty("--story-rotation", reducedMotion ? "0deg" : `${storyProgress * 140}deg`);
      page.style.setProperty("--depth-back-offset", reducedMotion ? "0px" : `${pageProgress * -170}px`);
      page.style.setProperty("--depth-mid-offset", reducedMotion ? "0px" : `${pageProgress * -320}px`);
      page.style.setProperty("--depth-grid-offset", reducedMotion ? "0px" : `${pageProgress * -45}px`);
      const nextStep = reducedMotion ? 0 : Math.min(STORY_STEPS.length - 1, Math.floor(storyProgress * STORY_STEPS.length));
      setActiveStep((current) => current === nextStep ? current : nextStep);
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateProgress);
    };

    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) entry.target.classList.add("is-visible");
        }
      },
      { threshold: reducedMotion ? 0 : 0.18 },
    );
    page.querySelectorAll("[data-reveal]").forEach((element) => revealObserver.observe(element));
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    updateProgress();
    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      revealObserver.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={pageRef} className="site-frame landing-page" id="top">
      <header className="site-header landing-utility-header">
        <Link className="brand" href="/" aria-label="World News Atlas home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>WORLDLINE</span>
        </Link>
        <p>World news, mapped by connection</p>
        <Link className="latest-link" href="/country#stories">
          Latest briefing <span aria-hidden="true">→</span>
        </Link>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="eyebrow">World News Atlas</p>
            <h1 id="landing-title">The world is not a list. <em>It is a living story.</em></h1>
            <p>
              Follow one country. Connect two. See how reporting moves across borders,
              publishers and perspectives.
            </p>
            <div className="landing-actions">
              <Link href="/country#top">Explore one country <span aria-hidden="true">↗</span></Link>
              <Link href="/compare#top">Compare two countries <span aria-hidden="true">↔</span></Link>
            </div>
          </div>

          <figure className="landing-globe">
            <Image
              src="/og.png"
              alt="A world globe with a route connecting news locations across borders"
              fill
              priority
              sizes="(max-width: 1060px) 74vw, 42vw"
            />
            <figcaption>
              <span>Live world view</span>
              <strong>Follow the story across borders.</strong>
            </figcaption>
          </figure>

          <a className="scroll-cue" href="#story">
            <span>Scroll to trace the signal</span>
            <i aria-hidden="true" />
          </a>
        </section>

        <section ref={storyRef} id="story" className="landing-story" aria-labelledby="story-title">
          <div className="landing-story-stage">
            <div className="story-progress-rail" aria-hidden="true">
              <span style={{ transform: `scaleY(${(activeStep + 1) / STORY_STEPS.length})` }} />
            </div>

            <div className={`story-visual story-visual-step-${activeStep + 1}`} aria-hidden="true">
              <div className="story-visual-grid" />
              <div className="story-world">
                <span className="story-world-latitude latitude-one" />
                <span className="story-world-latitude latitude-two" />
                <span className="story-world-meridian" />
                <i className="story-location location-tokyo"><b />Tokyo</i>
                <i className="story-location location-singapore"><b />Singapore</i>
                <span className="story-connection" />
              </div>
              <div className="story-coverage-cluster">
                <article><span>01</span><strong>Trade corridor expands</strong><small>Tokyo · Singapore</small></article>
                <article><span>02</span><strong>Ports align on new standard</strong><small>3 independent sources</small></article>
                <article><span>03</span><strong>Regional impact explained</strong><small>Local + international</small></article>
              </div>
              <div className="story-signal-label">
                <span>Live signal</span>
                <strong>{["Detected", "Focused", "Connected", "Clustered"][activeStep]}</strong>
              </div>
            </div>

            <div className="story-copy-stack">
              <div className="story-copy-intro">
                <p className="eyebrow">A connected briefing</p>
                <h2 id="story-title">Scroll through the anatomy of a story.</h2>
              </div>
              <div className="story-steps" aria-live="polite">
                {STORY_STEPS.map((step, index) => (
                  <article key={step.number} className={activeStep === index ? "active" : ""} aria-hidden={activeStep !== index}>
                    <span>{step.number}</span>
                    <p className="eyebrow">{step.eyebrow}</p>
                    <h3>{step.title}</h3>
                    <p>{step.copy}</p>
                  </article>
                ))}
              </div>
              <ol className="story-step-index" aria-label="Story journey progress">
                {STORY_STEPS.map((step, index) => (
                  <li key={step.number} className={activeStep === index ? "active" : ""}>
                    <span>{step.number}</span>
                    {step.eyebrow}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="landing-depth" aria-labelledby="depth-title">
          <div className="depth-layer depth-layer-back" aria-hidden="true"><span>LOCAL REPORTING</span><span>INDEPENDENT SOURCES</span></div>
          <div className="depth-layer depth-layer-mid" aria-hidden="true"><span>CONTEXT</span><span>CONNECTION</span></div>
          <div className="depth-copy" data-reveal>
            <p className="eyebrow">Perspective creates depth</p>
            <h2 id="depth-title">Move beyond the headline.</h2>
            <p>
              Background sources move differently from the story in front of you—just as local,
              regional and international reporting each add a different layer of meaning.
            </p>
          </div>
          <div className="depth-card depth-card-local" data-reveal>
            <div className="depth-card-visual depth-local-visual" aria-hidden="true">
              <span className="depth-city">TOKYO</span>
              <article><i>01</i><strong>Policy announced</strong><small>Tokyo desk · 08:40</small></article>
              <article><i>02</i><strong>Local impact explained</strong><small>Osaka bureau · 09:15</small></article>
              <span className="depth-route" />
            </div>
            <span>LOCAL</span><strong>What it means here</strong><small>Country-based publishers</small>
          </div>
          <div className="depth-card depth-card-global" data-reveal>
            <div className="depth-card-visual depth-global-visual" aria-hidden="true">
              <span className="depth-node node-jp">JP</span>
              <span className="depth-node node-sg">SG</span>
              <span className="depth-node node-us">US</span>
              <span className="depth-connection connection-one" />
              <span className="depth-connection connection-two" />
              <p><b>6</b> independent perspectives</p>
            </div>
            <span>GLOBAL</span><strong>How the world reads it</strong><small>International perspective</small>
          </div>
        </section>

        <section className="landing-journeys" aria-labelledby="journeys-title">
          <div className="landing-journeys-heading" data-reveal>
            <p className="eyebrow">Choose your lens</p>
            <h2 id="journeys-title">Start anywhere.</h2>
            <p>No setup, provider choices or account required.</p>
          </div>
          <div className="journey-grid">
            <Link href="/country#top" className="journey-card journey-country" data-reveal>
              <span>01 · ONE COUNTRY</span>
              <h3>Follow one place.</h3>
              <p>Choose a country and see reporting that involves it, wherever the story was published.</p>
              <strong>Open the country map <i aria-hidden="true">↗</i></strong>
            </Link>
            <Link href="/compare#top" className="journey-card journey-compare" data-reveal>
              <span>02 · COMPARE TWO</span>
              <h3>Find the shared story.</h3>
              <p>Select two countries and surface the reporting signals that connect them directly.</p>
              <strong>Build a comparison <i aria-hidden="true">↔</i></strong>
            </Link>
          </div>
        </section>

        <section className="landing-closing" data-reveal>
          <p className="eyebrow">News without borders</p>
          <h2>See where the <em>story meets.</em></h2>
          <div className="landing-actions">
            <Link href="/country#top">Enter World News Atlas <span aria-hidden="true">→</span></Link>
            <Link href="/settings">Set your reading range <span aria-hidden="true">⚙</span></Link>
          </div>
        </section>
      </main>

      <footer className="site-footer landing-footer">
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><span /></span><span>WORLDLINE</span></div>
        <p>Headlines, permitted excerpts and metadata only. Every live article links to its original publisher.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </div>
  );
}
