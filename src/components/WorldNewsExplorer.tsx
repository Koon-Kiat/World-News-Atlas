"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CountryFlag } from "@/components/CountryFlag";
import { ExploreNavigation, HeaderTools } from "@/components/ExploreNavigation";
import { HeaderSearch } from "@/components/HeaderSearch";
import { NewsFilters } from "@/components/filters/NewsFilters";
import { PerspectiveFilter } from "@/components/filters/PerspectiveFilter";
import { CountryPicker } from "@/components/map/CountryPicker";
import { WorldMap } from "@/components/map/WorldMap";
import { updateCountrySelection } from "@/components/map/selection";
import { StoryList } from "@/components/news/StoryList";
import { getCountryName } from "@/lib/news/countries/metadata";
import { newsPeriodLabel } from "@/lib/news/periods";
import { mergeNextPage, nextPageNumber, responseHasNextPage } from "@/lib/news/pagination";
import { useNewsPeriodPreference } from "@/hooks/useNewsPeriodPreference";
import type { NewsPeriod, NewsResponse, NewsSort, SourcePerspective, StoryView } from "@/lib/news/types";

const QUICK_COUNTRIES = ["US", "CN", "JP", "GB", "FR", "DE", "SG"];
const INITIAL_STORY_COUNT = 12;
const STORY_BATCH_SIZE = 12;
const STORY_PREFETCH_LOW_WATER = 24;
const NO_GROWTH_RETRY_BASE_MS = 1_500;
const MAX_AUTOMATIC_NO_GROWTH_RETRIES = 4;

export type ExplorerMode = "country" | "compare";

