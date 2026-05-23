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

export type MergeOptions = {
  name?: string;
};

export function mergeFitFiles(files: (Buffer | ArrayBuffer)[], opts: MergeOptions = {}): Buffer {
  if (files.length < 2) throw new Error("Need at least 2 files to merge");
  const decoded = files.map(decodeFit);

  decoded.sort((a, b) => tsOf(a.records[0]) - tsOf(b.records[0]));

  const base = decoded[0];

  const allRecords: AnyMesg[] = [];
  let distanceOffset = 0;
  let lastRecordDistance = 0;
  for (const file of decoded) {
    if (file.records.length === 0) continue;
    const firstD = (file.records[0]?.distance as number | undefined) ?? 0;
    for (const r of file.records) {
      const rawD = (r.distance as number | undefined) ?? 0;
      const adjustedD = rawD - firstD + distanceOffset;
      allRecords.push({ ...r, distance: adjustedD });
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

  const avgHr = avgHrCount > 0 ? Math.round(avgHrSum / avgHrCount) : undefined;
  const avgSpeed = totalElapsed > 0 ? totalDistance / totalElapsed : undefined;

  for (const file of decoded) {
    totalCalories += (file.session?.totalCalories as number | undefined) ?? 0;
  }

  const sport = (base.session?.sport as number | undefined) ?? (base.sport?.sport as number | undefined);
  const subSport = (base.session?.subSport as number | undefined) ?? (base.sport?.subSport as number | undefined);

  const encoder = new Encoder();

  if (base.fileId) {
    encoder.writeMesg(
      withNum(
        {
          ...base.fileId,
          timeCreated: firstTs,
          type: 4,
        },
        MESG.FILE_ID
      ) as never
    );
  } else {
    encoder.writeMesg(
      withNum({ type: 4, manufacturer: 255, timeCreated: firstTs }, MESG.FILE_ID) as never
    );
  }

  if (base.fileCreator) {
    encoder.writeMesg(withNum(base.fileCreator, MESG.FILE_CREATOR) as never);
  }

  for (const dev of base.deviceInfos) {
    encoder.writeMesg(withNum(dev, MESG.DEVICE_INFO) as never);
  }

  encoder.writeMesg(
    withNum(
      {
        timestamp: firstTs,
        event: 0,
        eventType: 0,
        eventGroup: 0,
      },
      MESG.EVENT
    ) as never
  );

  for (const r of dedupedRecords) {
    encoder.writeMesg(withNum(r, MESG.RECORD) as never);
  }

  encoder.writeMesg(
    withNum(
      {
        timestamp: lastTs2,
        event: 0,
        eventType: 4,
        eventGroup: 0,
      },
      MESG.EVENT
    ) as never
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
  encoder.writeMesg(withNum(lap, MESG.LAP) as never);

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
  encoder.writeMesg(withNum(session, MESG.SESSION) as never);

  const activity: AnyMesg = {
    timestamp: lastTs2,
    totalTimerTime: totalElapsed,
    numSessions: 1,
    type: 0,
    event: 26,
    eventType: 1,
    localTimestamp: lastTs2,
  };
  encoder.writeMesg(withNum(activity, MESG.ACTIVITY) as never);

  if (opts.name) {
    // name reserved for future use (Strava handles name on upload)
  }

  const out = encoder.close();
  return Buffer.from(out);
}
