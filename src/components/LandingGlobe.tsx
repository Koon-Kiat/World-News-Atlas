"use client";

import { ArrowLeftRight } from "lucide-react";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { geoCentroid, geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { feature } from "topojson-client";
import countriesTopology from "world-atlas/countries-110m.json";
import { getCountryName, numericCountryIdToCode } from "@/lib/news/countries/metadata";

interface GlobeCountry {
  code: string;
  name: string;
  feature: Feature<Geometry, GeoJsonProperties>;
  centroid: [number, number];
}

interface LiveConnection {
  from: string;
  to: string;
  duration: number;
  delay: number;
  color: readonly [number, number, number];
}

const ROUTE_COUNTRY_CODES = [
  "JP", "SG", "US", "GB", "BR", "ZA", "IN", "AU", "FR", "CA", "KR", "DE",
  "CN", "ID", "MX", "NG", "EG", "AR", "NZ", "IT", "ES", "SE",
] as const;
const ROUTE_COLORS = [
  [74, 168, 255],
  [255, 112, 79],
  [139, 211, 255],
  [255, 151, 126],
  [101, 181, 255],
  [255, 129, 99],
] as const;
const LIVE_ROUTE_COUNT = 6;
const STORY_CONNECTIONS: readonly LiveConnection[] = [
  { from: "JP", to: "SG", duration: 3800, delay: 0, color: ROUTE_COLORS[1] },
];

function routeKey(first: string, second: string): string {
  return [first, second].sort().join("-");
}

function createRandomConnection(usedPairs = new Set<string>()): LiveConnection {
  let from = ROUTE_COUNTRY_CODES[Math.floor(Math.random() * ROUTE_COUNTRY_CODES.length)];
  let to = ROUTE_COUNTRY_CODES[Math.floor(Math.random() * ROUTE_COUNTRY_CODES.length)];
  for (let attempt = 0; attempt < 40 && (from === to || usedPairs.has(routeKey(from, to))); attempt += 1) {
    from = ROUTE_COUNTRY_CODES[Math.floor(Math.random() * ROUTE_COUNTRY_CODES.length)];
    to = ROUTE_COUNTRY_CODES[Math.floor(Math.random() * ROUTE_COUNTRY_CODES.length)];
  }
  if (from === to || usedPairs.has(routeKey(from, to))) {
    const availablePair = ROUTE_COUNTRY_CODES.flatMap((first, firstIndex) =>
      ROUTE_COUNTRY_CODES.slice(firstIndex + 1).map((second) => [first, second] as const),
    ).find(([first, second]) => !usedPairs.has(routeKey(first, second)));
    if (availablePair) [from, to] = availablePair;
  }
  return {
    from,
    to,
    duration: 3200 + Math.random() * 4000,
    delay: Math.random() * 2800,
    color: ROUTE_COLORS[Math.floor(Math.random() * ROUTE_COLORS.length)],
  };
}

function createRandomConnections(count: number): LiveConnection[] {
  const connections: LiveConnection[] = [];
  const usedPairs = new Set<string>();
  while (connections.length < count) {
    const connection = createRandomConnection(usedPairs);
    usedPairs.add(routeKey(connection.from, connection.to));
    connections.push(connection);
  }
  return connections;
}

const GLOBE_SIZE = 640;

const countryCollection = feature(
  countriesTopology,
  countriesTopology.objects.countries,
) as unknown as FeatureCollection<Geometry, GeoJsonProperties>;

const GLOBE_COUNTRIES = countryCollection.features.flatMap<GlobeCountry>((country) => {
  const code = numericCountryIdToCode(country.id ?? "");
  if (!code) return [];
  return [{
    code,
    name: getCountryName(code),
    feature: country,
    centroid: geoCentroid(country) as [number, number],
  }];
});

export function LandingGlobe({ compact = false, activeStep }: { compact?: boolean; activeStep?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef<[number, number, number]>([-18, -12, 0]);
  const draggingRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    rotation: [number, number, number];
  } | null>(null);
  const connectionsRef = useRef<LiveConnection[]>([]);
  const [statusConnection, setStatusConnection] = useState<LiveConnection | null>(null);

  useEffect(() => {
    if (activeStep !== undefined) {
      const storyRotations: Array<[number, number, number]> = [
        [-138, -35, 0],
        [-104, -2, 0],
        [-120, -18, 0],
        [-114, -14, 0],
      ];
      rotationRef.current = storyRotations[activeStep % storyRotations.length];
      connectionsRef.current = [...STORY_CONNECTIONS];
      return;
    }
    const initialConnections = createRandomConnections(LIVE_ROUTE_COUNT);
    connectionsRef.current = initialConnections;
    const interval = window.setInterval(() => {
      const current = connectionsRef.current;
      const replaceIndex = Math.floor(Math.random() * current.length);
      const usedPairs = new Set(
        current
          .filter((_, index) => index !== replaceIndex)
          .map((connection) => routeKey(connection.from, connection.to)),
      );
      const replacement = createRandomConnection(usedPairs);
      connectionsRef.current = current.map((connection, index) =>
        index === replaceIndex ? replacement : connection,
      );
      setStatusConnection(replacement);
    }, 2200);
    return () => window.clearInterval(interval);
  }, [activeStep]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const countries = GLOBE_COUNTRIES;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const countryByCode = new Map(countries.map((country) => [country.code, country]));
    const world: FeatureCollection<Geometry, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: countries.map((country) => country.feature),
    };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let previousTime = performance.now();

    function draw(time: number) {
      if (!canvas || !context) return;
      const bounds = canvas.getBoundingClientRect();
      const size = Math.max(320, Math.min(bounds.width || GLOBE_SIZE, GLOBE_SIZE));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(size * ratio) || canvas.height !== Math.round(size * ratio)) {
        canvas.width = Math.round(size * ratio);
        canvas.height = Math.round(size * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size, size);

      const elapsed = Math.min(48, time - previousTime);
      previousTime = time;
      if (!reducedMotion && !draggingRef.current) {
        rotationRef.current[0] = (rotationRef.current[0] + elapsed * 0.008) % 360;
      }

      const projection = geoOrthographic()
        .translate([size / 2, size / 2])
        .scale(size * 0.435)
        .clipAngle(90)
        .precision(0.5)
        .rotate(rotationRef.current);
      const path = geoPath(projection, context);
      const ocean = context.createRadialGradient(size * 0.36, size * 0.3, size * 0.03, size / 2, size / 2, size * 0.48);
      ocean.addColorStop(0, "#1d4a75");
      ocean.addColorStop(0.58, "#123659");
      ocean.addColorStop(1, "#0a2039");

      context.beginPath();
      context.arc(size / 2, size / 2, size * 0.435, 0, Math.PI * 2);
      context.fillStyle = ocean;
      context.fill();
      context.strokeStyle = "rgba(234,240,246,.3)";
      context.lineWidth = 1.2;
      context.stroke();

      context.beginPath();
      path(geoGraticule10());
      context.strokeStyle = "rgba(234,240,246,.12)";
      context.lineWidth = 0.75;
      context.stroke();

      context.beginPath();
      path(world);
      context.fillStyle = "rgba(214,225,236,.86)";
      context.fill();
      context.strokeStyle = "rgba(14,42,71,.9)";
      context.lineWidth = 0.7;
      context.stroke();

      const visibleConnections = activeStep === undefined
        ? connectionsRef.current
        : STORY_CONNECTIONS;

      visibleConnections.forEach((connection, index) => {
        const first = countryByCode.get(connection.from);
        const second = countryByCode.get(connection.to);
        if (!first || !second) return;
        const center: [number, number] = [-rotationRef.current[0], -rotationRef.current[1]];
        const firstVisible = geoDistance(first.centroid, center) < Math.PI / 2;
        const secondVisible = geoDistance(second.centroid, center) < Math.PI / 2;
        const interpolate = geoInterpolate(first.centroid, second.centroid);
        const cycle = ((time + connection.delay) % connection.duration) / connection.duration;
        const progress = Math.min(1, cycle / 0.72);
        const fade = cycle > 0.78 ? Math.max(0, 1 - ((cycle - 0.78) / 0.22)) : 1;
        const [red, green, blue] = connection.color;

        const fullCoordinates = Array.from({ length: 72 }, (_, pointIndex) => interpolate(pointIndex / 71));
        context.beginPath();
        path({ type: "LineString", coordinates: fullCoordinates });
        context.strokeStyle = `rgba(${red},${green},${blue},.13)`;
        context.lineWidth = 1;
        context.stroke();

        const coordinates = Array.from({ length: 72 }, (_, pointIndex) => interpolate((pointIndex / 71) * progress));
        context.beginPath();
        path({ type: "LineString", coordinates });
        context.strokeStyle = `rgba(${red},${green},${blue},${0.38 + (fade * 0.56)})`;
        context.lineWidth = index % 2 === 0 ? 2.2 : 1.7;
        context.shadowColor = `rgba(${red},${green},${blue},.48)`;
        context.shadowBlur = 7 + (index % 3) * 2;
        context.stroke();
        context.shadowBlur = 0;

        for (const [country, visible] of [[first, firstVisible], [second, secondVisible]] as const) {
          if (!visible) continue;
          const point = projection(country.centroid);
          if (!point) continue;
          context.beginPath();
          context.arc(point[0], point[1], 7 + Math.sin((time + connection.delay) / (240 + index * 18)) * 1.4, 0, Math.PI * 2);
          context.fillStyle = `rgba(${red},${green},${blue},.16)`;
          context.fill();
          context.beginPath();
          context.arc(point[0], point[1], 3.8, 0, Math.PI * 2);
          context.fillStyle = `rgb(${red},${green},${blue})`;
          context.fill();
          context.strokeStyle = "#fff7ef";
          context.lineWidth = 1.25;
          context.stroke();
        }
      });

      frame = window.requestAnimationFrame(draw);
    }

    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [activeStep]);

  function startDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    draggingRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rotation: [...rotationRef.current],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event: ReactPointerEvent<HTMLCanvasElement>) {
    const start = draggingRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    rotationRef.current = [
      start.rotation[0] + (event.clientX - start.x) * 0.34,
      Math.max(-70, Math.min(70, start.rotation[1] - (event.clientY - start.y) * 0.22)),
      0,
    ];
  }

  function finishDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (draggingRef.current?.pointerId !== event.pointerId) return;
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <figure className={compact ? "landing-globe-interactive is-story-globe" : "landing-globe-interactive"}>
      <canvas
        ref={canvasRef}
        width={GLOBE_SIZE}
        height={GLOBE_SIZE}
        tabIndex={0}
        aria-label="Interactive rotating world globe showing animated connections between countries. Drag to rotate it."
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") rotationRef.current[0] -= 10;
          if (event.key === "ArrowRight") rotationRef.current[0] += 10;
          if (event.key === "ArrowUp") rotationRef.current[1] = Math.max(-70, rotationRef.current[1] - 8);
          if (event.key === "ArrowDown") rotationRef.current[1] = Math.min(70, rotationRef.current[1] + 8);
        }}
      />
      <div className="landing-globe-status" aria-live="polite">
        <span>{activeStep === undefined ? `${LIVE_ROUTE_COUNT} random live routes` : "Live connection"}</span>
        <strong>
          {activeStep === undefined && statusConnection
            ? <>{getCountryName(statusConnection.from)} <ArrowLeftRight aria-label="connected with" /> {getCountryName(statusConnection.to)}</>
            : activeStep === undefined
              ? "Global routes updating"
            : <>Japan <ArrowLeftRight aria-label="connected with" /> Singapore</>}
        </strong>
      </div>
      <figcaption>{compact ? "Live geographic signal" : "Drag to rotate 360° · Routes move at independent speeds"}</figcaption>
    </figure>
  );
}