export function ProgressiveStoryList({
  stories,
  canFetchMore,
  isFetchingMore,
  onRequestMore,
  continuationVersion = 0,
}: {
  stories: StoryView[];
  canFetchMore: boolean;
  isFetchingMore: boolean;
  onRequestMore: () => void;
  continuationVersion?: number;
}) {
  const [visibleStoryCount, setVisibleStoryCount] = useState(INITIAL_STORY_COUNT);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const prefetchedRequestRef = useRef<string | null>(null);
  const observedContinuationRef = useRef({
    version: continuationVersion,
    storyCount: stories.length,
  });
  const noGrowthRetryCountRef = useRef(0);
  const nextAutomaticRequestAtRef = useRef(0);
  const visibleStories = stories.slice(0, visibleStoryCount);
  const hasMoreRenderedStories = visibleStoryCount < stories.length;
  const hasMoreServerStories = canFetchMore;
  const hasMoreStories = hasMoreRenderedStories || hasMoreServerStories;
  const automaticRequestKey = `${continuationVersion}:${stories.length}`;

  useEffect(() => {
    const previous = observedContinuationRef.current;
    if (previous.version === continuationVersion) return;
    const storyCountGrew = stories.length > previous.storyCount;
    noGrowthRetryCountRef.current = storyCountGrew
      ? 0
      : noGrowthRetryCountRef.current + 1;
    const retryCount = noGrowthRetryCountRef.current;
    nextAutomaticRequestAtRef.current = retryCount === 0
      ? 0
      : retryCount <= MAX_AUTOMATIC_NO_GROWTH_RETRIES
        ? Date.now() + NO_GROWTH_RETRY_BASE_MS * 2 ** (retryCount - 1)
        : Number.POSITIVE_INFINITY;
    observedContinuationRef.current = {
      version: continuationVersion,
      storyCount: stories.length,
    };
  }, [continuationVersion, stories.length]);

  const requestMoreOnce = useCallback(() => {
    if (
      !hasMoreServerStories ||
      isFetchingMore ||
      prefetchedRequestRef.current === automaticRequestKey ||
      Date.now() < nextAutomaticRequestAtRef.current
    ) return;
    prefetchedRequestRef.current = automaticRequestKey;
    onRequestMore();
  }, [automaticRequestKey, hasMoreServerStories, isFetchingMore, onRequestMore]);

  const revealOrRequestMore = useCallback(() => {
    if (hasMoreRenderedStories) {
      setVisibleStoryCount((current) => Math.min(current + STORY_BATCH_SIZE, stories.length));
    } else {
      requestMoreOnce();
    }
  }, [hasMoreRenderedStories, requestMoreOnce, stories.length]);

  const manualRevealOrRequestMore = useCallback(() => {
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

  useEffect(() => {
    const bufferedStories = Math.max(0, stories.length - visibleStoryCount);
    if (
      !hasMoreServerStories ||
      isFetchingMore ||
      bufferedStories > STORY_PREFETCH_LOW_WATER ||
      prefetchedRequestRef.current === automaticRequestKey
    ) return;
    const delayMs = nextAutomaticRequestAtRef.current - Date.now();
    if (!Number.isFinite(delayMs)) return;
    if (delayMs <= 0) {
      requestMoreOnce();
      return;
    }
    const timer = window.setTimeout(requestMoreOnce, delayMs);
    return () => window.clearTimeout(timer);
  }, [automaticRequestKey, hasMoreServerStories, isFetchingMore, requestMoreOnce, stories.length, visibleStoryCount]);

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
              <button type="button" onClick={manualRevealOrRequestMore} disabled={isFetchingMore}>
                {isFetchingMore ? "Loading…" : "Load more"}
              </button>
            </>
          ) : (
            <p>All available matching stories are loaded.</p>
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
  const [sources, setSources] = useState<string[]>([]);
  const [period, setPeriod] = useNewsPeriodPreference();
  const [sort, setSort] = useState<NewsSort>("newest");
  const [search, setSearch] = useState("");
  const [data, setData] = useState(initialData);
  const [settledRequest, setSettledRequest] = useState<string | null>(null);
  const [loadedPage, setLoadedPage] = useState(1);
  const [canFetchMore, setCanFetchMore] = useState(responseHasNextPage(initialData));
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [continuationVersion, setContinuationVersion] = useState(0);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const storiesSectionRef = useRef<HTMLElement>(null);
  const lastScrolledSearchRef = useRef("");
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
      description: `Stories with a meaningful connection to both ${first} and ${second}.`,
    };
  }, [selectedCountries]);

  const requestUrl = useMemo(() => {
    const parameters = new URLSearchParams({
      sourcePerspective: perspective,
      period,
      sort,
      page: "1",
      pageSize: String(STORY_BATCH_SIZE),
    });
    if (selectedCountries.length > 0) parameters.set("countries", selectedCountries.join(","));
    if (topic !== "all") parameters.set("topic", topic);
    if (language !== "all") parameters.set("language", language);
    for (const source of sources) parameters.append("source", source);
    if (deferredSearch) parameters.set("search", deferredSearch);
    return `/api/news?${parameters.toString()}`;
  }, [deferredSearch, language, period, perspective, selectedCountries, sort, sources, topic]);
  const isLoading = settledRequest !== requestUrl;
  const isInitialLiveLoad = isLoading && data.stories.length === 0;

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
        setContinuationVersion((current) => current + 1);
        setLoadedPage(responseData.meta.page);
        setCanFetchMore(responseHasNextPage(responseData));
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

  useEffect(() => {
    if (!deferredSearch) {
      lastScrolledSearchRef.current = "";
      return;
    }
    if (isLoading || lastScrolledSearchRef.current === deferredSearch) return;
    lastScrolledSearchRef.current = deferredSearch;
    storiesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [deferredSearch, isLoading]);

  function loadNextPage() {
    if (
      isLoading ||
      isLoadingMore ||
      !canFetchMore ||
      loadMoreControllerRef.current
    ) return;
    const nextPage = nextPageNumber({ ...data, meta: { ...data.meta, page: loadedPage } });
    if (nextPage === null) {
      setCanFetchMore(false);
      return;
    }
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setIsLoadingMore(true);
    const nextUrl = new URL(requestUrl, window.location.origin);
    nextUrl.searchParams.set("page", String(nextPage));
    if (data.meta.continuationId) nextUrl.searchParams.set("continuation", data.meta.continuationId);
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
        if (responseData.meta.continuationReset) {
          setData(responseData);
          setContinuationVersion((current) => current + 1);
          setLoadedPage(responseData.meta.page);
          setCanFetchMore(responseHasNextPage(responseData));
          setError(null);
          return;
        }
        const mergedPage = mergeNextPage(data.stories, responseData, nextPage, sort);
        setData((current) => {
          const mergedCurrentPage = mergeNextPage(current.stories, responseData, nextPage, sort);
          return {
            stories: mergedCurrentPage.stories,
            meta: responseData.meta,
          };
        });
        setContinuationVersion((current) => current + 1);
        setLoadedPage(responseData.meta.page);
        setCanFetchMore(mergedPage.canFetchMore);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError("Could not load the next page of coverage. Refresh the page to try again.");
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
    setSources([]);
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
        <Link className="brand" href="/" aria-label="Worldline home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>WORLDLINE</span>
        </Link>
        <ExploreNavigation active={mode} />
        <HeaderSearch
          value={search}
          onChange={setSearch}
          onSearch={() => storiesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
        <HeaderTools active={mode} />
      </header>

      <main>
        <section className="hero-section" aria-labelledby="hero-title">
          <h1 id="hero-title" className="sr-only">
            {mode === "country" ? "Explore news by country" : "Compare news between two countries"}
          </h1>

          <div className="map-experience-frame">
            <div className="quick-jump-panel" aria-label="Popular country shortcuts">
              <div>
                <p className="quick-label">Quick jump</p>
                <strong>Choose a major country instantly</strong>
              </div>
              <div className="quick-countries">
                {QUICK_COUNTRIES.map((code) => (
                  <button type="button" key={code} aria-pressed={selectedCountries.includes(code)} onClick={() => selectCountry(code)}>
                    <CountryFlag code={code} />
                    <strong>{getCountryName(code)}</strong>
                  </button>
                ))}
              </div>
            </div>

            <div className="map-layout">
              <WorldMap
                selectedCountries={selectedCountries}
                selectionLimit={selectionLimit}
                onSelectionChange={changeCountries}
              />
              <aside className="map-guide">
                <div className="map-guide-intro">
                  <p className="eyebrow">Your lens</p>
                  <h2>{selectedCountries.length === 0 ? (mode === "country" ? "Choose your country." : "Build a comparison.") : selectionLimit === 1 ? "Country selected." : selectedCountries.length === 1 ? "Add the second country." : "Connection found."}</h2>
                  <p>
                    {selectedCountries.length === 0
                      ? `Choose ${selectionLimit === 1 ? "one country" : "up to two countries"} on the map or search by name below.`
                      : selectionLimit === 1
                        ? "Your briefing now focuses on stories involving this country. Choose another country to switch the lens."
                        : selectedCountries.length === 1
                        ? "Choose one more country to surface diplomacy, trade, technology, travel and other shared stories."
                        : "Every result contains a direct reporting signal for both selected countries."}
                  </p>
                </div>
                <CountryPicker selectedCountries={selectedCountries} onSelect={selectCountry} />
                <div className="selection-slots" aria-label="Selected countries">
                  {Array.from({ length: selectionLimit }, (_, index) => {
                    const code = selectedCountries[index];
                    return (
                      <div key={index} className={code ? "selection-slot filled" : "selection-slot"}>
                        <span>{code ? <CountryFlag code={code} /> : index + 1}</span>
                        <div>
                          <strong>{code ? getCountryName(code) : index === 0 ? "First country" : "Add another"}</strong>
                          <small>{code ? (index === 0 ? "Primary lens" : "Shared lens") : "Not selected"}</small>
                        </div>
                        {code && <button type="button" onClick={() => changeCountries(selectedCountries.filter((item) => item !== code))} aria-label={`Remove ${getCountryName(code)}`}>×</button>}
                      </div>
                    );
                  })}
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
          </div>
        </section>

        <section ref={storiesSectionRef} className="stories-section" id="stories" aria-labelledby="stories-title" aria-busy={isLoading}>
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
                  {data.meta.total}{data.meta.coverageStatus === "expanding" ? "+" : ""} {data.meta.total === 1 ? "story" : "stories"}
                  <small>
                    {data.meta.coverageComplete
                      ? newsPeriodLabel(period)
                      : data.meta.coverageStatus === "expanding"
                        ? `${newsPeriodLabel(period)} · discovering more coverage`
                        : `${newsPeriodLabel(period)} · from currently available coverage`}
                  </small>
                </span>
              )}
            </div>
          </div>

          <NewsFilters
            topic={topic}
            language={language}
            period={period}
            sort={sort}
            sources={sources}
            selectedCountries={selectedCountries}
            availableSources={data.meta.sourceFacets}
            availableLanguages={data.meta.languageFacets}
            onTopicChange={setTopic}
            onLanguageChange={setLanguage}
            onPeriodChange={changePeriod}
            onSortChange={setSort}
            onSourcesChange={setSources}
          />
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
          {!isLoading && data.meta.dataSource !== "fixtures" && data.meta.continuationReset && (
            <div className="notice-banner" role="status">
              <span>Coverage refreshed</span>
              <p>{data.meta.notice ?? "Live coverage restarted because the previous continuation expired."}</p>
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
              canFetchMore={canFetchMore}
              isFetchingMore={isLoadingMore}
              onRequestMore={loadNextPage}
              continuationVersion={continuationVersion}
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
