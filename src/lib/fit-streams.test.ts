import { describe, it, expect } from "vitest";
import { decodeStreams, analyzeGaps, haversine } from "./fit-streams";
import { buildSyntheticFit } from "@/test/synthetic-fit";

const T0 = Date.UTC(2024, 0, 1, 10, 0, 0);

describe("decodeStreams", () => {
  it("extracts totals and a downsampled series from a FIT file", () => {
    const fit = buildSyntheticFit({
      startMs: T0,
      durationSec: 600,
      distancePerSec: 3,
      hr: 145,
      altitude: 100,
      climbPerSec: 0.1,
    });

    const streams = decodeStreams(fit);

    expect(streams.recordCount).toBe(600);
    expect(streams.startTime).toBe(new Date(T0).toISOString());
    expect(streams.totals.distance).toBeCloseTo(599 * 3, 0);
    expect(streams.totals.elapsed).toBe(599);
    expect(streams.totals.avgHr).toBe(145);
    expect(streams.totals.maxHr).toBe(145);
    // 0.1 m/s over ~600s, minus the 1 m jitter threshold on the final step.
    expect(streams.totals.ascent).toBeGreaterThan(55);
    expect(streams.totals.ascent).toBeLessThanOrEqual(60);
    expect(streams.totals.descent).toBe(0);
  });

  it("caps the number of points it returns", () => {
    const fit = buildSyntheticFit({ startMs: T0, durationSec: 5000 });
    const streams = decodeStreams(fit);

    expect(streams.recordCount).toBe(5000);
    expect(streams.points.length).toBeLessThanOrEqual(600);
    expect(streams.points[0].t).toBe(0);
    expect(streams.points.at(-1)?.t).toBe(4999);
  });

  it("converts GPS positions from semicircles to degrees", () => {
    const fit = buildSyntheticFit({
      startMs: T0,
      durationSec: 60,
      lat: 59.9139,
      lon: 10.7522,
    });

    const streams = decodeStreams(fit);
    expect(streams.track.length).toBeGreaterThan(1);
    const [lat, lon] = streams.track[0];
    expect(lat).toBeCloseTo(59.9139, 3);
    expect(lon).toBeCloseTo(10.7522, 3);
  });

  it("returns an empty track for indoor activities", () => {
    const fit = buildSyntheticFit({ startMs: T0, durationSec: 60, distancePerSec: 0 });
    const streams = decodeStreams(fit);

    expect(streams.track).toEqual([]);
    expect(streams.totals.distance).toBe(0);
  });

  it("excludes stopped time from moving time", () => {
    const fit = buildSyntheticFit({ startMs: T0, durationSec: 120, distancePerSec: 0 });
    const streams = decodeStreams(fit);

    // speed is 0, so nothing counts as moving even though 120s elapsed.
    expect(streams.totals.elapsed).toBe(119);
    expect(streams.totals.movingTime).toBe(0);
  });
});

describe("analyzeGaps", () => {
  it("measures the unrecorded time and distance between two activities", () => {
    const a = decodeStreams(
      buildSyntheticFit({ startMs: T0, durationSec: 60, lat: 59.9139, lon: 10.7522 })
    );
    const b = decodeStreams(
      buildSyntheticFit({
        startMs: T0 + 300_000,
        durationSec: 60,
        lat: 59.9139,
        lon: 10.762,
      })
    );

    const [gap] = analyzeGaps([a, b]);
    expect(gap.timeSec).toBe(241); // 300s later, first file ends at +59s
    expect(gap.overlapping).toBe(false);
    expect(gap.distanceM).toBeGreaterThan(400);
  });

  it("flags overlapping activities", () => {
    const a = decodeStreams(buildSyntheticFit({ startMs: T0, durationSec: 120 }));
    const b = decodeStreams(buildSyntheticFit({ startMs: T0 + 60_000, durationSec: 120 }));

    const [gap] = analyzeGaps([a, b]);
    expect(gap.overlapping).toBe(true);
    expect(gap.timeSec).toBeLessThan(0);
  });

  it("returns no gaps for a single activity", () => {
    const a = decodeStreams(buildSyntheticFit({ startMs: T0, durationSec: 60 }));
    expect(analyzeGaps([a])).toEqual([]);
  });
});

describe("haversine", () => {
  it("measures a known distance", () => {
    // Oslo to Bergen, ~305 km apart.
    const d = haversine([59.9139, 10.7522], [60.3913, 5.3221]);
    expect(d).toBeGreaterThan(300_000);
    expect(d).toBeLessThan(310_000);
  });

  it("is zero for the same point", () => {
    expect(haversine([59.9139, 10.7522], [59.9139, 10.7522])).toBe(0);
  });
});
