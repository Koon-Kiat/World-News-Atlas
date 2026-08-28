"use client";

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

const CONNECTION_CODES: Array<[string, string]> = [
  ["JP", "SG"],
  ["US", "GB"],
  ["BR", "ZA"],
  ["IN", "AU"],
  ["FR", "CA"],
  ["KR", "DE"],
];

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
  const connectionRef = useRef(0);
  const draggingRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    rotation: [number, number, number];
  } | null>(null);
  const [connectionLabel, setConnectionLabel] = useState("Japan ↔ Singapore");

  useEffect(() => {
    if (activeStep !== undefined) {
      const storyRotations: Array<[number, number, number]> = [
        [-138, -35, 0],
        [-104, -2, 0],
        [-120, -18, 0],
        [-114, -14, 0],
      ];
      connectionRef.current = 0;
      rotationRef.current = storyRotations[activeStep % storyRotations.length];
      return;
    }
    const interval = window.setInterval(() => {
      let next = connectionRef.current;
      while (next === connectionRef.current) {
        next = Math.floor(Math.random() * CONNECTION_CODES.length);
      }
      connectionRef.current = next;
      const [firstCode, secondCode] = CONNECTION_CODES[next];
      setConnectionLabel(`${getCountryName(firstCode)} ↔ ${getCountryName(secondCode)}`);
    }, 3200);
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
      ocean.addColorStop(0, "#1f5961");
      ocean.addColorStop(0.58, "#0f3a42");
      ocean.addColorStop(1, "#061e24");

      context.beginPath();
      context.arc(size / 2, size / 2, size * 0.435, 0, Math.PI * 2);
      context.fillStyle = ocean;
      context.fill();
      context.strokeStyle = "rgba(218,239,233,.32)";
      context.lineWidth = 1.2;
      context.stroke();

      context.beginPath();
      path(geoGraticule10());
      context.strokeStyle = "rgba(218,239,233,.10)";
      context.lineWidth = 0.75;
      context.stroke();

      context.beginPath();
      path(world);
      context.fillStyle = "rgba(179,211,202,.72)";
      context.fill();
      context.strokeStyle = "rgba(5,35,41,.72)";
      context.lineWidth = 0.7;
      context.stroke();

      const [firstCode, secondCode] = CONNECTION_CODES[connectionRef.current];
      const first = countryByCode.get(firstCode);
      const second = countryByCode.get(secondCode);
      if (first && second) {
        const center: [number, number] = [-rotationRef.current[0], -rotationRef.current[1]];
        const firstVisible = geoDistance(first.centroid, center) < Math.PI / 2;
        const secondVisible = geoDistance(second.centroid, center) < Math.PI / 2;
        const interpolate = geoInterpolate(first.centroid, second.centroid);
        const pulse = (time % 2600) / 2600;
        const coordinates = Array.from({ length: 56 }, (_, index) => interpolate((index / 55) * Math.min(1, pulse * 1.35)));
        context.beginPath();
        path({ type: "LineString", coordinates });
        context.strokeStyle = "rgba(245,111,82,.95)";
        context.lineWidth = 2.3;
        context.shadowColor = "rgba(245,111,82,.45)";
        context.shadowBlur = 10;
        context.stroke();
        context.shadowBlur = 0;

        for (const [country, visible] of [[first, firstVisible], [second, secondVisible]] as const) {
          if (!visible) continue;
          const point = projection(country.centroid);
          if (!point) continue;
          context.beginPath();
          context.arc(point[0], point[1], 10 + Math.sin(time / 260) * 1.5, 0, Math.PI * 2);
          context.fillStyle = "rgba(245,111,82,.2)";
          context.fill();
          context.beginPath();
          context.arc(point[0], point[1], 5.5, 0, Math.PI * 2);
          context.fillStyle = "#f56f52";
          context.fill();
          context.strokeStyle = "#fff7ef";
          context.lineWidth = 2;
          context.stroke();
        }
      }

      frame = window.requestAnimationFrame(draw);
    }

    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, []);

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
        <span>Live connection</span>
        <strong>{activeStep === undefined ? connectionLabel : "Japan ↔ Singapore"}</strong>
      </div>
      <figcaption>{compact ? "Live geographic signal" : "Drag to rotate 360° · Connections update automatically"}</figcaption>
    </figure>
  );
}
