"use client";

import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { CountryFlag } from "@/components/CountryFlag";
import { getCountryName, listCountries } from "@/lib/news/countries/metadata";

const COUNTRIES = listCountries();
const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ["us", "usa", "united states", "united states of america", "america"],
  GB: ["gb", "uk", "united kingdom", "great britain", "britain"],
  CN: ["cn", "china", "prc", "people's republic of china"],
  SG: ["sg", "singapore"],
  JP: ["jp", "japan"],
  DE: ["de", "germany"],
  FR: ["fr", "france"],
};

function normalizedSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLocaleLowerCase("en");
}

interface CountryPickerProps {
  selectedCountries: string[];
  onSelect: (code: string) => void;
}

export function CountryPicker({ selectedCountries, onSelect }: CountryPickerProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputId = useId();
  const listId = `${inputId}-suggestions`;
  const matches = useMemo(() => {
    const search = normalizedSearchValue(query);
    if (!search) return [];
    return COUNTRIES.map((country) => {
      const code = normalizedSearchValue(country.code);
      const name = normalizedSearchValue(country.name);
      const aliases = COUNTRY_ALIASES[country.code] ?? [];
      const exact = code === search || name === search || aliases.includes(search);
      const prefix = code.startsWith(search) || name.startsWith(search) || aliases.some((alias) => alias.startsWith(search));
      const partial = name.includes(search) || aliases.some((alias) => alias.includes(search));
      return { country, score: exact ? 0 : prefix ? 1 : partial ? 2 : 3 };
    })
      .filter(({ score }) => score < 3)
      .sort((left, right) => left.score - right.score || left.country.name.localeCompare(right.country.name))
      .slice(0, 7)
      .map(({ country }) => country);
  }, [query]);

  function choose(code: string) {
    onSelect(code);
    setQuery("");
    setExpanded(false);
    setActiveIndex(-1);
  }

  return (
    <div className="country-picker">
      <label htmlFor={inputId}>
        <span>Choose a country</span>
        <small>Search every country by name or code</small>
      </label>
      <div className="country-search-field">
        <Search aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          value={query}
          autoComplete="off"
          placeholder="Country name or code"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded && Boolean(query.trim())}
          aria-controls={expanded && query.trim() ? listId : undefined}
          aria-activedescendant={expanded && matches[activeIndex] ? `${listId}-${matches[activeIndex].code}` : undefined}
          onBlur={() => { setExpanded(false); setActiveIndex(-1); }}
          onFocus={() => setExpanded(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setExpanded(true);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setExpanded(false); setActiveIndex(-1); }
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
              event.preventDefault();
              setExpanded(true);
              setActiveIndex((index) => event.key === "ArrowDown"
                ? (index + 1) % matches.length : (index <= 0 ? matches.length - 1 : index - 1));
            }
            if (event.key === "Enter" && expanded && matches[activeIndex]) {
              event.preventDefault();
              choose(matches[activeIndex].code);
            }
          }}
        />
      </div>
      {expanded && query.trim() && (
        <div id={listId} className="country-suggestions" role="listbox" aria-label="Country suggestions">
          {matches.length > 0 ? (
            matches.map((country, index) => (
              <button
                type="button"
                role="option"
                aria-selected={selectedCountries.includes(country.code)}
                id={`${listId}-${country.code}`}
                tabIndex={-1}
                data-active={activeIndex === index || undefined}
                onMouseEnter={() => setActiveIndex(index)}
                key={country.code}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(country.code)}
              >
                <CountryFlag code={country.code} />
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
