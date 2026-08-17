import { Decoder, Encoder, Stream } from "@garmin/fitsdk";

type AnyMesg = Record<string, unknown> & { mesgNum?: number; timestamp?: Date };

const MESG = {
  FILE_ID: 0,
  FILE_CREATOR: 49,
  ACTIVITY: 34,
  SESSION: 18,
  LAP: 19,
  RECORD: 20,
  EVENT: 21,
  DEVICE_INFO: 23,
  SPORT: 12,
} as const;

type DecodedFile = {
  fileId?: AnyMesg;
  fileCreator?: AnyMesg;
  sport?: AnyMesg;
  deviceInfos: AnyMesg[];
  events: AnyMesg[];
  records: AnyMesg[];
  laps: AnyMesg[];
  session?: AnyMesg;
  activity?: AnyMesg;
};

function decodeFit(buf: Buffer | ArrayBuffer): DecodedFile {
  const stream = Buffer.isBuffer(buf)
    ? Stream.fromBuffer(new Uint8Array(buf))
    : Stream.fromArrayBuffer(buf);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new Error("Not a FIT file");
  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandComponents: true,
    expandSubFields: true,
    convertDateTimesToDates: true,
    mergeHeartRates: true,
  });
  if (errors && errors.length) {
    throw new Error(`FIT decode errors: ${errors.map((e) => e.message).join("; ")}`);
  }

  const m = messages as unknown as {
    fileIdMesgs?: AnyMesg[];
    fileCreatorMesgs?: AnyMesg[];
    sportMesgs?: AnyMesg[];
    deviceInfoMesgs?: AnyMesg[];
    eventMesgs?: AnyMesg[];
    recordMesgs?: AnyMesg[];
    lapMesgs?: AnyMesg[];
    sessionMesgs?: AnyMesg[];
    activityMesgs?: AnyMesg[];
  };

  return {
    fileId: m.fileIdMesgs?.[0],
    fileCreator: m.fileCreatorMesgs?.[0],
    sport: m.sportMesgs?.[0],
    deviceInfos: m.deviceInfoMesgs ?? [],
    events: m.eventMesgs ?? [],
    records: m.recordMesgs ?? [],
    laps: m.lapMesgs ?? [],
    session: m.sessionMesgs?.[0],
    activity: m.activityMesgs?.[0],
  };
}

function tsOf(m: AnyMesg | undefined): number {
  const t = m?.timestamp;
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  return new Date(t as unknown as string).getTime();
}

function withNum(m: AnyMesg, mesgNum: number): AnyMesg {
  return { ...m, mesgNum };
}

function tryWrite(encoder: Encoder, mesg: AnyMesg, label: string): void {
  try {
    encoder.writeMesg(mesg as never);
  } catch (e) {
    const err = e as Error & { cause?: unknown };
    const cause = err.cause as { mesg?: unknown; cause?: { message?: string; cause?: unknown } } | undefined;
    const innerMsg = cause?.cause?.message ?? "unknown";
    const innerCause = cause?.cause?.cause as { value?: unknown; fieldDefinition?: { name?: string; type?: string } } | undefined;
    const field = innerCause?.fieldDefinition?.name;
    const val = innerCause?.value;
    throw new Error(
      `Encoder failed at ${label} (mesgNum=${mesg.mesgNum}, field=${field}, value=${JSON.stringify(val)}): ${innerMsg}`
    );
  }
}

export type MergeOptions = {
  name?: string;
  /** Shift all timestamps in the merged FIT by this many seconds to avoid platform-side duplicate detection. */
  timestampShiftSeconds?: number;
  /**
   * Per-source activity metric overrides, in the same order as `files`. Used when the raw FIT
   * records don't carry distance/speed/etc. (e.g. indoor activities where Garmin computes those
   * server-side). When provided, the merged session/lap totals are summed from these instead of
   * derived from records.
   */
  metricsOverride?: Array<{
    distance?: number;
    duration?: number;
    averageSpeed?: number;
    maxSpeed?: number;
    averageHR?: number;
    maxHR?: number;
    calories?: number;
    elevationGain?: number;
    elevationLoss?: number;
  }>;
};

export type MergeResult = {
  buffer: Buffer;
  startTime: Date;
  endTime: Date;
  recordCount: number;
  totalDistance: number;
  /** Wall-clock span, gaps included. */
  totalElapsed: number;
  /** Time the timer was actually running, gaps excluded. */
  totalTimerTime: number;
  /** One entry per source that contributed records, in chronological order. */
  segments: Array<{ startTime: Date; endTime: Date; timerTime: number; distance: number }>;
};

