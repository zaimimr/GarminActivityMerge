import { describe, it, expect } from "vitest";
import { Decoder, Stream } from "@garmin/fitsdk";
import { mergeFitFilesWithMeta } from "./fit-merge";
import { buildSyntheticFit } from "@/test/synthetic-fit";

function decode(buf: Buffer): ReturnType<Decoder["read"]> {
  const stream = Stream.fromBuffer(new Uint8Array(buf));
  return new Decoder(stream).read({ convertDateTimesToDates: true });
}

describe("mergeFitFiles", () => {
  it("concats records from two sequential FITs and recomputes distance", () => {
    const t1 = Date.UTC(2024, 0, 1, 10, 0, 0);
    const t2 = Date.UTC(2024, 0, 1, 10, 0, 30);
    const a = buildSyntheticFit({ startMs: t1, durationSec: 30, distancePerSec: 3 });
    const b = buildSyntheticFit({ startMs: t2, durationSec: 30, distancePerSec: 3 });

    const merged = mergeFitFilesWithMeta([a, b]);
    expect(merged.recordCount).toBe(60);
    expect(merged.totalDistance).toBeGreaterThan(170);
    expect(merged.startTime.getTime()).toBe(t1);

    const out = decode(merged.buffer) as unknown as { messages: { recordMesgs?: Array<{ distance?: number }>; sessionMesgs?: Array<{ totalDistance?: number }> } };
    const records = out.messages.recordMesgs ?? [];
    expect(records.length).toBe(60);
    const lastDist = records[records.length - 1].distance ?? 0;
    expect(lastDist).toBeGreaterThan(170);
  });

  it("dedups records that share a timestamp", () => {
    const t1 = Date.UTC(2024, 0, 1, 10, 0, 0);
    const a = buildSyntheticFit({ startMs: t1, durationSec: 30 });
    const b = buildSyntheticFit({ startMs: t1 + 15_000, durationSec: 30 });

    const merged = mergeFitFilesWithMeta([a, b]);
    expect(merged.recordCount).toBeLessThan(60);
    expect(merged.recordCount).toBeGreaterThanOrEqual(45);
  });

  it("uses metricsOverride distance when records are zero", () => {
    const t1 = Date.UTC(2024, 0, 1, 10, 0, 0);
    const t2 = Date.UTC(2024, 0, 1, 10, 0, 30);
    const a = buildSyntheticFit({ startMs: t1, durationSec: 30, distancePerSec: 0 });
    const b = buildSyntheticFit({ startMs: t2, durationSec: 30, distancePerSec: 0 });

    const merged = mergeFitFilesWithMeta([a, b], {
      metricsOverride: [
        { distance: 5000 },
        { distance: 3000 },
      ],
    });
    expect(merged.totalDistance).toBe(8000);
  });

  it("rejects with <2 files", () => {
    const t1 = Date.UTC(2024, 0, 1, 10, 0, 0);
    const a = buildSyntheticFit({ startMs: t1, durationSec: 30 });
    expect(() => mergeFitFilesWithMeta([a])).toThrow();
  });
});

describe("gap handling", () => {
  const T0 = Date.UTC(2024, 0, 1, 10, 0, 0);

  function decodeMerged(buf: Buffer) {
    return decode(buf) as unknown as {
      messages: {
        // The SDK decodes enum fields to their names, not their raw numbers.
        eventMesgs?: Array<{ event?: string; eventType?: string; timestamp?: Date }>;
        lapMesgs?: Array<{ totalTimerTime?: number; totalDistance?: number; messageIndex?: number }>;
        sessionMesgs?: Array<{
          totalTimerTime?: number;
          totalElapsedTime?: number;
          numLaps?: number;
          avgSpeed?: number;
        }>;
      };
    };
  }

  it("writes the unrecorded gap as a pause instead of moving time", () => {
    // 10 min of riding, an hour of nothing, then 10 more minutes.
    const a = buildSyntheticFit({ startMs: T0, durationSec: 600, distancePerSec: 8 });
    const b = buildSyntheticFit({ startMs: T0 + 4200_000, durationSec: 600, distancePerSec: 8 });

    const merged = mergeFitFilesWithMeta([a, b]);
    const session = decodeMerged(merged.buffer).messages.sessionMesgs?.[0];

    // Wall clock spans the gap...
    expect(merged.totalElapsed).toBe(4799);
    expect(session?.totalElapsedTime).toBe(4799);
    // ...but the timer only counts the two recordings.
    expect(merged.totalTimerTime).toBe(1198);
    expect(session?.totalTimerTime).toBe(1198);
  });

  it("derives average speed from moving time, not elapsed time", () => {
    const a = buildSyntheticFit({ startMs: T0, durationSec: 600, distancePerSec: 8 });
    const b = buildSyntheticFit({ startMs: T0 + 4200_000, durationSec: 600, distancePerSec: 8 });

    const session = decodeMerged(mergeFitFilesWithMeta([a, b]).buffer).messages.sessionMesgs?.[0];

    // Riding at 8 m/s throughout, so the average must stay ~8 m/s and not be
    // dragged down to ~2 m/s by the hour of standing around.
    expect(session?.avgSpeed).toBeGreaterThan(7.5);
    expect(session?.avgSpeed).toBeLessThan(8.5);
  });

  it("brackets every segment with a timer start and stop", () => {
    const a = buildSyntheticFit({ startMs: T0, durationSec: 300 });
    const b = buildSyntheticFit({ startMs: T0 + 1800_000, durationSec: 300 });

    const events = decodeMerged(mergeFitFilesWithMeta([a, b]).buffer).messages.eventMesgs ?? [];
    const timerEvents = events.filter((e) => e.event === "timer");
    const starts = timerEvents.filter((e) => e.eventType === "start");
    const stops = timerEvents.filter((e) => e.eventType === "stopAll");

    expect(starts).toHaveLength(2);
    expect(stops).toHaveLength(2);
    expect(timerEvents.map((e) => e.eventType)).toEqual(["start", "stopAll", "start", "stopAll"]);
    // The pause sits between the first stop and the second start.
    expect(starts[1].timestamp!.getTime() - stops[0].timestamp!.getTime()).toBe(1800_000 - 299_000);
  });

  it("emits one lap per source recording", () => {
    const a = buildSyntheticFit({ startMs: T0, durationSec: 300, distancePerSec: 3 });
    const b = buildSyntheticFit({ startMs: T0 + 1800_000, durationSec: 600, distancePerSec: 3 });

    const decoded = decodeMerged(mergeFitFilesWithMeta([a, b]).buffer);
    const laps = decoded.messages.lapMesgs ?? [];

    expect(laps).toHaveLength(2);
    expect(decoded.messages.sessionMesgs?.[0]?.numLaps).toBe(2);
    expect(laps[0].messageIndex).toBe(0);
    expect(laps[1].messageIndex).toBe(1);
    expect(laps[0].totalTimerTime).toBe(299);
    expect(laps[1].totalTimerTime).toBe(599);
    // Lap distances are per-lap, not cumulative.
    expect(laps[0].totalDistance).toBeCloseTo(299 * 3, 0);
    expect(laps[1].totalDistance).toBeCloseTo(599 * 3, 0);
  });

  it("keeps timer time equal to elapsed when the recordings are contiguous", () => {
    const a = buildSyntheticFit({ startMs: T0, durationSec: 300 });
    const b = buildSyntheticFit({ startMs: T0 + 300_000, durationSec: 300 });

    const merged = mergeFitFilesWithMeta([a, b]);
    expect(merged.totalElapsed - merged.totalTimerTime).toBeLessThanOrEqual(1);
  });
});
