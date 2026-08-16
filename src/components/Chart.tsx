"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ChartPoint = { x: number; y: number };

export type ChartSegment = {
  label: string;
  color: string;
  points: ChartPoint[];
};

export type ChartBand = {
  from: number;
  to: number;
  label?: string;
};

type Props = {
  title: string;
  subtitle?: string;
  segments: ChartSegment[];
  /** Shaded x-ranges marking stretches with no recorded data. */
  bands?: ChartBand[];
  formatY: (v: number) => string;
  formatX: (v: number) => string;
  area?: boolean;
  height?: number;
  /** Force the y-domain to include zero (distance, elevation gain). */
  includeZero?: boolean;
  /** Drop the card frame when the chart already sits inside one. */
  bare?: boolean;
};

const PAD = { top: 14, right: 18, bottom: 26, left: 56 };
const TICKS = 4;

export function Chart({
  title,
  subtitle,
  segments,
  bands = [],
  formatY,
  formatX,
  area = false,
  height = 190,
  includeZero = false,
  bare = false,
}: Props) {
  const frame = bare ? "" : "rounded-xl border border-line bg-surface-1 p-5";
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const all = useMemo(() => segments.flatMap((s) => s.points), [segments]);

  const domain = useMemo(() => {
    if (all.length === 0) return null;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of all) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    if (includeZero) yMin = Math.min(0, yMin);
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    } else {
      const pad = (yMax - yMin) * 0.08;
      yMin -= pad;
      yMax += pad;
    }
    return { xMin, xMax: xMax === xMin ? xMin + 1 : xMax, yMin, yMax };
  }, [all, includeZero]);

  const plotW = Math.max(80, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;

  const sx = useCallback(
    (x: number) => (domain ? PAD.left + ((x - domain.xMin) / (domain.xMax - domain.xMin)) * plotW : 0),
    [domain, plotW]
  );
  const sy = useCallback(
    (y: number) => (domain ? PAD.top + (1 - (y - domain.yMin) / (domain.yMax - domain.yMin)) * plotH : 0),
    [domain, plotH]
  );

  const yTicks = useMemo(() => (domain ? niceTicks(domain.yMin, domain.yMax, TICKS) : []), [domain]);

  const xTicks = useMemo(() => (domain ? timeTicks(domain.xMin, domain.xMax) : []), [domain]);

  const hover = useMemo(() => {
    if (hoverX == null || !domain || all.length === 0) return null;
    const xValue = domain.xMin + ((hoverX - PAD.left) / plotW) * (domain.xMax - domain.xMin);
    let best: { point: ChartPoint; segment: ChartSegment } | null = null;
    let bestDist = Infinity;
    for (const segment of segments) {
      for (const point of segment.points) {
        const d = Math.abs(point.x - xValue);
        if (d < bestDist) {
          bestDist = d;
          best = { point, segment };
        }
      }
    }
    return best;
  }, [hoverX, domain, all.length, plotW, segments]);

  if (!domain) {
    return (
      <figure className={frame}>
        <figcaption className="text-sm font-medium text-ink">{title}</figcaption>
        <p className="mt-6 mb-6 text-center text-sm text-ink-3">No data recorded for this metric.</p>
      </figure>
    );
  }

  return (
    <figure className={frame}>
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium text-ink">{title}</span>
        {subtitle && <span className="text-xs text-ink-3">{subtitle}</span>}
      </figcaption>

      <div ref={wrapRef} className="relative mt-3">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title} over time`}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setHoverX(e.clientX - rect.left);
          }}
          onMouseLeave={() => setHoverX(null)}
        >
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={sy(t)}
                y2={sy(t)}
                stroke="var(--color-line-soft)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 10}
                y={sy(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fill="var(--color-ink-3)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatY(t)}
              </text>
            </g>
          ))}

          {xTicks.map((t, i) => (
            <text
              key={i}
              x={sx(t)}
              y={height - 8}
              textAnchor={
                sx(t) < PAD.left + 12 ? "start" : sx(t) > PAD.left + plotW - 12 ? "end" : "middle"
              }
              fontSize={11}
              fill="var(--color-ink-3)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatX(t)}
            </text>
          ))}

          {bands.map((band, i) => (
            <rect
              key={i}
              x={sx(band.from)}
              y={PAD.top}
              width={Math.max(2, sx(band.to) - sx(band.from))}
              height={plotH}
              fill="var(--color-surface-3)"
            />
          ))}

          {area &&
            segments.map((segment, i) => (
              <path
                key={`a${i}`}
                d={areaPath(segment.points, sx, sy, PAD.top + plotH)}
                fill={segment.color}
                fillOpacity={0.1}
              />
            ))}

          {/* Straight connectors across the unrecorded stretches. */}
          {segments.slice(0, -1).map((segment, i) => {
            const from = segment.points[segment.points.length - 1];
            const to = segments[i + 1].points[0];
            if (!from || !to) return null;
            return (
              <line
                key={`c${i}`}
                x1={sx(from.x)}
                y1={sy(from.y)}
                x2={sx(to.x)}
                y2={sy(to.y)}
                stroke="var(--color-ink-3)"
                strokeWidth={2}
                strokeDasharray="3 4"
                strokeLinecap="round"
              />
            );
          })}

          {segments.map((segment, i) => (
            <path
              key={`l${i}`}
              d={linePath(segment.points, sx, sy)}
              fill="none"
              stroke={segment.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          <line
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH}
            stroke="var(--color-line)"
            strokeWidth={1}
          />

          {hover && (
            <g pointerEvents="none">
              <line
                x1={sx(hover.point.x)}
                x2={sx(hover.point.x)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--color-line)"
                strokeWidth={1}
              />
              <circle
                cx={sx(hover.point.x)}
                cy={sy(hover.point.y)}
                r={4}
                fill={hover.segment.color}
                stroke="var(--color-surface-1)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs shadow-lg"
            style={{
              left: Math.min(Math.max(sx(hover.point.x) - 60, 0), Math.max(0, width - 130)),
            }}
          >
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: hover.segment.color }}
              />
              <span className="text-ink-2">{hover.segment.label}</span>
            </div>
            <div className="mt-0.5 font-medium text-ink tabular-nums">{formatY(hover.point.y)}</div>
            <div className="text-ink-3 tabular-nums">at {formatX(hover.point.x)}</div>
          </div>
        )}
      </div>
    </figure>
  );
}

/** Elapsed-time ticks on whole minutes rather than arbitrary fractions. */
const TIME_STEPS = [10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800];

function timeTicks(min: number, max: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const step = TIME_STEPS.find((s) => span / s <= 6) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  return ticks.length > 1 ? ticks : [min, max];
}

/** Ticks on 1/2/5/10 steps, so axis labels read as round numbers. */
function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];

  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = magnitude * (normalized <= 1.5 ? 1 : normalized <= 3 ? 2 : normalized <= 7 ? 5 : 10);

  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(decimals + 2)));
  }
  return ticks.length > 1 ? ticks : [min, max];
}

function linePath(points: ChartPoint[], sx: (x: number) => number, sy: (y: number) => number): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
}

function areaPath(
  points: ChartPoint[],
  sx: (x: number) => number,
  sy: (y: number) => number,
  baseline: number
): string {
  if (points.length === 0) return "";
  const line = linePath(points, sx, sy);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L${sx(last.x).toFixed(1)},${baseline.toFixed(1)} L${sx(first.x).toFixed(1)},${baseline.toFixed(1)} Z`;
}

export function Legend({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-xs text-ink-2">
          <span
            aria-hidden
            className="h-0.5 w-4 rounded-full"
            style={
              item.dashed
                ? {
                    background: `repeating-linear-gradient(90deg, ${item.color} 0 3px, transparent 3px 7px)`,
                  }
                : { background: item.color }
            }
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
