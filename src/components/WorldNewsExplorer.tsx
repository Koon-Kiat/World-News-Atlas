"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ExploreNavigation } from "@/components/ExploreNavigation";
import { NewsFilters } from "@/components/filters/NewsFilters";
import { PerspectiveFilter } from "@/components/filters/PerspectiveFilter";
import { CountryPicker } from "@/components/map/CountryPicker";
import { WorldMap } from "@/components/map/WorldMap";
import { updateCountrySelection } from "@/components/map/selection";
import { StoryList } from "@/components/news/StoryList";
import { getCountryName } from "@/lib/news/countries/metadata";
import { newsPeriodLabel } from "@/lib/news/periods";
import { useNewsPeriodPreference } from "@/hooks/useNewsPeriodPreference";
import type { NewsPeriod, NewsResponse, SourcePerspective, StoryView } from "@/lib/news/types";

const QUICK_COUNTRIES = ["JP", "SG", "US", "CN", "IN", "GB"];
const INITIAL_STORY_COUNT = 12;
const STORY_BATCH_SIZE = 12;

function flag(code: string): string {
  return String.fromCodePoint(...code.split("").map((character) => 127397 + character.charCodeAt(0)));
}

export type ExplorerMode = "country" | "compare";

function ProgressiveStoryList({
  stories,
  total,
  isFetchingMore,
  onRequestMore,
}: {
  stories: StoryView[];
  total: number;
  isFetchingMore: boolean;
  onRequestMore: () => void;
}) {
  const [visibleStoryCount, setVisibleStoryCount] = useState(INITIAL_STORY_COUNT);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const visibleStories = stories.slice(0, visibleStoryCount);
  const hasMoreRenderedStories = visibleStoryCount < stories.length;
  const hasMoreServerStories = stories.length < total;
  const hasMoreStories = hasMoreRenderedStories || hasMoreServerStories;

  const revealOrRequestMore = useCallback(() => {
    if (hasMoreRenderedStories) {
      setVisibleStoryCount((current) => Math.min(current + STORY_BATCH_SIZE, stories.length));
    } else if (hasMoreServerStories && !isFetchingMore) {
      onRequestMore();
    }
  }, [hasMoreRenderedStories, hasMoreServerStories, isFetchingMore, onRequestMore, stories.length]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreStories) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        revealOrRequestMore();
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreStories, revealOrRequestMore]);

  return (
    <>
      <StoryList stories={visibleStories} />
      {stories.length > 0 && (
        <div className={hasMoreStories ? "load-more-sentinel" : "load-more-sentinel is-complete"} ref={loadMoreRef}>
          {hasMoreStories ? (
            <>
              <span className="load-more-spinner" aria-hidden="true" />
              <div>
                <strong>{isFetchingMore ? "Fetching more live stories" : "More stories are ready"}</strong>
                <small>
                  {visibleStories.length} shown · {hasMoreRenderedStories
                    ? `Continue scrolling or load the next ${Math.min(STORY_BATCH_SIZE, stories.length - visibleStoryCount)} now.`
                    : "Continue scrolling to fetch the next page of current coverage."}
                </small>
              </div>
              <button type="button" onClick={revealOrRequestMore} disabled={isFetchingMore}>
                {isFetchingMore ? "Loading…" : "Load more"}
              </button>
            </>
          ) : (
            <p>All {total} matching stories are loaded.</p>
          )}
        </div>
      )}
    </>
  );
}

