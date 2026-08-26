"use client";

import { useEffect, useId, useRef, useState } from "react";

interface SourceFacet {
  name: string;
  storyCount: number;
}

interface SourceFilterProps {
  availableSources: SourceFacet[];
  value: string[];
  onChange: (value: string[]) => void;
}

export function SourceFilter({ availableSources, value, onChange }: SourceFilterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

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

  function toggle(source: string) {
    onChange(value.includes(source) ? value.filter((item) => item !== source) : [...value, source]);
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
          <div className="source-filter-options">
            {availableSources.map((source) => (
              <label key={source.name}>
                <input
                  type="checkbox"
                  checked={value.includes(source.name)}
                  onChange={() => toggle(source.name)}
                />
                <span>{source.name}</span>
                <small>{source.storyCount}</small>
              </label>
            ))}
          </div>
          <button type="button" className="source-filter-done" onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
    </div>
  );
}
