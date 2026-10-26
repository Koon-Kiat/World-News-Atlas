"use client";

/* eslint-disable @next/next/no-img-element */
import { ArrowLeft, ExternalLink, Globe2, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CountryFlag } from "@/components/CountryFlag";
import { SourceLabel, SourceLogo } from "@/components/SourceLogo";
import { getCountryName } from "@/lib/news/countries/metadata";
import type { ArticleView, StoryView } from "@/lib/news/types";
import { isSafeHttpUrl } from "@/lib/news/url";

function formattedDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function PublisherLink({ article, prominent = false }: { article: ArticleView; prominent?: boolean }) {
  if (article.isFixture || !isSafeHttpUrl(article.url)) return null;
  return (
    <a
      className={prominent ? "reader-publisher-button is-primary" : "reader-publisher-link"}
      href={article.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="strict-origin-when-cross-origin"
    >
      {prominent && <SourceLogo name={article.source.name} domain={article.source.domain} />}
      <span>{prominent ? `Open ${article.source.name}` : "Open original"}</span>
      <ExternalLink aria-hidden="true" />
    </a>
  );
}

function ReaderSourceCard({ article, index }: { article: ArticleView; index: number }) {
  const canOpenOriginal = !article.isFixture && isSafeHttpUrl(article.url);
  const content = (
    <>
      <div className="reader-source-index">{String(index + 1).padStart(2, "0")}</div>
      <div>
        <div className="reader-source-meta">
          <strong><SourceLabel source={article.source} /></strong>
          <time dateTime={article.publishedAt}>{formattedDate(article.publishedAt)}</time>
        </div>
        <h4>{article.title}</h4>
        {article.description ? (
          <>
            <span className="reader-excerpt-label">Full available publisher excerpt</span>
            <p>{article.description}</p>
          </>
        ) : (
          <p className="reader-no-excerpt">This publisher did not include article text in its feed.</p>
        )}
        {canOpenOriginal && (
          <span className="reader-source-action">
            Open original
            <ExternalLink aria-hidden="true" />
          </span>
        )}
      </div>
    </>
  );

  if (canOpenOriginal) {
    return (
      <a
        className="reader-source-card is-clickable"
        href={article.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="strict-origin-when-cross-origin"
        aria-label={`Open ${article.title} at ${article.source.name}`}
      >
        {content}
      </a>
    );
  }

  return <article className="reader-source-card">{content}</article>;
}

export function StoryReader({
  story,
  imageUrl,
  onClose,
}: {
  story: StoryView;
  imageUrl: string | null;
  onClose: () => void;
}) {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const readerScrollRef = useRef<HTMLDivElement>(null);
  const reportsSectionRef = useRef<HTMLElement>(null);
  const readerMountedRef = useRef(false);
  const closeFallbackRef = useRef<number | null>(null);
  const returnScrollRef = useRef(0);
  const historyKeyRef = useRef(`reader-${story.id}`);
  const lead = story.articles[0];
  const sources = [...new Map(story.articles.map((article) => [article.source.id, article.source])).values()];

  const showCoverage = useCallback(() => {
    const scroller = readerScrollRef.current;
    const reports = reportsSectionRef.current;
    if (!scroller || !reports) return;
    const top = reports.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({
      top: Math.max(0, top - 24),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    reports.focus({ preventScroll: true });
  }, []);

  const restoreArticlePosition = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.scrollTo(0, returnScrollRef.current));
    });
  }, []);

  const requestClose = useCallback(() => {
    if (window.history.state?.worldlineReader === historyKeyRef.current) {
      window.history.back();
      closeFallbackRef.current = window.setTimeout(() => {
        if (!readerMountedRef.current) return;
        onClose();
        restoreArticlePosition();
      }, 150);
      return;
    }
    onClose();
    restoreArticlePosition();
  }, [onClose, restoreArticlePosition]);

  useEffect(() => {
    readerMountedRef.current = true;
    returnScrollRef.current = window.scrollY;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const siteFrame = document.querySelector<HTMLElement>(".site-frame");
    const wasInert = siteFrame?.inert ?? false;
    document.body.style.overflow = "hidden";
    if (siteFrame) siteFrame.inert = true;
    backButtonRef.current?.focus();
    if (window.history.state?.worldlineReader !== historyKeyRef.current) {
      window.history.pushState(
        { ...(window.history.state ?? {}), worldlineReader: historyKeyRef.current },
        "",
        `${window.location.pathname}${window.location.search}#reader-${encodeURIComponent(story.id)}`,
      );
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
      if (event.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]');
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }

    function closeOnHistoryBack() {
      if (closeFallbackRef.current !== null) window.clearTimeout(closeFallbackRef.current);
      onClose();
      restoreArticlePosition();
    }

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("popstate", closeOnHistoryBack);
    return () => {
      readerMountedRef.current = false;
      if (closeFallbackRef.current !== null) window.clearTimeout(closeFallbackRef.current);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("popstate", closeOnHistoryBack);
      document.body.style.overflow = previousOverflow;
      if (siteFrame) siteFrame.inert = wasInert;
      previousFocus?.focus();
    };
  }, [onClose, requestClose, restoreArticlePosition, story.id]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="reader-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) requestClose();
      }}
    >
      <section ref={dialogRef} className="story-reader" role="dialog" aria-modal="true" aria-labelledby={`reader-title-${story.id}`}>
        <header className="reader-chrome">
          <div className="reader-chrome-start">
            <button ref={backButtonRef} type="button" className="reader-back" onClick={requestClose} aria-label="Back to stories">
              <ArrowLeft aria-hidden="true" />
              <span>Back</span>
            </button>
          </div>
          <div className="reader-mode" aria-label="Current reading mode">
            <span aria-hidden="true">Aa</span>
            Reader view
          </div>
          <button type="button" className="reader-close" onClick={requestClose} aria-label="Close reader">
            <X aria-hidden="true" />
            <span>Close</span>
          </button>
        </header>

        <div ref={readerScrollRef} className="reader-scroll">
          <div className="reader-hero">
            {imageUrl ? (
              <img src={imageUrl} alt="" referrerPolicy="no-referrer" />
            ) : (
              <div className="reader-hero-placeholder" aria-hidden="true">
                <span>World News Atlas</span>
              </div>
            )}
            <div className="reader-hero-shade" />
            <div className="reader-hero-copy">
              <div className="reader-topic">{story.topics[0] ?? "World briefing"}</div>
              <h2 id={`reader-title-${story.id}`}>{story.title}</h2>
              <p>
                Updated {formattedDate(story.lastUpdatedAt)} · {story.articles.length} {story.articles.length === 1 ? "report" : "independent reports"}
              </p>
            </div>
          </div>

          <div className="reader-layout">
            <main className="reader-article">
              <div className="reader-tags" aria-label="Story geography">
                {story.countries.length > 0 ? story.countries.map((country) => (
                  <span key={country.code}>
                    <CountryFlag code={country.code} />
                    {getCountryName(country.code)}
                  </span>
                )) : (
                  <span><Globe2 aria-hidden="true" />Global</span>
                )}
              </div>

              <p className="reader-deck">
                {story.summary ?? lead?.description ?? "This developing story is being tracked across the available publisher coverage."}
              </p>

              <section
                ref={reportsSectionRef}
                className="reader-section"
                aria-labelledby={`reports-title-${story.id}`}
                tabIndex={-1}
              >
                <p className="reader-eyebrow">Source-by-source</p>
                <h3 id={`reports-title-${story.id}`}>{story.articles.length === 1 ? "Original report" : `${story.articles.length} reports in this story`}</h3>
                <div className="reader-source-list">
                  {story.articles.map((article, index) => (
                    <ReaderSourceCard key={article.id} article={article} index={index} />
                  ))}
                </div>
              </section>
            </main>

            <aside className="reader-sidebar">
              <div className="reader-choice-card">
                <p className="reader-eyebrow">Choose how to read</p>
                <h3>Stay for context or continue to the publisher.</h3>
                <p>
                  This reader presents publisher-supplied headlines, excerpts and source comparisons. The full original reporting remains with the publisher.
                </p>
                {lead && <PublisherLink article={lead} prominent />}
                {story.articles.length > 1 && (
                  <button type="button" className="reader-stay-button" onClick={showCoverage}>
                    Compare {story.articles.length} reports here
                  </button>
                )}
              </div>
              <div className="reader-facts">
                <span>First published</span>
                <strong>{formattedDate(story.firstPublishedAt)}</strong>
                <span>Sources</span>
                <strong className="source-label-list">{sources.map((source) => <SourceLabel key={source.id} source={source} />)}</strong>
                <span>Language</span>
                <strong>{lead?.language?.toUpperCase() ?? "—"}</strong>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
