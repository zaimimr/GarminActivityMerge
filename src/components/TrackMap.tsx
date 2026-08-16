"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

export type Track = {
  label: string;
  color: string;
  points: [number, number][];
};

/** CSS custom properties don't resolve inside SVG stroke attributes Leaflet writes. */
function resolveColor(color: string, el: HTMLElement): string {
  const match = /^var\((--[^)]+)\)$/.exec(color.trim());
  if (!match) return color;
  return getComputedStyle(el).getPropertyValue(match[1]).trim() || "#3987e5";
}

export function TrackMap({ tracks, height = 320 }: { tracks: Track[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  const withPoints = tracks.filter((t) => t.points.length > 1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || withPoints.length === 0) return;

    let cancelled = false;

    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(map);

      const bounds = L.latLngBounds([]);
      withPoints.forEach((track, i) => {
        const color = resolveColor(track.color, containerRef.current!);
        L.polyline(track.points, {
          color,
          weight: 3,
          opacity: 0.95,
          lineJoin: "round",
        }).addTo(map);
        track.points.forEach((p) => bounds.extend(p));

        // Show the straight line the merge draws across the gap.
        const next = withPoints[i + 1];
        if (next) {
          L.polyline([track.points[track.points.length - 1], next.points[0]], {
            color: "#6b7480",
            weight: 2,
            opacity: 0.9,
            dashArray: "4 6",
          }).addTo(map);
        }
      });

      const first = withPoints[0].points[0];
      const last = withPoints[withPoints.length - 1].points.at(-1)!;
      L.circleMarker(first, {
        radius: 5,
        color: "#f4f6f8",
        weight: 2,
        fillColor: "#0ca30c",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip("Start");
      L.circleMarker(last, {
        radius: 5,
        color: "#f4f6f8",
        weight: 2,
        fillColor: "#d03b3b",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip("Finish");

      map.fitBounds(bounds, { padding: [24, 24] });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Tracks are rebuilt per preview; the serialised identity is the right key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(withPoints.map((t) => [t.label, t.color, t.points.length]))]);

  if (withPoints.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface-1 p-5">
        <p className="text-sm font-medium text-ink">Route</p>
        <p className="mt-6 mb-6 text-center text-sm text-ink-3">
          No GPS data in these recordings — typical for treadmill and indoor workouts.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
      <div className="flex items-baseline justify-between gap-4 px-5 pt-5 pb-3">
        <span className="text-sm font-medium text-ink">Route</span>
        <span className="text-xs text-ink-3">Dashed = bridged by the merge</span>
      </div>
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}
