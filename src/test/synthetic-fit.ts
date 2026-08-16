import { Encoder } from "@garmin/fitsdk";

export type SyntheticOptions = {
  startMs: number;
  durationSec: number;
  sport?: number;
  /** Metres covered per second; 0 produces an indoor-style file with no distance. */
  distancePerSec?: number;
  hr?: number;
  /** Starting altitude in metres; each second climbs by `climbPerSec`. */
  altitude?: number;
  climbPerSec?: number;
  /** Starting GPS position; the track runs due east. */
  lat?: number;
  lon?: number;
};

const DEG_TO_SEMICIRCLE = 2 ** 31 / 180;

/** Builds a minimal but valid activity FIT file for tests. */
export function buildSyntheticFit(opts: SyntheticOptions): Buffer {
  const encoder = new Encoder();
  const start = new Date(opts.startMs);
  const dps = opts.distancePerSec ?? 3;

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

  for (let i = 0; i < opts.durationSec; i++) {
    const record: Record<string, unknown> = {
      mesgNum: 20,
      timestamp: new Date(opts.startMs + i * 1000),
      distance: i * dps,
      heartRate: opts.hr ?? 130,
      speed: dps,
    };
    if (opts.altitude != null) {
      record.altitude = opts.altitude + i * (opts.climbPerSec ?? 0);
    }
    if (opts.lat != null && opts.lon != null) {
      record.positionLat = Math.round(opts.lat * DEG_TO_SEMICIRCLE);
      // ~1e-5 deg of longitude is roughly a metre at these latitudes.
      record.positionLong = Math.round((opts.lon + i * 0.00003) * DEG_TO_SEMICIRCLE);
    }
    encoder.writeMesg(record as never);
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
    totalCalories: 100,
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