export function mergeFitFilesWithMeta(
  files: (Buffer | ArrayBuffer)[],
  opts: MergeOptions = {}
): MergeResult {
  const out = mergeFitFilesInternal(files, opts);
  return out;
}

export function mergeFitFiles(files: (Buffer | ArrayBuffer)[], opts: MergeOptions = {}): Buffer {
  return mergeFitFilesInternal(files, opts).buffer;
}

function mergeFitFilesInternal(files: (Buffer | ArrayBuffer)[], opts: MergeOptions = {}): MergeResult {
  if (files.length < 2) throw new Error("Need at least 2 files to merge");
  const decoded = files.map(decodeFit);

  decoded.sort((a, b) => tsOf(a.records[0]) - tsOf(b.records[0]));

  const base = decoded[0];
  const shiftMs = (opts.timestampShiftSeconds ?? 0) * 1000;
  const shiftTs = (d: Date): Date => (shiftMs === 0 ? d : new Date(d.getTime() + shiftMs));
  const shiftMesgTs = (m: AnyMesg): AnyMesg => {
    if (shiftMs === 0) return m;
    const t = m.timestamp;
    if (t instanceof Date) return { ...m, timestamp: shiftTs(t) };
    return m;
  };

  const allRecords: Array<{ mesg: AnyMesg; source: number }> = [];
  let distanceOffset = 0;
  let lastRecordDistance = 0;
  for (let i = 0; i < decoded.length; i++) {
    const file = decoded[i];
    if (file.records.length === 0) continue;
    const firstD = (file.records[0]?.distance as number | undefined) ?? 0;
    for (const r of file.records) {
      const rawD = (r.distance as number | undefined) ?? 0;
      const adjustedD = rawD - firstD + distanceOffset;
      allRecords.push({ mesg: shiftMesgTs({ ...r, distance: adjustedD }), source: i });
      lastRecordDistance = adjustedD;
    }
    distanceOffset = lastRecordDistance;
  }
  allRecords.sort((a, b) => tsOf(a.mesg) - tsOf(b.mesg));

  const deduped: Array<{ mesg: AnyMesg; source: number }> = [];
  let lastTs = -Infinity;
  for (const entry of allRecords) {
    const t = tsOf(entry.mesg);
    if (t <= lastTs) continue;
    deduped.push(entry);
    lastTs = t;
  }
  const dedupedRecords = deduped.map((e) => e.mesg);

  /*
   * One segment per source, so the stretch between them can be written as a
   * pause. Without the stop/start pair around each segment Garmin counts the
   * unrecorded gap as moving time and every pace/speed average comes out wrong.
   */
  const segments = buildSegments(deduped);

  const firstTs = dedupedRecords.length > 0 ? new Date(tsOf(dedupedRecords[0])) : new Date();
  const lastTs2 = dedupedRecords.length > 0 ? new Date(tsOf(dedupedRecords.at(-1)!)) : firstTs;
  const totalElapsed = (lastTs2.getTime() - firstTs.getTime()) / 1000;
  const totalTimerTime = Math.min(
    totalElapsed,
    segments.reduce((sum, seg) => sum + seg.timerTime, 0)
  );

  let totalDistance = 0;
  let totalCalories = 0;
  let avgHrSum = 0;
  let avgHrCount = 0;
  let maxHr = 0;
  let maxSpeed = 0;
  let totalAscent = 0;
  let totalDescent = 0;
  let lastAlt: number | null = null;
  for (const r of dedupedRecords) {
    const d = r.distance as number | undefined;
    if (d != null) totalDistance = d;
    const hr = r.heartRate as number | undefined;
    if (hr) {
      avgHrSum += hr;
      avgHrCount += 1;
      if (hr > maxHr) maxHr = hr;
    }
    const sp = r.speed as number | undefined;
    if (sp != null && sp > maxSpeed) maxSpeed = sp;
    const alt = r.altitude as number | undefined;
    if (alt != null) {
      if (lastAlt != null) {
        const diff = alt - lastAlt;
        if (diff > 0) totalAscent += diff;
        else totalDescent += -diff;
      }
      lastAlt = alt;
    }
  }

  let avgHr = avgHrCount > 0 ? Math.round(avgHrSum / avgHrCount) : undefined;
  // Average speed is distance over *moving* time, never over the paused gaps.
  let avgSpeed = totalTimerTime > 0 && totalDistance > 0 ? totalDistance / totalTimerTime : undefined;

  for (const file of decoded) {
    totalCalories += (file.session?.totalCalories as number | undefined) ?? 0;
  }

  const overrides = opts.metricsOverride;
  if (overrides && overrides.length === files.length) {
    const overrideDistance = overrides.reduce((s, m) => s + (m.distance ?? 0), 0);
    const overrideCalories = overrides.reduce((s, m) => s + (m.calories ?? 0), 0);
    if (totalDistance <= 0 && overrideDistance > 0) {
      totalDistance = overrideDistance;
      avgSpeed = totalTimerTime > 0 ? totalDistance / totalTimerTime : avgSpeed;
    }
    if (totalCalories <= 0 && overrideCalories > 0) totalCalories = overrideCalories;
    if (!maxSpeed) {
      const m = Math.max(...overrides.map((o) => o.maxSpeed ?? 0));
      if (m > 0) maxSpeed = m;
    }
    if (!maxHr) {
      const m = Math.max(...overrides.map((o) => o.maxHR ?? 0));
      if (m > 0) maxHr = m;
    }
    if (avgHr == null) {
      const list = overrides.map((o) => o.averageHR).filter((v): v is number => typeof v === "number" && v > 0);
      if (list.length > 0) avgHr = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
    }
    if (!totalAscent) {
      const a = overrides.reduce((s, m) => s + (m.elevationGain ?? 0), 0);
      if (a > 0) totalAscent = a;
    }
    if (!totalDescent) {
      const a = overrides.reduce((s, m) => s + (m.elevationLoss ?? 0), 0);
      if (a > 0) totalDescent = a;
    }
  }

  const sport = (base.session?.sport as number | undefined) ?? (base.sport?.sport as number | undefined);
  const subSport = (base.session?.subSport as number | undefined) ?? (base.sport?.subSport as number | undefined);

  const encoder = new Encoder();

  const freshSerial = Math.floor(Math.random() * 0xfffffffe) + 1;
  if (base.fileId) {
    tryWrite(
      encoder,
      withNum(
        { ...base.fileId, timeCreated: firstTs, type: 4, serialNumber: freshSerial },
        MESG.FILE_ID
      ),
      "file_id"
    );
  } else {
    tryWrite(
      encoder,
      withNum(
        { type: 4, manufacturer: 255, timeCreated: firstTs, serialNumber: freshSerial },
        MESG.FILE_ID
      ),
      "file_id"
    );
  }

  if (base.fileCreator) {
    tryWrite(encoder, withNum(base.fileCreator, MESG.FILE_CREATOR), "file_creator");
  }

  for (let i = 0; i < base.deviceInfos.length; i++) {
    tryWrite(encoder, withNum(base.deviceInfos[i], MESG.DEVICE_INFO), `device_info[${i}]`);
  }

  /*
   * Each segment gets its own timer start / stop_all pair and its own lap, so
   * the merged file reads exactly like an activity that was paused: Garmin
   * excludes the gaps from moving time, and the lap list still shows where each
   * original recording began and ended.
   */
  let recordIndex = 0;
  segments.forEach((segment, segIndex) => {
    tryWrite(
      encoder,
      withNum(
        { timestamp: segment.startTime, event: 0, eventType: 0, eventGroup: 0 },
        MESG.EVENT
      ),
      `event(start)[${segIndex}]`
    );

    for (const record of segment.records) {
      tryWrite(encoder, withNum(record, MESG.RECORD), `record[${recordIndex++}]`);
    }

    tryWrite(
      encoder,
      withNum(
        { timestamp: segment.endTime, event: 0, eventType: 4, eventGroup: 0 },
        MESG.EVENT
      ),
      `event(stop)[${segIndex}]`
    );

    const stats = summarize(segment.records);
    const lap: AnyMesg = {
      timestamp: segment.endTime,
      startTime: segment.startTime,
      totalElapsedTime: segment.timerTime,
      totalTimerTime: segment.timerTime,
      totalDistance: stats.distance,
      avgHeartRate: stats.avgHr,
      maxHeartRate: stats.maxHr || undefined,
      avgSpeed: segment.timerTime > 0 && stats.distance > 0 ? stats.distance / segment.timerTime : undefined,
      maxSpeed: stats.maxSpeed || undefined,
      totalAscent: Math.round(stats.ascent) || undefined,
      totalDescent: Math.round(stats.descent) || undefined,
      sport,
      subSport,
      event: 9,
      eventType: 1,
      lapTrigger: segIndex === segments.length - 1 ? 7 : 0,
      messageIndex: segIndex,
    };
    tryWrite(encoder, withNum(lap, MESG.LAP), `lap[${segIndex}]`);
  });

  const session: AnyMesg = {
    timestamp: lastTs2,
    startTime: firstTs,
    sport,
    subSport,
    totalElapsedTime: totalElapsed,
    totalTimerTime,
    totalDistance,
    totalCalories: totalCalories || undefined,
    avgHeartRate: avgHr,
    maxHeartRate: maxHr || undefined,
    avgSpeed,
    maxSpeed: maxSpeed || undefined,
    totalAscent: Math.round(totalAscent) || undefined,
    totalDescent: Math.round(totalDescent) || undefined,
    firstLapIndex: 0,
    numLaps: segments.length,
    event: 8,
    eventType: 1,
    trigger: 0,
    messageIndex: 0,
  };
  tryWrite(encoder, withNum(session, MESG.SESSION), "session");

  const activity: AnyMesg = {
    timestamp: lastTs2,
    totalTimerTime,
    numSessions: 1,
    type: 0,
    event: 26,
    eventType: 1,
  };
  tryWrite(encoder, withNum(activity, MESG.ACTIVITY), "activity");

  if (opts.name) {
    // name reserved for future use (Strava handles name on upload)
  }

  const out = encoder.close();
  return {
    buffer: Buffer.from(out),
    startTime: firstTs,
    endTime: lastTs2,
    recordCount: dedupedRecords.length,
    totalDistance,
    totalElapsed,
    totalTimerTime,
    segments: segments.map((seg) => ({
      startTime: seg.startTime,
      endTime: seg.endTime,
      timerTime: seg.timerTime,
      distance: summarize(seg.records).distance,
    })),
  };
}

