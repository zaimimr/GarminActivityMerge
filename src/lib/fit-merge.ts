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

  const allRecords: AnyMesg[] = [];
  let distanceOffset = 0;
  let lastRecordDistance = 0;
  for (const file of decoded) {
    if (file.records.length === 0) continue;
    const firstD = (file.records[0]?.distance as number | undefined) ?? 0;
    for (const r of file.records) {
      const rawD = (r.distance as number | undefined) ?? 0;
      const adjustedD = rawD - firstD + distanceOffset;
      allRecords.push(shiftMesgTs({ ...r, distance: adjustedD }));
      lastRecordDistance = adjustedD;
    }
    distanceOffset = lastRecordDistance;
  }
  allRecords.sort((a, b) => tsOf(a) - tsOf(b));

  const dedupedRecords: AnyMesg[] = [];
  let lastTs = -Infinity;
  for (const r of allRecords) {
    const t = tsOf(r);
    if (t <= lastTs) continue;
    dedupedRecords.push(r);
    lastTs = t;
  }

  const firstTs = dedupedRecords.length > 0 ? new Date(tsOf(dedupedRecords[0])) : new Date();
  const lastTs2 = dedupedRecords.length > 0 ? new Date(tsOf(dedupedRecords.at(-1)!)) : firstTs;
  const totalElapsed = (lastTs2.getTime() - firstTs.getTime()) / 1000;

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
  let avgSpeed = totalElapsed > 0 && totalDistance > 0 ? totalDistance / totalElapsed : undefined;

  for (const file of decoded) {
    totalCalories += (file.session?.totalCalories as number | undefined) ?? 0;
  }

  const overrides = opts.metricsOverride;
  if (overrides && overrides.length === files.length) {
    const overrideDistance = overrides.reduce((s, m) => s + (m.distance ?? 0), 0);
    const overrideCalories = overrides.reduce((s, m) => s + (m.calories ?? 0), 0);
    if (totalDistance <= 0 && overrideDistance > 0) {
      totalDistance = overrideDistance;
      avgSpeed = totalElapsed > 0 ? totalDistance / totalElapsed : avgSpeed;
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

  tryWrite(
    encoder,
    withNum({ timestamp: firstTs, event: 0, eventType: 0, eventGroup: 0 }, MESG.EVENT),
    "event(start)"
  );

  for (let i = 0; i < dedupedRecords.length; i++) {
    tryWrite(encoder, withNum(dedupedRecords[i], MESG.RECORD), `record[${i}]`);
  }

  tryWrite(
    encoder,
    withNum({ timestamp: lastTs2, event: 0, eventType: 4, eventGroup: 0 }, MESG.EVENT),
    "event(stop)"
  );

  const lap: AnyMesg = {
    timestamp: lastTs2,
    startTime: firstTs,
    totalElapsedTime: totalElapsed,
    totalTimerTime: totalElapsed,
    totalDistance,
    totalCalories: totalCalories || undefined,
    avgHeartRate: avgHr,
    maxHeartRate: maxHr || undefined,
    avgSpeed,
    maxSpeed: maxSpeed || undefined,
    totalAscent: Math.round(totalAscent) || undefined,
    totalDescent: Math.round(totalDescent) || undefined,
    sport,
    subSport,
    event: 9,
    eventType: 1,
    lapTrigger: 7,
    messageIndex: 0,
  };
  tryWrite(encoder, withNum(lap, MESG.LAP), "lap");

  const session: AnyMesg = {
    timestamp: lastTs2,
    startTime: firstTs,
    sport,
    subSport,
    totalElapsedTime: totalElapsed,
    totalTimerTime: totalElapsed,
    totalDistance,
    totalCalories: totalCalories || undefined,
    avgHeartRate: avgHr,
    maxHeartRate: maxHr || undefined,
    avgSpeed,
    maxSpeed: maxSpeed || undefined,
    totalAscent: Math.round(totalAscent) || undefined,
    totalDescent: Math.round(totalDescent) || undefined,
    firstLapIndex: 0,
    numLaps: 1,
    event: 8,
    eventType: 1,
    trigger: 0,
    messageIndex: 0,
  };
  tryWrite(encoder, withNum(session, MESG.SESSION), "session");

  const activity: AnyMesg = {
    timestamp: lastTs2,
    totalTimerTime: totalElapsed,
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
  };
}
