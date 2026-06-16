import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { stravaAuthUrl, ensureStravaCapacity } from "@/lib/strava";

export async function GET() {
  await ensureStravaCapacity();
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("ae_strava_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(stravaAuthUrl(state));
}
