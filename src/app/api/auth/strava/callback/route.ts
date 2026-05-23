import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, saveStravaToken } from "@/lib/strava";
import { getOrCreateUser, readSession, setSessionCookie } from "@/lib/session";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const jar = await cookies();
  const expected = jar.get("ae_strava_state")?.value;
  jar.delete("ae_strava_state");

  if (err) return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(err)}`, req.url));
  if (!code || !state || state !== expected) {
    return NextResponse.redirect(new URL("/?error=invalid_state", req.url));
  }

  const tok = await exchangeCode(code);

  const existing = await readSession();
  const userId = existing?.userId ?? (await getOrCreateUser());
  await saveStravaToken(userId, tok);
  if (!existing) await setSessionCookie(userId);

  return NextResponse.redirect(new URL("/dashboard", req.url));
}
