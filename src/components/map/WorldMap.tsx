"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, Geometry, GeoJsonProperties } from "geojson";
import { feature } from "topojson-client";
import countriesTopology from "world-atlas/countries-50m.json";
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
const MAX_ZOOM = 8;

const countries = feature(countriesTopology, countriesTopology.objects.countries).features.flatMap<MapCountry>((country) => {
  const code = numericCountryIdToCode(country.id ?? "");
  return code ? [{ code, name: getCountryName(code), feature: country }] : [];
}).sort((first, second) => first.name.localeCompare(second.name));
const projection = geoNaturalEarth1().fitExtent([[18, 18], [WIDTH - 18, HEIGHT - 18]],
  { type: "FeatureCollection", features: countries.map((country) => country.feature) });
const geometryPath = geoPath(projection);
const geometry = countries.map((country) => ({ ...country, path: geometryPath(country.feature) ?? undefined }));

// Transform-only updates leave this subtree and its precomputed paths alone.
const CountryGeometry = memo(function CountryGeometry({ selectedCountries, onSelect, onHover }: {
  selectedCountries: string[];
  onSelect: (code: string) => void;
  onHover: (country: Pick<MapCountry, "code" | "name"> | null) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, geometry.findIndex(({ code }) => code === selectedCountries[0])));
  const groupRef = useRef<SVGGElement>(null);
  return <g ref={groupRef}>{geometry.map((country, index) => {
    const selectedIndex = selectedCountries.indexOf(country.code);
    return <path key={`${country.code}-${index}`} d={country.path}
      className={`map-country${selectedIndex >= 0 ? " is-selected" : ""}`}
      data-selection-order={selectedIndex >= 0 ? selectedIndex + 1 : undefined}
      role="button" tabIndex={index === activeIndex ? 0 : -1}
      aria-label={`${country.name}${selectedIndex >= 0 ? ", selected" : ""}`}
      aria-pressed={selectedIndex >= 0}
      onClick={() => { setActiveIndex(index); onSelect(country.code); }}
      onMouseEnter={() => onHover(country)} onMouseLeave={() => onHover(null)}
      onFocus={() => { setActiveIndex(index); onHover(country); }} onBlur={() => onHover(null)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(country.code); return; }
        const next = event.key === "Home" ? 0 : event.key === "End" ? geometry.length - 1
          : ["ArrowRight", "ArrowDown"].includes(event.key) ? (index + 1) % geometry.length
          : ["ArrowLeft", "ArrowUp"].includes(event.key) ? (index - 1 + geometry.length) % geometry.length : null;
        if (next === null) return;
        event.preventDefault(); setActiveIndex(next);
        groupRef.current?.querySelectorAll<SVGPathElement>(".map-country")[next]?.focus();
      }}><title>{country.name}</title></path>;
  })}</g>;
});

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
  const [hoveredCountry, setHoveredCountry] = useState<Pick<MapCountry, "code" | "name"> | null>(null);
  const [view, setView] = useState<MapView>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const frameRef = useRef<number | null>(null);
  const updateView = useCallback((next: MapView) => {
    viewRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => { frameRef.current = null; setView(viewRef.current); });
  }, []);
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

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const mapElement = element;
    function handleWheel(event: WheelEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
      const current = viewRef.current;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? HEIGHT : 1);
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * Math.exp(-delta * 0.003)));
      if (scale === current.scale) return;
      const bounds = mapElement.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      event.preventDefault();
      const pointX = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
      const pointY = ((event.clientY - bounds.top) / bounds.height) * HEIGHT;
        const x = pointX - ((pointX - current.x) / current.scale) * scale;
        const y = pointY - ((pointY - current.y) / current.scale) * scale;
        updateView(clampView(scale, x, y));
    }
    mapElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      mapElement.removeEventListener("wheel", handleWheel);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [updateView]);

  const select = useCallback((code: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelectionChange(updateCountrySelection(selectedCountries, code, selectionLimit));
  }, [onSelectionChange, selectedCountries, selectionLimit]);

  function zoomFromCenter(direction: 1 | -1) {
    const current = viewRef.current;
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale + direction * 0.5));
      const x = WIDTH / 2 - ((WIDTH / 2 - current.x) / current.scale) * scale;
      const y = HEIGHT / 2 - ((HEIGHT / 2 - current.y) / current.scale) * scale;
      updateView(clampView(scale, x, y));
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
    updateView(clampView(viewRef.current.scale, drag.originX + dx, drag.originY + dy));
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
        <button type="button" onClick={() => zoomFromCenter(1)} disabled={view.scale >= MAX_ZOOM} aria-label="Zoom in"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg></button>
        <button type="button" onClick={() => zoomFromCenter(-1)} disabled={view.scale <= MIN_ZOOM} aria-label="Zoom out"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" /></svg></button>
        <button type="button" className="map-reset" onClick={() => updateView({ scale: 1, x: 0, y: 0 })} disabled={view.scale === 1} aria-label="Reset map zoom">Reset</button>
      </div>
      <svg
        ref={svgRef}
        className="world-map"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        style={{ touchAction: view.scale > 1 ? "none" : "pan-y" }}
        aria-describedby="map-help"
        aria-label={`Interactive world map. Select up to ${selectionLimit === 1 ? "one country" : "two countries"}.`}
        onPointerDown={startDrag}
        onPointerMove={dragMap}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <defs>
          <radialGradient id="ocean-glow" cx="48%" cy="43%" r="66%">
            <stop offset="0%" stopColor="#111113" />
            <stop offset="100%" stopColor="#000000" />
          </radialGradient>
          <pattern id="map-grid" width="34" height="34" patternUnits="userSpaceOnUse">
            <path d="M 34 0 L 0 0 0 34" fill="none" stroke="#ffffff" strokeOpacity="0.035" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={WIDTH} height={HEIGHT} rx="26" fill="url(#ocean-glow)" />
        <rect width={WIDTH} height={HEIGHT} rx="26" fill="url(#map-grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <CountryGeometry selectedCountries={selectedCountries} onSelect={select} onHover={setHoveredCountry} />
        </g>
      </svg>
      <p className="map-help" id="map-help">
        Ctrl/Cmd + scroll or + / − to zoom · Drag when zoomed · Arrow keys explore countries · Enter/Space selects
      </p>
    </div>
  );
}
