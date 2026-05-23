import { describe, it, expect } from "vitest";
import { Decoder, Encoder, Stream } from "@garmin/fitsdk";
import { mergeFitFilesWithMeta } from "./fit-merge";

function buildSyntheticFit(opts: {
  startMs: number;
  durationSec: number;
  sport?: number;
  distancePerSec?: number;
  hr?: number;
}): Buffer {
  const encoder = new Encoder();
  const start = new Date(opts.startMs);

  encoder.writeMesg({
    mesgNum: 0,
    type: 4,
    manufacturer: 255,
    timeCreated: start,
    serialNumber: 12345,
  } as never);

  encoder.writeMesg({
    mesgNum: 21,
    timestamp: start,
    event: 0,
    eventType: 0,
    eventGroup: 0,
  } as never);

  const dps = opts.distancePerSec ?? 3;
  for (let i = 0; i < opts.durationSec; i++) {
    encoder.writeMesg({
      mesgNum: 20,
      timestamp: new Date(opts.startMs + i * 1000),
      distance: i * dps,
      heartRate: opts.hr ?? 130,
      speed: dps,
    } as never);
  }

  const last = new Date(opts.startMs + (opts.durationSec - 1) * 1000);
  encoder.writeMesg({
    mesgNum: 21,
    timestamp: last,
    event: 0,
    eventType: 4,
    eventGroup: 0,
  } as never);

  encoder.writeMesg({
    mesgNum: 18,
    timestamp: last,
    startTime: start,
    totalElapsedTime: opts.durationSec,
    totalTimerTime: opts.durationSec,
    totalDistance: (opts.durationSec - 1) * dps,
    sport: opts.sport ?? 1,
    subSport: 0,
    event: 8,
    eventType: 1,
    messageIndex: 0,
  } as never);

  encoder.writeMesg({
    mesgNum: 34,
    timestamp: last,
    totalTimerTime: opts.durationSec,
    numSessions: 1,
    type: 0,
    event: 26,
    eventType: 1,
  } as never);

  return Buffer.from(encoder.close());
}

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
