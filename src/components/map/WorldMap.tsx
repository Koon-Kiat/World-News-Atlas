"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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
  selectionLimit: 1 | 2;
  onSelectionChange: (countries: string[]) => void;
}

interface MapCountry {
  code: string;
  name: string;
  feature: Feature<Geometry, GeoJsonProperties>;
}

interface MapView {
  scale: number;
  x: number;
  y: number;
}

const WIDTH = 960;
const HEIGHT = 500;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clampView(scale: number, x: number, y: number): MapView {
  const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
  return {
    scale: nextScale,
    x: Math.min(0, Math.max(WIDTH * (1 - nextScale), x)),
    y: Math.min(0, Math.max(HEIGHT * (1 - nextScale), y)),
  };
}

export function WorldMap({
  selectedCountries,
  selectionLimit,
  onSelectionChange,
}: WorldMapProps) {
  const [hoveredCountry, setHoveredCountry] = useState<MapCountry | null>(null);
  const [view, setView] = useState<MapView>({ scale: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
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

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const mapElement = element;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      event.stopPropagation();
      const bounds = mapElement.getBoundingClientRect();
      const pointX = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
      const pointY = ((event.clientY - bounds.top) / bounds.height) * HEIGHT;
      setView((current) => {
        const scale = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, current.scale + (event.deltaY < 0 ? 0.35 : -0.35)),
        );
        const x = pointX - ((pointX - current.x) / current.scale) * scale;
        const y = pointY - ((pointY - current.y) / current.scale) * scale;
        return clampView(scale, x, y);
      });
    }
    mapElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => mapElement.removeEventListener("wheel", handleWheel);
  }, []);

  function select(code: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelectionChange(updateCountrySelection(selectedCountries, code, selectionLimit));
  }

  function zoomFromCenter(direction: 1 | -1) {
    setView((current) => {
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale + direction * 0.5));
      const x = WIDTH / 2 - ((WIDTH / 2 - current.x) / current.scale) * scale;
      const y = HEIGHT / 2 - ((HEIGHT / 2 - current.y) / current.scale) * scale;
      return clampView(scale, x, y);
    });
  }

  function startDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || view.scale === 1) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
    };
  }

  function dragMap(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || view.scale === 1) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - drag.startX) / bounds.width) * WIDTH;
    const dy = ((event.clientY - drag.startY) / bounds.height) * HEIGHT;
    if (Math.abs(dx) + Math.abs(dy) > 4 && !drag.moved) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setView((current) => clampView(current.scale, drag.originX + dx, drag.originY + dy));
  }

  function finishDrag(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    if (drag.moved) window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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
      <div className="map-zoom-controls" aria-label="Map zoom controls">
        <button type="button" onClick={() => zoomFromCenter(1)} disabled={view.scale >= MAX_ZOOM} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomFromCenter(-1)} disabled={view.scale <= MIN_ZOOM} aria-label="Zoom out">−</button>
        <button type="button" className="map-reset" onClick={() => setView({ scale: 1, x: 0, y: 0 })} disabled={view.scale === 1} aria-label="Reset map zoom">Reset</button>
      </div>
      <svg
        ref={svgRef}
        className="world-map"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label={`Interactive world map. Select up to ${selectionLimit === 1 ? "one country" : "two countries"}.`}
        onPointerDown={startDrag}
        onPointerMove={dragMap}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <defs>
          <radialGradient id="ocean-glow" cx="48%" cy="43%" r="66%">
            <stop offset="0%" stopColor="#173d43" />
            <stop offset="100%" stopColor="#0b242a" />
          </radialGradient>
          <pattern id="map-grid" width="34" height="34" patternUnits="userSpaceOnUse">
            <path d="M 34 0 L 0 0 0 34" fill="none" stroke="#d8eee8" strokeOpacity="0.045" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={WIDTH} height={HEIGHT} rx="26" fill="url(#ocean-glow)" />
        <rect width={WIDTH} height={HEIGHT} rx="26" fill="url(#map-grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
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
                onClick={(event) => {
                  select(country.code);
                  event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.preventDefault()}
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
        </g>
      </svg>
      <p className="map-help">
        Scroll or use + to zoom · Drag to move · Click a selected country to remove it
      </p>
    </div>
  );
}
