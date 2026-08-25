"use client";

import { useMemo, useState } from "react";
import { getCountryName, listCountries } from "@/lib/news/countries/metadata";

const COUNTRIES = listCountries();

interface CountryPickerProps {
  selectedCountries: string[];
  onSelect: (code: string) => void;
}

function flag(code: string): string {
  return String.fromCodePoint(
    ...code.split("").map((character) => 127397 + character.charCodeAt(0)),
  );
}

export function CountryPicker({ selectedCountries, onSelect }: CountryPickerProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const matches = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("en");
    if (!search) return [];
    return COUNTRIES.filter(
      (country) =>
        country.name.toLocaleLowerCase("en").includes(search) ||
        country.code.toLocaleLowerCase("en").startsWith(search),
    ).slice(0, 7);
  }, [query]);

  function choose(code: string) {
    onSelect(code);
    setQuery("");
    setExpanded(false);
  }

  return (
    <div className="country-picker">
      <label htmlFor="country-search">Find a country</label>
      <div className="country-search-field">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m21 21-4.7-4.7m2.2-5.3a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
        </svg>
        <input
          id="country-search"
          type="search"
          value={query}
          autoComplete="off"
          placeholder="Type a name or code"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded && matches.length > 0}
          aria-controls="country-suggestions"
          onFocus={() => setExpanded(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setExpanded(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setExpanded(false);
            if (event.key === "Enter" && matches[0]) {
              event.preventDefault();
              choose(matches[0].code);
            }
          }}
        />
      </div>
      {expanded && query.trim() && (
        <div id="country-suggestions" className="country-suggestions" role="listbox">
          {matches.length > 0 ? (
            matches.map((country) => (
              <button
                type="button"
                role="option"
                aria-selected={selectedCountries.includes(country.code)}
                key={country.code}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(country.code)}
              >
                <span aria-hidden="true">{flag(country.code)}</span>
                <strong>{country.name}</strong>
                <small>{country.code}</small>
              </button>
            ))
          ) : (
            <p>No country matches “{query.trim()}”.</p>
          )}
        </div>
      )}
      {selectedCountries.length > 0 && (
        <p className="country-picker-hint">
          Selected: {selectedCountries.map(getCountryName).join(" + ")}
        </p>
      )}
    </div>
  );
}
