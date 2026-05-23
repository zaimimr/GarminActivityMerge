import { GarminConnect } from "garmin-connect";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { supabaseAdmin, GarminSessionRow } from "./supabase";

export type GarminActivity = {
  activityId: number;
  activityName: string;
  startTimeLocal: string;
  startTimeGMT: string;
  activityType: { typeKey: string };
  distance: number;
  duration: number;
  elapsedDuration: number;
  averageHR?: number;
  hasPolyline?: boolean;
};

export async function loginWithPassword(username: string, password: string): Promise<{
  oauth1: { oauth_token: string; oauth_token_secret: string };
  oauth2: { access_token: string; refresh_token: string; expires_at: number; refresh_token_expires_at: number };
}> {
  const gc = new GarminConnect({ username, password });
  await gc.login();
  const tok = gc.exportToken();
  return tok;
}

export function buildClientFromSession(row: GarminSessionRow): GarminConnect {
  const gc = new GarminConnect({ username: row.username ?? "", password: "" });
  gc.loadToken(
    { oauth_token: row.oauth1_token, oauth_token_secret: row.oauth1_secret },
    {
      scope: "",
      jti: "",
      access_token: row.oauth2_token,
      token_type: "Bearer",
      refresh_token: "",
      expires_in: 0,
      refresh_token_expires_in: 0,
      expires_at: Math.floor(new Date(row.oauth2_expires_at).getTime() / 1000),
      refresh_token_expires_at: 0,
      last_update_date: "",
      expires_date: "",
    }
  );
  return gc;
}

export async function saveGarminSession(
  userId: string,
  username: string,
  tokens: {
    oauth1: { oauth_token: string; oauth_token_secret: string };
    oauth2: { access_token: string; expires_at: number };
  }
): Promise<void> {
  const row: GarminSessionRow = {
    user_id: userId,
    oauth1_token: tokens.oauth1.oauth_token,
    oauth1_secret: tokens.oauth1.oauth_token_secret,
    oauth2_token: tokens.oauth2.access_token,
    oauth2_expires_at: new Date(tokens.oauth2.expires_at * 1000).toISOString(),
    username,
    updated_at: new Date().toISOString(),
  };
  await supabaseAdmin().from("garmin_sessions").upsert(row);
}

export async function getGarminClient(userId: string): Promise<GarminConnect | null> {
  const { data } = await supabaseAdmin()
    .from("garmin_sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return buildClientFromSession(data as GarminSessionRow);
}

export async function listGarminActivities(userId: string, start = 0, limit = 30): Promise<GarminActivity[]> {
  const gc = await getGarminClient(userId);
  if (!gc) throw new Error("Garmin not connected");
  return (await gc.getActivities(start, limit)) as unknown as GarminActivity[];
}

export async function downloadGarminOriginal(userId: string, activityId: number): Promise<Buffer> {
  const gc = await getGarminClient(userId);
  if (!gc) throw new Error("Garmin not connected");
  const dir = mkdtempSync(join(tmpdir(), "ae-garmin-"));
  try {
    await gc.downloadOriginalActivityData({ activityId }, dir);
    const files = readdirSync(dir);
    if (files.length === 0) throw new Error("Garmin download returned no file");
    return readFileSync(join(dir, files[0]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function uploadGarminFit(userId: string, buf: Buffer): Promise<unknown> {
  const gc = await getGarminClient(userId);
  if (!gc) throw new Error("Garmin not connected");
  const dir = mkdtempSync(join(tmpdir(), "ae-garmin-up-"));
  try {
    const fp = join(dir, "merged.fit");
    writeFileSync(fp, buf);
    return await gc.uploadActivity(fp, "fit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function deleteGarminActivity(userId: string, activityId: number): Promise<void> {
  const gc = await getGarminClient(userId);
  if (!gc) throw new Error("Garmin not connected");
  await gc.deleteActivity({ activityId });
}