type Segment = {
  records: AnyMesg[];
  startTime: Date;
  endTime: Date;
  /** Seconds the timer ran for this segment. */
  timerTime: number;
};

/** Groups deduplicated records back into one segment per source recording. */
function buildSegments(entries: Array<{ mesg: AnyMesg; source: number }>): Segment[] {
  const bySource = new Map<number, AnyMesg[]>();
  for (const entry of entries) {
    const list = bySource.get(entry.source);
    if (list) list.push(entry.mesg);
    else bySource.set(entry.source, [entry.mesg]);
  }

  return Array.from(bySource.values())
    .filter((records) => records.length > 0)
    .map((records) => {
      const startTime = new Date(tsOf(records[0]));
      const endTime = new Date(tsOf(records[records.length - 1]));
      return {
        records,
        startTime,
        endTime,
        timerTime: (endTime.getTime() - startTime.getTime()) / 1000,
      };
    })
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

type SegmentStats = {
  distance: number;
  avgHr?: number;
  maxHr: number;
  maxSpeed: number;
  ascent: number;
  descent: number;
};

function summarize(records: AnyMesg[]): SegmentStats {
  let firstDistance: number | null = null;
  let lastDistance = 0;
  let hrSum = 0;
  let hrCount = 0;
  let maxHr = 0;
  let maxSpeed = 0;
  let ascent = 0;
  let descent = 0;
  let lastAlt: number | null = null;

  for (const r of records) {
    const d = r.distance as number | undefined;
    if (d != null) {
      if (firstDistance == null) firstDistance = d;
      lastDistance = d;
    }
    const hr = r.heartRate as number | undefined;
    if (hr) {
      hrSum += hr;
      hrCount++;
      if (hr > maxHr) maxHr = hr;
    }
    const sp = r.speed as number | undefined;
    if (sp != null && sp > maxSpeed) maxSpeed = sp;
    const alt = r.altitude as number | undefined;
    if (alt != null) {
      if (lastAlt != null) {
        const diff = alt - lastAlt;
        if (diff > 0) ascent += diff;
        else descent -= diff;
      }
      lastAlt = alt;
    }
  }

  return {
    distance: firstDistance == null ? 0 : lastDistance - firstDistance,
    avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : undefined,
    maxHr,
    maxSpeed,
    ascent,
    descent,
  };
}
