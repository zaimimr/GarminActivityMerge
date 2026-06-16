import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { reapIdleAthletes, countActiveAthletes, STRAVA_IDLE_MINUTES, STRAVA_ATHLETE_CAP } from "@/lib/strava";

export const runtime = "nodejs";
export const maxDuration = 60;

const log = logger("cron.reap-strava");

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reaped = await reapIdleAthletes(STRAVA_IDLE_MINUTES);
  const remaining = await countActiveAthletes();
  log.info("reap done", { reaped, remaining, idleMinutes: STRAVA_IDLE_MINUTES, cap: STRAVA_ATHLETE_CAP });
  return NextResponse.json({ reaped, remaining, cap: STRAVA_ATHLETE_CAP });
}