export function WorldNewsExplorer({
  initialData,
  mode,
}: {
  initialData: NewsResponse;
  mode: ExplorerMode;
}) {
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const selectionLimit: 1 | 2 = mode === "country" ? 1 : 2;
  const [perspective, setPerspective] = useState<SourcePerspective>("all");
  const [topic, setTopic] = useState("all");
  const [language, setLanguage] = useState("all");
  const [period, setPeriod] = useNewsPeriodPreference();
  const [search, setSearch] = useState("");
  const [data, setData] = useState(initialData);
  const [settledRequest, setSettledRequest] = useState<string | null>(null);
  const [loadedPage, setLoadedPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim());

  const heading = useMemo(() => {
    if (selectedCountries.length === 0) {
      return {
        eyebrow: "The world, in focus",
        title: "World Briefing",
        description: "Important developments, clustered across independent coverage.",
      };
    }
    if (selectedCountries.length === 1) {
      const name = getCountryName(selectedCountries[0]);
      return {
        eyebrow: "Country view",
        title: `Top News — ${name}`,
        description: `Stories involving ${name}, wherever they were published.`,
      };
    }
    const first = getCountryName(selectedCountries[0]);
    const second = getCountryName(selectedCountries[1]);
    return {
      eyebrow: "Bilateral lens",
      title: `${first} ↔ ${second}`,
      description: `Direct connections first, followed by current reporting involving ${first} or ${second}.`,
    };
  }, [selectedCountries]);

  const requestUrl = useMemo(() => {
    const parameters = new URLSearchParams({
      sourcePerspective: perspective,
      period,
      page: "1",
      pageSize: "60",
    });
    if (selectedCountries.length > 0) parameters.set("countries", selectedCountries.join(","));
    if (topic !== "all") parameters.set("topic", topic);
    if (language !== "all") parameters.set("language", language);
    if (deferredSearch) parameters.set("search", deferredSearch);
    return `/api/news?${parameters.toString()}`;
  }, [deferredSearch, language, period, perspective, selectedCountries, topic]);
  const isLoading = settledRequest !== requestUrl;
  const isInitialLiveLoad = isLoading && data.meta.dataSource === "fixtures";

  useEffect(() => {
    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    fetch(requestUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("request failed");
        return (await response.json()) as NewsResponse;
      })
      .then((responseData) => {
        setData(responseData);
        setLoadedPage(responseData.meta.page);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError("Could not refresh coverage. Showing the most recent available results.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettledRequest(requestUrl);
      });
    return () => controller.abort();
  }, [requestUrl]);

  function loadNextPage() {
    if (isLoading || isLoadingMore || data.stories.length >= data.meta.total || loadMoreControllerRef.current) return;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setIsLoadingMore(true);
    const nextPage = loadedPage + 1;
    const nextUrl = new URL(requestUrl, window.location.origin);
    nextUrl.searchParams.set("page", String(nextPage));
    fetch(`${nextUrl.pathname}?${nextUrl.searchParams.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("request failed");
        return (await response.json()) as NewsResponse;
      })
      .then((responseData) => {
        setData((current) => {
          const knownIds = new Set(current.stories.map((story) => story.id));
          return {
            stories: [...current.stories, ...responseData.stories.filter((story) => !knownIds.has(story.id))],
            meta: responseData.meta,
          };
        });
        setLoadedPage(responseData.meta.page);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError("Could not load the next page of coverage. You can try again.");
      })
      .finally(() => {
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
          setIsLoadingMore(false);
        }
      });
  }

  function changeCountries(countries: string[]) {
    setSelectedCountries(countries.slice(0, selectionLimit));
    setPerspective("all");
  }

  function selectCountry(code: string) {
    changeCountries(updateCountrySelection(selectedCountries, code, selectionLimit));
  }

  function changePeriod(value: NewsPeriod) {
    setPeriod(value);
  }

  return (
    <div className="site-frame" id="top">
      <header className="site-header">
        <Link className="brand" href="/country#top" aria-label="Worldline home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>WORLDLINE</span>
        </Link>
        <div className="header-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.7-4.7m2.2-5.3a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" /></svg>
          <label className="sr-only" htmlFor="news-search">Search news</label>
          <input id="news-search" type="search" value={search} maxLength={120} placeholder="Search topics, people, places…" onChange={(event) => setSearch(event.target.value)} />
          {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search">×</button>}
        </div>
        <a className="latest-link" href="#stories">Latest <span aria-hidden="true">↓</span></a>
      </header>

      <ExploreNavigation active={mode} />

      <main>
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">{mode === "country" ? "Single-country briefing" : "Two-country comparison"}</p>
            <h1 id="hero-title">See where the <em>story meets.</em></h1>
            <p>{mode === "country" ? "Explore current reporting through one country at a time." : "Compare two countries through direct links and cross-border reporting."}</p>
          </div>

          <div className="map-layout">
            <WorldMap
              selectedCountries={selectedCountries}
              selectionLimit={selectionLimit}
              onSelectionChange={changeCountries}
            />
            <aside className="map-guide">
              <div>
                <p className="eyebrow">Your lens</p>
                <h2>{selectedCountries.length === 0 ? (mode === "country" ? "Choose your country." : "Build a comparison.") : selectionLimit === 1 ? "Country selected." : selectedCountries.length === 1 ? "Add the second country." : "Connection found."}</h2>
                <p>
                  {selectedCountries.length === 0
                    ? `Choose ${selectionLimit === 1 ? "one country" : "up to two countries"} on the map or search by name below.`
                    : selectionLimit === 1
                      ? "Your briefing now focuses on stories involving this country. Choose another country to switch the lens."
                      : selectedCountries.length === 1
                      ? "Choose one more country to surface diplomacy, trade, technology, travel and other shared stories."
                      : "Direct bilateral links appear first, followed by current reporting involving either selected country."}
                </p>
              </div>
              <div className="selection-slots" aria-label="Selected countries">
                {Array.from({ length: selectionLimit }, (_, index) => {
                  const code = selectedCountries[index];
                  return (
                    <div key={index} className={code ? "selection-slot filled" : "selection-slot"}>
                      <span>{code ? flag(code) : index + 1}</span>
                      <div>
                        <strong>{code ? getCountryName(code) : index === 0 ? "First country" : "Add another"}</strong>
                        <small>{code ? (index === 0 ? "Primary lens" : "Shared lens") : "Not selected"}</small>
                      </div>
                      {code && <button type="button" onClick={() => changeCountries(selectedCountries.filter((item) => item !== code))} aria-label={`Remove ${getCountryName(code)}`}>×</button>}
                    </div>
                  );
                })}
              </div>
              <CountryPicker selectedCountries={selectedCountries} onSelect={selectCountry} />
              <div>
                <p className="quick-label">Quick jump</p>
                <div className="quick-countries">
                  {QUICK_COUNTRIES.map((code) => (
                    <button type="button" key={code} aria-pressed={selectedCountries.includes(code)} onClick={() => selectCountry(code)}>
                      <span aria-hidden="true">{flag(code)}</span> {code}
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>

          <div className="selection-toolbar">
            <div className="selection-title">
              <span className="pulse-dot" />
              <strong>{selectedCountries.length === 0 ? "Global view" : selectedCountries.map(getCountryName).join(" ↔ ")}</strong>
              <span>{selectedCountries.length}/{selectionLimit} selected</span>
            </div>
            <PerspectiveFilter countries={selectedCountries} value={perspective} onChange={setPerspective} />
            {selectedCountries.length > 0 && <button type="button" className="clear-button" onClick={() => changeCountries([])}>Clear selection</button>}
          </div>
        </section>

        <section className="stories-section" id="stories" aria-labelledby="stories-title" aria-busy={isLoading}>
          <div className="stories-heading">
            <div>
              <p className="eyebrow">{heading.eyebrow}</p>
              <h2 id="stories-title">{heading.title}</h2>
              <p>{heading.description}</p>
            </div>
            <div className="result-meta" aria-live="polite">
              {isLoading ? (
                <span className="refreshing"><i aria-hidden="true" /> Checking live sources…</span>
              ) : (
                <span>
                  {data.meta.total} {data.meta.total === 1 ? "story" : "stories"}
                  <small>{newsPeriodLabel(period)}</small>
                </span>
              )}
            </div>
          </div>

          <NewsFilters topic={topic} language={language} period={period} onTopicChange={setTopic} onLanguageChange={setLanguage} onPeriodChange={changePeriod} />
          {isLoading && (
            <div className="refresh-banner" role="status" aria-live="polite">
              <span className="refresh-spinner" aria-hidden="true" />
              <div>
                <strong>Refreshing live coverage</strong>
                <small>Checking the latest publisher feeds and updating this briefing.</small>
              </div>
            </div>
          )}
          {!isLoading && data.meta.dataSource === "fixtures" && (
            <div className="notice-banner" role="status">
              <span>Demo feed</span>
              <p>{data.meta.notice ?? "Sample stories are being used while live ingestion is unavailable."}</p>
            </div>
          )}
          {error && <div className="error-banner" role="alert">{error}</div>}
          {isInitialLiveLoad ? (
            <div className="story-loading-grid" aria-hidden="true">
              <span /><span /><span />
            </div>
          ) : (
            <ProgressiveStoryList
              key={requestUrl}
              stories={data.stories}
              total={data.meta.total}
              isFetchingMore={isLoadingMore}
              onRequestMore={loadNextPage}
            />
          )}
        </section>
      </main>

      <footer className="site-footer">
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><span /></span><span>WORLDLINE</span></div>
        <p>Headlines, permitted excerpts and metadata only. Every live article links to its original publisher.</p>
        <a href="#top">Back to map ↑</a>
      </footer>
    </div>
  );
}
