"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { NewsFilters } from "@/components/filters/NewsFilters";
import { PerspectiveFilter } from "@/components/filters/PerspectiveFilter";
import { CountryPicker } from "@/components/map/CountryPicker";
import { WorldMap } from "@/components/map/WorldMap";
import { updateCountrySelection } from "@/components/map/selection";
import { StoryList } from "@/components/news/StoryList";
import { getCountryName } from "@/lib/news/countries/metadata";
import type { NewsPeriod, NewsResponse, SourcePerspective } from "@/lib/news/types";

const QUICK_COUNTRIES = ["JP", "SG", "US", "CN", "IN", "GB"];

function flag(code: string): string {
  return String.fromCodePoint(...code.split("").map((character) => 127397 + character.charCodeAt(0)));
}

export function WorldNewsExplorer({ initialData }: { initialData: NewsResponse }) {
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectionLimit, setSelectionLimit] = useState<1 | 2>(1);
  const [perspective, setPerspective] = useState<SourcePerspective>("all");
  const [topic, setTopic] = useState("all");
  const [language, setLanguage] = useState("all");
  const [period, setPeriod] = useState<NewsPeriod>("latest");
  const [search, setSearch] = useState("");
  const [data, setData] = useState(initialData);
  const [settledRequest, setSettledRequest] = useState<string | null>(null);
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
      pageSize: "30",
    });
    if (selectedCountries.length > 0) parameters.set("countries", selectedCountries.join(","));
    if (topic !== "all") parameters.set("topic", topic);
    if (language !== "all") parameters.set("language", language);
    if (deferredSearch) parameters.set("search", deferredSearch);
    return `/api/news?${parameters.toString()}`;
  }, [deferredSearch, language, period, perspective, selectedCountries, topic]);
  const isLoading = settledRequest !== requestUrl;

  useEffect(() => {
    const controller = new AbortController();
    fetch(requestUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("request failed");
        return (await response.json()) as NewsResponse;
      })
      .then((responseData) => {
        setData(responseData);
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

  function changeCountries(countries: string[]) {
    setSelectedCountries(countries.slice(0, selectionLimit));
    setPerspective("all");
  }

  function changeSelectionLimit(limit: 1 | 2) {
    setSelectionLimit(limit);
    if (limit === 1) setSelectedCountries((countries) => countries.slice(0, 1));
    setPerspective("all");
  }

  function selectCountry(code: string) {
    changeCountries(updateCountrySelection(selectedCountries, code, selectionLimit));
  }

  return (
    <div className="site-frame">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Worldline home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>WORLDLINE</span>
        </a>
        <div className="header-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.7-4.7m2.2-5.3a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" /></svg>
          <label className="sr-only" htmlFor="news-search">Search news</label>
          <input id="news-search" type="search" value={search} maxLength={120} placeholder="Search topics, people, places…" onChange={(event) => setSearch(event.target.value)} />
          {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search">×</button>}
        </div>
        <a className="latest-link" href="#stories">Latest <span aria-hidden="true">↓</span></a>
      </header>

      <main id="top">
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">News without borders</p>
            <h1 id="hero-title">See where the <em>story meets.</em></h1>
            <p>Explore what is happening—and what connects us—one country at a time.</p>
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
                <h2>{selectedCountries.length === 0 ? "Start anywhere." : selectionLimit === 1 ? "Country selected." : selectedCountries.length === 1 ? "Now add a connection." : "Connection found."}</h2>
                <p>
                  {selectedCountries.length === 0
                    ? `Choose ${selectionLimit === 1 ? "one country" : "up to two countries"} on the map or search by name below.`
                    : selectionLimit === 1
                      ? "Your briefing now focuses on stories involving this country. Choose another country to switch the lens."
                      : selectedCountries.length === 1
                      ? "Choose one more country to surface diplomacy, trade, technology, travel and other shared stories."
                      : "Results now require both countries to be central to the same event—not just incidental mentions."}
                </p>
              </div>
              <div className="selection-mode" aria-label="Country selection mode">
                <span>Explore mode</span>
                <div>
                  <button type="button" className={selectionLimit === 1 ? "active" : ""} aria-pressed={selectionLimit === 1} onClick={() => changeSelectionLimit(1)}>
                    One country
                  </button>
                  <button type="button" className={selectionLimit === 2 ? "active" : ""} aria-pressed={selectionLimit === 2} onClick={() => changeSelectionLimit(2)}>
                    Compare two
                  </button>
                </div>
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

        <section className="stories-section" id="stories" aria-labelledby="stories-title">
          <div className="stories-heading">
            <div>
              <p className="eyebrow">{heading.eyebrow}</p>
              <h2 id="stories-title">{heading.title}</h2>
              <p>{heading.description}</p>
            </div>
            <div className="result-meta" aria-live="polite">
              <span>{data.meta.total} {data.meta.total === 1 ? "story" : "stories"}</span>
              {isLoading && <span className="refreshing">Refreshing…</span>}
            </div>
          </div>

          <NewsFilters topic={topic} language={language} period={period} onTopicChange={setTopic} onLanguageChange={setLanguage} onPeriodChange={setPeriod} />
          {data.meta.dataSource === "fixtures" && (
            <div className="notice-banner" role="status">
              <span>Demo feed</span>
              <p>{data.meta.notice ?? "Sample stories are being used while live ingestion is unavailable."}</p>
            </div>
          )}
          {error && <div className="error-banner" role="alert">{error}</div>}
          <StoryList stories={data.stories} />
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
