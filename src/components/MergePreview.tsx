"use client";

import { useMemo, useState } from "react";
import { Chart, Legend, type ChartBand, type ChartPoint, type ChartSegment } from "./Chart";
import { TrackMap, type Track } from "./TrackMap";
import { Button, Callout, Card, ErrorPanel, Field, inputClass } from "./ui";
import { SlideToConfirm } from "./SlideToConfirm";
import {
  MERGED_COLOR,
  formatDistance,
  formatDuration,
  formatDurationWords,
  formatElevation,
  formatPace,
  sourceColor,
} from "@/lib/format";
import {
  asApiError,
  fetchWithCsrf,
  postJson,
  toApiError,
  type ApiError,
  type MergeResponse,
  type PreviewResponse,
  type PreviewSource,
} from "@/lib/client-types";
import type { StreamPoint, Totals } from "@/lib/fit-streams";

type Phase = "idle" | "saving" | "merging";

/** A step is done once the flow has moved past the phase that performs it. */
function stepState(phase: Phase, runsDuring: Phase): "pending" | "current" | "done" {
  if (phase === "idle") return "pending";
  if (phase === runsDuring) return "current";
  return runsDuring === "saving" ? "done" : "pending";
}

type Props = {
  preview: PreviewResponse;
  onBack: () => void;
  onMerged: (result: MergeResponse) => void;
};

