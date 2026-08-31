"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SourceFacet } from "@/lib/news/types";

interface SourceFilterProps {
  availableSources: SourceFacet[];
  selectedCountries: string[];
  value: string[];
  onChange: (value: string[]) => void;
}

const MAX_SELECTED_OUTLETS = 20;

export function SourceFilter({ availableSources, selectedCountries, value, onChange }: SourceFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const limitMessageId = `${panelId}-limit`;
  const atSelectionLimit = value.length >= MAX_SELECTED_OUTLETS;

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const groups = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const visible = availableSources.filter((source) =>
      !needle || `${source.name} ${source.domain ?? ""}`.toLocaleLowerCase().includes(needle),
    );
    const selected = availableSources.filter((source) => value.includes(source.id));
    const unselected = visible.filter((source) => !value.includes(source.id));
    const local = selectedCountries.length > 0
      ? unselected.filter((source) => source.countryCode && selectedCountries.includes(source.countryCode))
      : [];
    const international = selectedCountries.length > 0
      ? unselected.filter((source) => !source.countryCode || !selectedCountries.includes(source.countryCode))
      : unselected;
    const publisherGroups = selectedCountries.length > 0
      ? [
          { id: "local", label: "Local publishers", sources: local },
          { id: "international", label: "International publishers", sources: international },
        ]
      : [{ id: "all", label: "Publishers", sources: unselected }];
    return [
      { id: "selected", label: "Selected", sources: selected },
      ...publisherGroups,
    ].filter(({ sources }) => sources.length > 0);
  }, [availableSources, search, selectedCountries, value]);

  function toggle(source: string) {
    if (value.includes(source)) {
      onChange(value.filter((item) => item !== source));
      return;
    }
    if (atSelectionLimit) return;
    onChange([...value, source]);
  }

  return (
    <div className="filter-select source-filter" ref={rootRef}>
      <button
        type="button"
        className="filter-select-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={availableSources.length === 0}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <small>News outlets</small>
          <strong>{value.length === 0 ? "All outlets" : `${value.length} selected`}</strong>
        </span>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div className="source-filter-menu" id={panelId} role="dialog" aria-label="Filter by news outlet">
          <div className="source-filter-heading">
            <div>
              <strong>Choose news outlets</strong>
              <small>{availableSources.length} available for this briefing</small>
            </div>
            {value.length > 0 && <button type="button" onClick={() => onChange([])}>Clear</button>}
          </div>
          {atSelectionLimit && (
            <p className="source-filter-limit" id={limitMessageId} role="status">Maximum 20 outlets</p>
          )}
          <label className="source-filter-search">
            <span className="sr-only">Search news outlets</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.7-4.7m2.2-5.3a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" /></svg>
            <input
              type="search"
              value={search}
              placeholder="Search publishers"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="source-filter-options">
            {groups.length === 0 && <p className="source-filter-empty">No matching publishers.</p>}
            {groups.map((group) => (
              <section key={group.id} className={group.id === "selected" ? "source-filter-group is-selected" : "source-filter-group"}>
                <h3>{group.label}</h3>
                {group.sources.map((source) => (
                  <label key={source.id}>
                    <input
                      type="checkbox"
                      checked={value.includes(source.id)}
                      disabled={atSelectionLimit && !value.includes(source.id)}
                      aria-describedby={atSelectionLimit ? limitMessageId : undefined}
                      onChange={() => toggle(source.id)}
                    />
                    <span><strong>{source.name}</strong><small>{source.domain ?? source.countryCode ?? "Publisher"}</small></span>
                    <em>{source.storyCount}</em>
                  </label>
                ))}
              </section>
            ))}
          </div>
          <button type="button" className="source-filter-done" onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
    </div>
  );
}
