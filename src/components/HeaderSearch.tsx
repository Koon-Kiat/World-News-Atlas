"use client";

import { History, Search } from "lucide-react";
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
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Search aria-hidden="true" />
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
      <button className="header-search-submit" type="submit" aria-label="Run search">Search</button>
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
                  <History aria-hidden="true" />
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