export function MergePreview({ preview, onBack, onMerged }: Props) {
  const [name, setName] = useState(preview.suggestedName);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<ApiError | null>(null);
  const running = phase === "saving" || phase === "merging";

  const activityIds = preview.sources.map((s) => s.activityId);
  const segments = useMemo(() => buildSegments(preview), [preview]);
  const bands = useMemo(() => buildBands(segments.elevation.length ? segments.elevation : segments.heartRate), [segments]);

  const legendItems = preview.sources.map((s, i) => ({
    label: shortName(s, i),
    color: sourceColor(i),
  }));

  const tracks: Track[] = preview.sources
    .map((s, i) => ({
      label: shortName(s, i),
      color: sourceColor(i),
      points: s.streams.track,
    }))
    .filter((t) => t.points.length > 1);

  /** Saves the originals to disk, then merges. Confirmation gates both. */
  async function confirmAndMerge() {
    setError(null);
    setPhase("saving");
    try {
      await downloadOriginals();
    } catch (e) {
      setError(asApiError(e));
      setPhase("idle");
      return;
    }

    setPhase("merging");
    try {
      const result = await postJson<MergeResponse>("/api/merge", {
        activityIds,
        name: name.trim() || undefined,
        originalsDownloaded: true,
      });
      onMerged(result);
    } catch (e) {
      setError(asApiError(e));
      setPhase("idle");
    }
  }

  async function downloadOriginals() {
    const res = await fetchWithCsrf("/api/originals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityIds }),
    });
    if (!res.ok) throw toApiError(await res.json().catch(() => ({})));

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `garmin-originals-${activityIds.join("-")}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rise space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">How the merge will look</h2>
          <p className="mt-1 text-sm text-ink-2">
            {preview.sources.length} recordings joined into one activity of{" "}
            {formatDistance(preview.merged.streams.totals.distance)} over{" "}
            {formatDurationWords(preview.merged.streams.totals.elapsed)}. Nothing has changed on
            Garmin yet.
          </p>
        </div>
        <Button variant="ghost" onClick={onBack}>
          ← Change selection
        </Button>
      </div>

      {preview.gaps.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {preview.gaps.map((gap) => (
            <Callout
              key={`${gap.fromIndex}-${gap.toIndex}`}
              tone={gap.overlapping || gap.timeSec > 1800 ? "warning" : "info"}
              title={
                gap.overlapping
                  ? `${formatDurationWords(Math.abs(gap.timeSec))} of overlap`
                  : `${formatDurationWords(gap.timeSec)} unrecorded`
              }
            >
              Between{" "}
              <span className="text-ink">{shortName(preview.sources[gap.fromIndex], gap.fromIndex)}</span>{" "}
              and{" "}
              <span className="text-ink">{shortName(preview.sources[gap.toIndex], gap.toIndex)}</span>
              {gap.distanceM != null && (
                <>
                  {" "}
                  — {formatDistance(gap.distanceM)} apart on the map, bridged by a straight line
                </>
              )}
              .
            </Callout>
          ))}
        </div>
      )}

      {preview.warnings.map((warning) => (
        <Callout key={warning} tone="warning" title="Worth checking">
          {warning}
        </Callout>
      ))}

      <section className="space-y-4">
        <Legend
          items={[
            ...legendItems,
            { label: "Bridged gap", color: "var(--color-ink-3)", dashed: true },
          ]}
        />

        <Chart
          title="Elevation"
          subtitle="metres above sea level"
          segments={segments.elevation}
          bands={bands}
          area
          formatY={(v) => `${Math.round(v)}`}
          formatX={formatDuration}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Chart
            title="Heart rate"
            subtitle="bpm"
            segments={segments.heartRate}
            bands={bands}
            formatY={(v) => `${Math.round(v)}`}
            formatX={formatDuration}
          />
          <Chart
            title="Pace"
            subtitle="higher is faster"
            segments={segments.pace}
            bands={bands}
            formatY={(v) => formatPace(v).replace(" /km", "")}
            formatX={formatDuration}
          />
        </div>

        <TrackMap tracks={tracks} />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-ink">The numbers</h3>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="px-4 py-3 font-medium">Activity</th>
                <th className="px-4 py-3 text-right font-medium">Distance</th>
                <th className="px-4 py-3 text-right font-medium">Moving</th>
                <th className="px-4 py-3 text-right font-medium">Elapsed</th>
                <th className="px-4 py-3 text-right font-medium">Avg HR</th>
                <th className="px-4 py-3 text-right font-medium">Ascent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {preview.sources.map((s, i) => (
                <TotalsRow
                  key={s.activityId}
                  label={shortName(s, i)}
                  color={sourceColor(i)}
                  totals={s.streams.totals}
                />
              ))}
              <TotalsRow label="Sum of originals" totals={sumTotals(preview.sources)} muted />
              <TotalsRow
                label="Merged activity"
                color={MERGED_COLOR}
                totals={preview.merged.streams.totals}
                emphasis
              />
            </tbody>
          </table>
        </Card>
        <p className="mt-2 text-xs text-ink-3">
          Elapsed time grows by the unrecorded gap — that stretch is now inside one activity.
          Moving time and distance should stay close to the sum of the originals.
        </p>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-ink">Each activity on its own</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {preview.sources.map((s, i) => (
            <SourceCard key={s.activityId} source={s} index={i} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-ink">Approve</h3>

        <Card className="p-5">
          <Field
            label="Name for the merged activity"
            hint="Garmin names uploads after the device otherwise."
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              maxLength={120}
              placeholder="Morning Run"
            />
          </Field>

          <ol className="mt-6 space-y-4">
            <Step
              index={1}
              state={stepState(phase, "saving")}
              title="Your originals are saved to this device"
              body="A zip of the untouched .fit files downloads first. It is the only backup — nothing is kept on the server."
            />

            <Step
              index={2}
              state={stepState(phase, "merging")}
              title={`The ${preview.sources.length} originals are deleted from Garmin`}
              body="Garmin rejects an upload that overlaps an existing activity, so the originals go first. Garmin also keeps deleted activities for ~30 days."
            />

            <Step
              index={3}
              state={stepState(phase, "merging")}
              title="The merged activity is uploaded"
              body={`One ${formatDistance(preview.merged.streams.totals.distance)} activity with ${preview.merged.recordCount.toLocaleString()} track points.`}
            />
          </ol>

          {error && (
            <div className="mt-5">
              <ErrorPanel error={error} onDismiss={() => setError(null)} />
            </div>
          )}

          <div className="mt-6 border-t border-line pt-5">
            <SlideToConfirm
              label="Slide to merge"
              confirmedLabel="Merging"
              busyLabel={phase === "saving" ? "Saving your originals" : "Deleting and uploading"}
              busy={running}
              onConfirm={confirmAndMerge}
            />
            <p className="mt-3 text-xs text-ink-3">
              This deletes {preview.sources.length} activities from Garmin and cannot be undone
              from here. Keep the zip that downloads.
            </p>
          </div>
        </Card>
      </section>
    </div>
  );
}

function Step({
  index,
  state,
  title,
  body,
  children,
}: {
  index: number;
  state: "pending" | "current" | "done";
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <li className={`flex gap-4 ${state === "pending" ? "opacity-50" : ""}`}>
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          state === "done"
            ? "bg-good text-white"
            : "border border-line bg-surface-3 text-ink-2"
        }`}
      >
        {state === "done" ? "✓" : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-sm text-ink-3">{body}</p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </li>
  );
}

