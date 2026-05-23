import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const s = await readSession();
  if (!s) return NextResponse.json({ user: null });
  const sb = supabaseAdmin();
  const [{ data: strava }, { data: garmin }] = await Promise.all([
    sb.from("strava_tokens").select("athlete_id").eq("user_id", s.userId).maybeSingle(),
    sb.from("garmin_sessions").select("username").eq("user_id", s.userId).maybeSingle(),
  ]);
  return NextResponse.json({
    user: { id: s.userId },
    strava: strava ? { connected: true, athleteId: strava.athlete_id } : { connected: false },
    garmin: garmin ? { connected: true, username: garmin.username } : { connected: false },
  });
}
