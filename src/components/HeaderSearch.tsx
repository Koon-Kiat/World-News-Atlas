"use client";

import { useState } from "react";
import { useSearchHistory } from "@/hooks/useSearchHistory";

export function HeaderSearch({
  value,
  onChange,
  onSearch,
}: {
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { history, add, clear } = useSearchHistory();

  function submit() {
    add(value);
    setOpen(false);
    onSearch(value);
  }

  return (
    <form
      className="header-search"
      role="search"
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <button className="header-search-submit" type="submit" aria-label="Run search" title="Search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.7-4.7m2.2-5.3a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" /></svg>
      </button>
      <label className="sr-only" htmlFor="news-search">Search news</label>
      <input
        id="news-search"
        type="search"
        value={value}
        maxLength={120}
        autoComplete="off"
        placeholder="Search topics, people, places…"
        onChange={(event) => onChange(event.target.value)}
      />
      {open && history.length > 0 && (
        <div className="search-history" aria-label="Search history">
          <div className="search-history-heading">
            <strong>Recent searches</strong>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={clear}>Clear history</button>
          </div>
          <ul>
            {history.map((query) => (
              <li key={query}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(query);
                    add(query);
                    setOpen(false);
                    onSearch(query);
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4l3 2M4.9 4.9A10 10 0 1 1 2 12M2 5v7h7" /></svg>
                  <span>{query}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