function SourceCard({ source, index }: { source: PreviewSource; index: number }) {
  const color = sourceColor(index);
  const points = source.streams.points;
  const hasElevation = points.some((p) => p.alt != null);

  const segment: ChartSegment[] = hasElevation
    ? [
        {
          label: shortName(source, index),
          color,
          points: points.filter((p) => p.alt != null).map((p) => ({ x: p.t, y: p.alt as number })),
        },
      ]
    : points.some((p) => p.hr != null)
      ? [
          {
            label: shortName(source, index),
            color,
            points: points.filter((p) => p.hr != null).map((p) => ({ x: p.t, y: p.hr as number })),
          },
        ]
      : [];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-sm font-medium text-ink">{source.name}</span>
        <span className="ml-auto shrink-0 font-mono text-xs text-ink-3">#{source.activityId}</span>
      </div>

      <dl className="grid grid-cols-3 gap-4 px-5 py-4">
        <Metric label="Distance" value={formatDistance(source.streams.totals.distance)} />
        <Metric label="Moving" value={formatDuration(source.streams.totals.movingTime)} />
        <Metric label="Ascent" value={formatElevation(source.streams.totals.ascent)} />
      </dl>

      {segment.length > 0 && (
        <div className="border-t border-line px-5 pt-4 pb-4">
          <Chart
            bare
            title={hasElevation ? "Elevation" : "Heart rate"}
            segments={segment}
            area={hasElevation}
            height={130}
            formatY={(v) => `${Math.round(v)}`}
            formatX={formatDuration}
          />
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function TotalsRow({
  label,
  color,
  totals,
  emphasis,
  muted,
}: {
  label: string;
  color?: string;
  totals: Totals;
  emphasis?: boolean;
  muted?: boolean;
}) {
  const cell = `px-4 py-3 text-right tabular-nums ${
    emphasis ? "font-semibold text-ink" : muted ? "text-ink-3" : "text-ink-2"
  }`;
  return (
    <tr className={emphasis ? "bg-surface-2" : undefined}>
      <td className="px-4 py-3">
        <span className="flex items-center gap-2.5">
          {color && (
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
          )}
          <span className={`truncate ${emphasis ? "font-semibold text-ink" : muted ? "text-ink-3" : "text-ink-2"}`}>
            {label}
          </span>
        </span>
      </td>
      <td className={cell}>{formatDistance(totals.distance)}</td>
      <td className={cell}>{formatDuration(totals.movingTime)}</td>
      <td className={cell}>{formatDuration(totals.elapsed)}</td>
      <td className={cell}>{totals.avgHr ? `${totals.avgHr}` : "–"}</td>
      <td className={cell}>{formatElevation(totals.ascent)}</td>
    </tr>
  );
}

function sumTotals(sources: PreviewSource[]): Totals {
  return sources.reduce<Totals>(
    (acc, s) => ({
      distance: acc.distance + s.streams.totals.distance,
      elapsed: acc.elapsed + s.streams.totals.elapsed,
      movingTime: acc.movingTime + s.streams.totals.movingTime,
      ascent: acc.ascent + s.streams.totals.ascent,
      descent: acc.descent + s.streams.totals.descent,
      avgHr: weightedHr(sources),
      maxHr: Math.max(acc.maxHr ?? 0, s.streams.totals.maxHr ?? 0) || undefined,
    }),
    { distance: 0, elapsed: 0, movingTime: 0, ascent: 0, descent: 0 }
  );
}

function weightedHr(sources: PreviewSource[]): number | undefined {
  const withHr = sources.filter((s) => s.streams.totals.avgHr);
  if (withHr.length === 0) return undefined;
  const totalTime = withHr.reduce((sum, s) => sum + s.streams.totals.elapsed, 0);
  if (totalTime === 0) return undefined;
  return Math.round(
    withHr.reduce((sum, s) => sum + (s.streams.totals.avgHr ?? 0) * s.streams.totals.elapsed, 0) /
      totalTime
  );
}

type Segments = {
  elevation: ChartSegment[];
  heartRate: ChartSegment[];
  pace: ChartSegment[];
};

/**
 * Splits the merged stream into one chart segment per source activity, using
 * the elapsed-second offsets where each source begins on the merged timeline.
 */
function buildSegments(preview: PreviewResponse): Segments {
  const points = preview.merged.streams.points;
  const boundaries = preview.merged.boundaries;

  const buckets: StreamPoint[][] = preview.sources.map(() => []);
  for (const p of points) {
    let index = 0;
    for (let i = 0; i < boundaries.length; i++) {
      if (p.t >= boundaries[i]) index = i;
    }
    buckets[index].push(p);
  }

  const useDistanceForPace = points.some((p) => p.d > 0);

  const build = (pick: (p: StreamPoint, prev?: StreamPoint) => number | undefined): ChartSegment[] =>
    buckets
      .map((bucket, i) => ({
        label: shortName(preview.sources[i], i),
        color: sourceColor(i),
        points: bucket
          .map((p, j) => {
            const y = pick(p, j > 0 ? bucket[j - 1] : undefined);
            return y == null || !Number.isFinite(y) ? null : { x: p.t, y };
          })
          .filter((p): p is ChartPoint => p !== null),
      }))
      .filter((segment) => segment.points.length > 1);

  return {
    elevation: build((p) => p.alt),
    heartRate: build((p) => p.hr),
    pace: build((p, prev) => {
      if (!useDistanceForPace) return p.speed;
      if (!prev) return undefined;
      const dt = p.t - prev.t;
      const dd = p.d - prev.d;
      if (dt <= 0 || dd < 0) return undefined;
      const speed = dd / dt;
      return speed > 0.2 ? speed : undefined;
    }),
  };
}

/** Shade the stretches between one source's last sample and the next one's first. */
function buildBands(segments: ChartSegment[]): ChartBand[] {
  const bands: ChartBand[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const from = segments[i].points.at(-1)?.x;
    const to = segments[i + 1].points[0]?.x;
    if (from != null && to != null && to > from) bands.push({ from, to });
  }
  return bands;
}

function shortName(source: PreviewSource, index: number): string {
  const name = source.name?.trim();
  if (!name) return `Activity ${index + 1}`;
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}
