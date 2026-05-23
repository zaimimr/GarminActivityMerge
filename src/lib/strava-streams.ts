import { Encoder } from "@garmin/fitsdk";
import { getStravaToken } from "./strava";

const STRAVA_API = "https://www.strava.com/api/v3";
const STREAM_KEYS = [
  "time",
  "distance",
  "latlng",
  "altitude",
  "heartrate",
  "velocity_smooth",
  "cadence",
  "watts",
  "temp",
];

type StreamSet = {
  time?: { data: number[] };
  distance?: { data: number[] };
  latlng?: { data: [number, number][] };
  altitude?: { data: number[] };
  heartrate?: { data: number[] };
  velocity_smooth?: { data: number[] };
  cadence?: { data: number[] };
  watts?: { data: number[] };
};

type StravaActivityDetail = {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  start_date: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number;
  max_speed?: number;
  average_cadence?: number;
  calories?: number;
};

const SPORT_MAP: Record<string, { sport: number; subSport: number }> = {
  Run: { sport: 1, subSport: 0 },
  TrailRun: { sport: 1, subSport: 8 },
  Ride: { sport: 2, subSport: 0 },
  VirtualRide: { sport: 2, subSport: 6 },
  EBikeRide: { sport: 2, subSport: 0 },
  Walk: { sport: 11, subSport: 0 },
  Hike: { sport: 17, subSport: 0 },
  Swim: { sport: 5, subSport: 0 },
  NordicSki: { sport: 12, subSport: 0 },
  AlpineSki: { sport: 13, subSport: 0 },
  Workout: { sport: 10, subSport: 0 },
  WeightTraining: { sport: 10, subSport: 20 },
};

export async function fetchStravaStreams(userId: string, activityId: number): Promise<StreamSet> {
  const tok = await getStravaToken(userId);
  if (!tok) throw new Error("Strava not connected");
  const u = new URL(`${STRAVA_API}/activities/${activityId}/streams`);
  u.searchParams.set("keys", STREAM_KEYS.join(","));
  u.searchParams.set("key_by_type", "true");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!r.ok) throw new Error(`Strava streams failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

export async function fetchStravaActivityDetail(
  userId: string,
  activityId: number
): Promise<StravaActivityDetail> {
  const tok = await getStravaToken(userId);
  if (!tok) throw new Error("Strava not connected");
  const r = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  if (!r.ok) throw new Error(`Strava activity detail failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

export async function buildFitFromStravaActivity(
  userId: string,
  activityId: number
): Promise<Buffer> {
  const [detail, streams] = await Promise.all([
    fetchStravaActivityDetail(userId, activityId),
    fetchStravaStreams(userId, activityId),
  ]);
  return synthesizeFit(detail, streams);
}

const DEG_TO_SEMICIRCLES = 0x80000000 / 180;

function degToSemicircles(deg: number): number {
  return Math.round(deg * DEG_TO_SEMICIRCLES);
}

function synthesizeFit(detail: StravaActivityDetail, streams: StreamSet): Buffer {
  const startMs = new Date(detail.start_date).getTime();
  const time = streams.time?.data ?? [];
  const distance = streams.distance?.data ?? [];
  const latlng = streams.latlng?.data ?? [];
  const altitude = streams.altitude?.data ?? [];
  const heartrate = streams.heartrate?.data ?? [];
  const velocity = streams.velocity_smooth?.data ?? [];
  const cadence = streams.cadence?.data ?? [];
  const watts = streams.watts?.data ?? [];

  if (time.length === 0) {
    throw new Error(`Activity ${detail.id} has no time stream (cannot synthesize FIT)`);
  }

  const encoder = new Encoder();
  const write = (m: Record<string, unknown>): void => {
    encoder.writeMesg(m as never);
  };
  const sportInfo =
    SPORT_MAP[detail.sport_type ?? ""] ?? SPORT_MAP[detail.type ?? ""] ?? { sport: 0, subSport: 0 };

  const firstTs = new Date(startMs);
  const lastTs = new Date(startMs + time[time.length - 1] * 1000);

  write({
    mesgNum: 0,
    type: 4,
    manufacturer: 255,
    timeCreated: firstTs,
    serialNumber: Math.floor(Math.random() * 0xfffffffe) + 1,
  });

  write({
    mesgNum: 49,
    softwareVersion: 100,
  });

  write({
    mesgNum: 21,
    timestamp: firstTs,
    event: 0,
    eventType: 0,
    eventGroup: 0,
  });

  for (let i = 0; i < time.length; i++) {
    const ts = new Date(startMs + time[i] * 1000);
    const record: Record<string, unknown> = { mesgNum: 20, timestamp: ts };
    if (distance[i] != null) record.distance = distance[i];
    if (latlng[i]) {
      record.positionLat = degToSemicircles(latlng[i][0]);
      record.positionLong = degToSemicircles(latlng[i][1]);
    }
    if (altitude[i] != null) record.altitude = altitude[i];
    if (heartrate[i] != null) record.heartRate = heartrate[i];
    if (velocity[i] != null) record.speed = velocity[i];
    if (cadence[i] != null) record.cadence = cadence[i];
    if (watts[i] != null) record.power = watts[i];
    write(record);
  }

  write({
    mesgNum: 21,
    timestamp: lastTs,
    event: 0,
    eventType: 4,
    eventGroup: 0,
  });

  const totalDistance = distance.length ? distance[distance.length - 1] : detail.distance;
  const totalElapsed = time[time.length - 1];

  write({
    mesgNum: 19,
    timestamp: lastTs,
    startTime: firstTs,
    totalElapsedTime: totalElapsed,
    totalTimerTime: detail.moving_time || totalElapsed,
    totalDistance,
    avgHeartRate: detail.average_heartrate,
    maxHeartRate: detail.max_heartrate,
    avgSpeed: detail.average_speed,
    maxSpeed: detail.max_speed,
    avgCadence: detail.average_cadence,
    totalCalories: detail.calories,
    totalAscent: detail.total_elevation_gain ? Math.round(detail.total_elevation_gain) : undefined,
    sport: sportInfo.sport,
    subSport: sportInfo.subSport,
    event: 9,
    eventType: 1,
    lapTrigger: 7,
    messageIndex: 0,
  });

  write({
    mesgNum: 18,
    timestamp: lastTs,
    startTime: firstTs,
    sport: sportInfo.sport,
    subSport: sportInfo.subSport,
    totalElapsedTime: totalElapsed,
    totalTimerTime: detail.moving_time || totalElapsed,
    totalDistance,
    avgHeartRate: detail.average_heartrate,
    maxHeartRate: detail.max_heartrate,
    avgSpeed: detail.average_speed,
    maxSpeed: detail.max_speed,
    avgCadence: detail.average_cadence,
    totalCalories: detail.calories,
    totalAscent: detail.total_elevation_gain ? Math.round(detail.total_elevation_gain) : undefined,
    firstLapIndex: 0,
    numLaps: 1,
    event: 8,
    eventType: 1,
    trigger: 0,
    messageIndex: 0,
  });

  write({
    mesgNum: 34,
    timestamp: lastTs,
    totalTimerTime: detail.moving_time || totalElapsed,
    numSessions: 1,
    type: 0,
    event: 26,
    eventType: 1,
  });

  return Buffer.from(encoder.close());
}
