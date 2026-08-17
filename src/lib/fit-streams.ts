import { Decoder, Stream } from "@garmin/fitsdk";

const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

export type StreamPoint = {
  /** Seconds since the start of this activity. */
  t: number;
  /** Cumulative distance in metres. */
  d: number;
  alt?: number;
  hr?: number;
  /** Metres per second. */
  speed?: number;
};

export type Totals = {
  distance: number;
  elapsed: number;
  /** Time the recording timer ran, excluding paused gaps. From the FIT session. */
  timerTime: number;
  movingTime: number;
  avgHr?: number;
  maxHr?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  ascent: number;
  descent: number;
  calories?: number;
};

export type ActivityStreams = {
  startTime: string;
  endTime: string;
  recordCount: number;
  points: StreamPoint[];
  /** [lat, lon] pairs, downsampled, empty for indoor activities. */
  track: [number, number][];
  totals: Totals;
  sport?: number;
};

type RawRecord = {
  ts: number;
  d?: number;
  alt?: number;
  hr?: number;
  speed?: number;
  lat?: number;
  lon?: number;
};

const MAX_POINTS = 600;
const MAX_TRACK_POINTS = 800;
/** Below this speed we treat the athlete as stopped, matching Garmin's default. */
const MOVING_SPEED_THRESHOLD = 0.5;

export function decodeStreams(buf: Buffer | ArrayBuffer): ActivityStreams {
  const stream = Buffer.isBuffer(buf)
    ? Stream.fromBuffer(new Uint8Array(buf))
    : Stream.fromArrayBuffer(buf);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new Error("Not a FIT file");

  const { messages } = decoder.read({
    applyScaleAndOffset: true,
    expandComponents: true,
    expandSubFields: true,
    convertDateTimesToDates: true,
    mergeHeartRates: true,
  });

  const m = messages as unknown as {
    recordMesgs?: Record<string, unknown>[];
    sessionMesgs?: Record<string, unknown>[];
    sportMesgs?: Record<string, unknown>[];
  };
  const session = m.sessionMesgs?.[0];
  const records = (m.recordMesgs ?? [])
    .map(toRaw)
    .filter((r): r is RawRecord => r !== null)
    .sort((a, b) => a.ts - b.ts);

  if (records.length === 0) {
    throw new Error("FIT file has no track records");
  }

  const startMs = records[0].ts;
  const endMs = records[records.length - 1].ts;
  const totals = computeTotals(records, session);

  return {
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    recordCount: records.length,
    points: downsample(records, MAX_POINTS).map((r) => ({
      t: Math.round((r.ts - startMs) / 1000),
      d: round(r.d ?? 0, 1),
      alt: r.alt != null ? round(r.alt, 1) : undefined,
      hr: r.hr,
      speed: r.speed != null ? round(r.speed, 3) : undefined,
    })),
    track: downsample(
      records.filter((r) => r.lat != null && r.lon != null),
      MAX_TRACK_POINTS
    ).map((r) => [round(r.lat as number, 5), round(r.lon as number, 5)] as [number, number]),
    totals,
    sport: (session?.sport as number | undefined) ?? (m.sportMesgs?.[0]?.sport as number | undefined),
  };
}

function toRaw(r: Record<string, unknown>): RawRecord | null {
  const ts = r.timestamp;
  const ms = ts instanceof Date ? ts.getTime() : new Date(String(ts)).getTime();
  if (!Number.isFinite(ms)) return null;

  const latRaw = (r.positionLat ?? r.position_lat) as number | undefined;
  const lonRaw = (r.positionLong ?? r.position_long) as number | undefined;

  return {
    ts: ms,
    d: num(r.distance),
    alt: num(r.enhancedAltitude) ?? num(r.altitude),
    hr: num(r.heartRate),
    speed: num(r.enhancedSpeed) ?? num(r.speed),
    lat: latRaw != null ? latRaw * SEMICIRCLE_TO_DEG : undefined,
    lon: lonRaw != null ? lonRaw * SEMICIRCLE_TO_DEG : undefined,
  };
}

function computeTotals(records: RawRecord[], session?: Record<string, unknown>): Totals {
  const elapsed = (records[records.length - 1].ts - records[0].ts) / 1000;

  let distance = 0;
  let hrSum = 0;
  let hrCount = 0;
  let maxHr = 0;
  let maxSpeed = 0;
  let ascent = 0;
  let descent = 0;
  let movingTime = 0;
  let lastAlt: number | null = null;
  let lastTs = records[0].ts;

  for (const r of records) {
    if (r.d != null) distance = r.d;
    if (r.hr) {
      hrSum += r.hr;
      hrCount++;
      if (r.hr > maxHr) maxHr = r.hr;
    }
    if (r.speed != null && r.speed > maxSpeed) maxSpeed = r.speed;

    const dt = (r.ts - lastTs) / 1000;
    // Ignore long stretches: those are pauses, not slow running.
    if (dt > 0 && dt <= 10 && (r.speed ?? 0) >= MOVING_SPEED_THRESHOLD) movingTime += dt;
    lastTs = r.ts;

    // 1 m of jitter per sample would otherwise add hundreds of metres of "climb".
    if (r.alt != null) {
      if (lastAlt != null) {
        const diff = r.alt - lastAlt;
        if (Math.abs(diff) >= 1) {
          if (diff > 0) ascent += diff;
          else descent -= diff;
          lastAlt = r.alt;
        }
      } else {
        lastAlt = r.alt;
      }
    }
  }

  const sessionTimer = num(session?.totalTimerTime);

  return {
    distance: round(distance, 1),
    elapsed: Math.round(elapsed),
    // The session's own timer time is authoritative; the speed-based estimate is
    // only a fallback for files that don't carry one.
    timerTime: Math.round(sessionTimer ?? movingTime),
    movingTime: Math.round(movingTime),
    avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : undefined,
    maxHr: maxHr || undefined,
    avgSpeed: elapsed > 0 && distance > 0 ? round(distance / elapsed, 3) : undefined,
    maxSpeed: maxSpeed ? round(maxSpeed, 3) : undefined,
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    calories: num(session?.totalCalories),
  };
}

/** Evenly-spaced sampling that always keeps the first and last point. */
function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const stride = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(items[Math.round(i * stride)]);
  }
  return out;
}

export type Gap = {
  /** Index of the earlier activity in the sorted list. */
  fromIndex: number;
  toIndex: number;
  /** Seconds of unrecorded time between the two activities. */
  timeSec: number;
  /** Straight-line metres between the last and first GPS fix, if both exist. */
  distanceM: number | null;
  /** True when the second activity starts before the first one ends. */
  overlapping: boolean;
};

/** Describes what the merge bridges: the unrecorded stretch between each pair. */
export function analyzeGaps(streams: ActivityStreams[]): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 0; i < streams.length - 1; i++) {
    const a = streams[i];
    const b = streams[i + 1];
    const timeSec = Math.round(
      (new Date(b.startTime).getTime() - new Date(a.endTime).getTime()) / 1000
    );
    const aEnd = a.track[a.track.length - 1];
    const bStart = b.track[0];
    gaps.push({
      fromIndex: i,
      toIndex: i + 1,
      timeSec,
      distanceM: aEnd && bStart ? Math.round(haversine(aEnd, bStart)) : null,
      overlapping: timeSec < 0,
    });
  }
  return gaps;
}

export function haversine([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
