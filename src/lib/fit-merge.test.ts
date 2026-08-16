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
