"use client";

import { useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, Geometry, GeoJsonProperties } from "geojson";
import { feature } from "topojson-client";
import countriesTopology from "world-atlas/countries-110m.json";
import {
  getCountryName,
  numericCountryIdToCode,
} from "@/lib/news/countries/metadata";
import { updateCountrySelection } from "./selection";

interface WorldMapProps {
  selectedCountries: string[];
  onSelectionChange: (countries: string[]) => void;
}

interface MapCountry {
  code: string;
  name: string;
  feature: Feature<Geometry, GeoJsonProperties>;
}

const WIDTH = 960;
const HEIGHT = 500;

export function WorldMap({ selectedCountries, onSelectionChange }: WorldMapProps) {
  const [hoveredCountry, setHoveredCountry] = useState<MapCountry | null>(null);
  const countries = useMemo(() => {
    const collection = feature(countriesTopology, countriesTopology.objects.countries);
    return collection.features.flatMap<MapCountry>((country) => {
      const code = numericCountryIdToCode(country.id ?? "");
      if (!code) return [];
      return [{ code, name: getCountryName(code), feature: country }];
    });
  }, []);
  const path = useMemo(() => {
    const projection = geoNaturalEarth1().fitExtent(
      [[18, 18], [WIDTH - 18, HEIGHT - 18]],
      { type: "FeatureCollection", features: countries.map((country) => country.feature) },
    );
    return geoPath(projection);
  }, [countries]);

  function select(code: string) {
    onSelectionChange(updateCountrySelection(selectedCountries, code));
  }

  return (
    <div className="map-shell">
      <div className="map-status" aria-live="polite">
        <span className="map-status-dot" />
        {hoveredCountry
          ? hoveredCountry.name
          : selectedCountries.length === 0
            ? "Choose a country"
            : selectedCountries.map(getCountryName).join(" + ")}
      </div>
      <svg
        className="world-map"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label="Interactive world map. Select up to two countries."
      >
        <defs>
          <radialGradient id="ocean-glow" cx="48%" cy="43%" r="66%">
            <stop offset="0%" stopColor="#173d43" />
            <stop offset="100%" stopColor="#0b242a" />
          </radialGradient>
          <filter id="selected-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#ff7d5b" floodOpacity="0.7" />
          </filter>
          <pattern id="map-grid" width="34" height="34" patternUnits="userSpaceOnUse">
            <path d="M 34 0 L 0 0 0 34" fill="none" stroke="#d8eee8" strokeOpacity="0.045" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={WIDTH} height={HEIGHT} rx="26" fill="url(#ocean-glow)" />
        <rect width={WIDTH} height={HEIGHT} rx="26" fill="url(#map-grid)" />
        {countries.map((country) => {
          const selectedIndex = selectedCountries.indexOf(country.code);
          const isSelected = selectedIndex >= 0;
          return (
            <path
              key={country.code}
              d={path(country.feature) ?? undefined}
              className={`map-country${isSelected ? " is-selected" : ""}`}
              data-selection-order={isSelected ? selectedIndex + 1 : undefined}
              role="button"
              tabIndex={0}
              aria-label={`${country.name}${isSelected ? ", selected" : ""}`}
              aria-pressed={isSelected}
              onClick={() => select(country.code)}
              onMouseEnter={() => setHoveredCountry(country)}
              onMouseLeave={() => setHoveredCountry(null)}
              onFocus={() => setHoveredCountry(country)}
              onBlur={() => setHoveredCountry(null)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select(country.code);
                }
              }}
            >
              <title>{country.name}</title>
            </path>
          );
        })}
      </svg>
      <p className="map-help">
        Click again to remove · A third choice replaces the oldest selection
      </p>
    </div>
  );
}
