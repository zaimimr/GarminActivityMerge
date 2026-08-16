import { describe, it, expect } from "vitest";
import { buildMerge, type Source } from "./merge-flow";
import { decodeStreams } from "./fit-streams";
import { buildSyntheticFit, type SyntheticOptions } from "@/test/synthetic-fit";

const T0 = Date.UTC(2024, 0, 1, 10, 0, 0);

function source(activityId: number, opts: SyntheticOptions, metrics = {}): Source {
  const fit = buildSyntheticFit(opts);
  return { activityId, fit, metrics, streams: decodeStreams(fit) };
}

describe("buildMerge", () => {
  it("places each source on the merged timeline", () => {
    const a = source(1, { startMs: T0, durationSec: 600, lat: 59.91, lon: 10.75 });
    const b = source(2, { startMs: T0 + 900_000, durationSec: 600, lat: 59.91, lon: 10.77 });

    const preview = buildMerge([a, b]);

    expect(preview.boundaries).toEqual([0, 900]);
    expect(preview.merged.recordCount).toBe(1200);
    expect(preview.gaps).toHaveLength(1);
    expect(preview.gaps[0].timeSec).toBe(301);
    // Elapsed now spans the gap: 600 + 300 + 600, minus the trailing second.
    expect(preview.streams.totals.elapsed).toBe(1499);
  });

  it("sorts sources chronologically regardless of input order", () => {
    const later = source(2, { startMs: T0 + 900_000, durationSec: 600 });
    const earlier = source(1, { startMs: T0, durationSec: 600 });

    // gatherSources sorts; buildMerge relies on that, and fit-merge sorts too.
    const preview = buildMerge([earlier, later]);
    expect(preview.merged.startTime.getTime()).toBe(T0);
  });

  it("refuses to merge fewer than two activities", () => {
    const only = source(1, { startMs: T0, durationSec: 60 });
    expect(() => buildMerge([only])).toThrowError(
      expect.objectContaining({ code: "VALIDATION", title: "Pick at least two activities." })
    );
  });

  it("warns when the sport types differ", () => {
    const run = source(1, { startMs: T0, durationSec: 300 }, { activityType: "running" });
    const ride = source(
      2,
      { startMs: T0 + 600_000, durationSec: 300 },
      { activityType: "cycling" }
    );

    const preview = buildMerge([run, ride]);
    expect(preview.warnings.some((w) => w.includes("different sport types"))).toBe(true);
  });

  it("warns about a long gap between activities", () => {
    const a = source(1, { startMs: T0, durationSec: 300 });
    const b = source(2, { startMs: T0 + 4 * 3600_000, durationSec: 300 });

    const preview = buildMerge([a, b]);
    expect(preview.warnings.some((w) => w.includes("gap between"))).toBe(true);
  });

  it("warns about overlapping recordings", () => {
    const a = source(1, { startMs: T0, durationSec: 600 });
    const b = source(2, { startMs: T0 + 300_000, durationSec: 600 });

    const preview = buildMerge([a, b]);
    expect(preview.warnings.some((w) => w.includes("before activity"))).toBe(true);
  });

  it("warns when the merged track jumps a long way", () => {
    const a = source(1, { startMs: T0, durationSec: 300, lat: 59.9139, lon: 10.7522 });
    const b = source(2, { startMs: T0 + 600_000, durationSec: 300, lat: 60.3913, lon: 5.3221 });

    const preview = buildMerge([a, b]);
    expect(preview.warnings.some((w) => w.includes("away from where"))).toBe(true);
  });

  it("keeps merged distance close to the sum of the originals", () => {
    const a = source(1, { startMs: T0, durationSec: 600, distancePerSec: 3 });
    const b = source(2, { startMs: T0 + 900_000, durationSec: 600, distancePerSec: 3 });

    const preview = buildMerge([a, b]);
    const sum = a.streams.totals.distance + b.streams.totals.distance;

    expect(preview.streams.totals.distance).toBeGreaterThan(sum * 0.95);
    expect(preview.warnings.some((w) => w.includes("lower than the sum"))).toBe(false);
  });

  it("falls back to Garmin's totals for indoor activities with no distance", () => {
    const a = source(1, { startMs: T0, durationSec: 600, distancePerSec: 0 }, { distance: 5000 });
    const b = source(
      2,
      { startMs: T0 + 900_000, durationSec: 600, distancePerSec: 0 },
      { distance: 3000 }
    );

    const preview = buildMerge([a, b]);
    expect(preview.merged.totalDistance).toBe(8000);
    expect(preview.warnings.some((w) => w.includes("no distance data"))).toBe(true);
  });
});
