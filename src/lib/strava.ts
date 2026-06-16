import { supabaseAdmin, StravaTokenRow } from "./supabase";

const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_OAUTH = "https://www.strava.com/oauth";

export const STRAVA_ATHLETE_CAP = Number(process.env.STRAVA_ATHLETE_CAP ?? 10);
export const STRAVA_IDLE_MINUTES = Number(process.env.STRAVA_IDLE_MINUTES ?? 120);

export type StravaActivity = {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  upload_id_str?: string;
  external_id?: string;
};

export function stravaAuthUrl(state: string): string {
  const u = new URL(`${STRAVA_OAUTH}/authorize`);
  u.searchParams.set("client_id", required("STRAVA_CLIENT_ID"));
  u.searchParams.set("redirect_uri", `${required("APP_URL")}/api/auth/strava/callback`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("approval_prompt", "auto");
  u.searchParams.set("scope", "read,activity:read_all,activity:write");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: { id: number; firstname?: string; lastname?: string };
  scope?: string;
}> {
  const r = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: required("STRAVA_CLIENT_ID"),
      client_secret: required("STRAVA_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!r.ok) throw new Error(`Strava token exchange failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function refreshIfNeeded(row: StravaTokenRow): Promise<StravaTokenRow> {
  const now = Date.now();
  const exp = new Date(row.expires_at).getTime();
  if (exp - now > 60_000) return row;
  const r = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: required("STRAVA_CLIENT_ID"),
      client_secret: required("STRAVA_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });
  if (!r.ok) throw new Error(`Strava refresh failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { access_token: string; refresh_token: string; expires_at: number };
  const updated: StravaTokenRow = {
    ...row,
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: new Date(j.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await supabaseAdmin().from("strava_tokens").upsert(updated);
  return updated;
}

export async function getStravaToken(userId: string): Promise<StravaTokenRow | null> {
  const { data } = await supabaseAdmin()
    .from("strava_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const tok = await refreshIfNeeded(data as StravaTokenRow);
  await supabaseAdmin()
    .from("strava_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("user_id", userId);
  return tok;
}

export async function saveStravaToken(userId: string, t: {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: { id: number };
  scope?: string;
}): Promise<void> {
  const row: StravaTokenRow = {
    user_id: userId,
    athlete_id: t.athlete.id,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(t.expires_at * 1000).toISOString(),
    scope: t.scope ?? null,
    updated_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
  };
  await supabaseAdmin().from("strava_tokens").upsert(row);
}

export async function deauthorizeStrava(userId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("strava_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) {
    try {
      const tok = await refreshIfNeeded(data as StravaTokenRow);
      await fetch(`${STRAVA_OAUTH}/deauthorize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
    } catch {
    }
  }
  await sb.from("strava_tokens").delete().eq("user_id", userId);
}

export async function countActiveAthletes(): Promise<number> {
  const { count } = await supabaseAdmin()
    .from("strava_tokens")
    .select("user_id", { count: "exact", head: true });
  return count ?? 0;
}

async function reapUserIds(userIds: string[]): Promise<number> {
  let reaped = 0;
  for (const userId of userIds) {
    await deauthorizeStrava(userId);
    reaped++;
  }
  return reaped;
}

export async function reapOldestIdle(n: number): Promise<number> {
  if (n <= 0) return 0;
  const { data } = await supabaseAdmin()
    .from("strava_tokens")
    .select("user_id")
    .order("last_used_at", { ascending: true })
    .limit(n);
  return await reapUserIds((data ?? []).map((r) => r.user_id as string));
}

export async function reapIdleAthletes(idleMinutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();
  const { data } = await supabaseAdmin()
    .from("strava_tokens")
    .select("user_id")
    .lt("last_used_at", cutoff);
  return await reapUserIds((data ?? []).map((r) => r.user_id as string));
}

export async function ensureStravaCapacity(): Promise<void> {
  const count = await countActiveAthletes();
  if (count >= STRAVA_ATHLETE_CAP) {
    await reapOldestIdle(count - STRAVA_ATHLETE_CAP + 1);
  }
}

export async function listActivities(
  userId: string,
  opts: { per_page?: number; page?: number } = {}
): Promise<StravaActivity[]> {
  const tok = await getStravaToken(userId);
  if (!tok) throw new Error("Strava not connected");
  const u = new URL(`${STRAVA_API}/athlete/activities`);
  u.searchParams.set("per_page", String(opts.per_page ?? 30));
  u.searchParams.set("page", String(opts.page ?? 1));
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!r.ok) throw new Error(`Strava list failed: ${r.status}`);
  return await r.json();
}

export async function getActivityOriginal(userId: string, activityId: number): Promise<ArrayBuffer> {
  const tok = await getStravaToken(userId);
  if (!tok) throw new Error("Strava not connected");
  const r = await fetch(`${STRAVA_API}/activities/${activityId}/export_original`, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  if (!r.ok) throw new Error(`Strava original download failed: ${r.status}`);
  return await r.arrayBuffer();
}

export async function uploadActivity(
  userId: string,
  fileBuf: Buffer,
  opts: { name?: string; data_type?: string; external_id?: string } = {}
): Promise<{ id: number; status: string }> {
  const tok = await getStravaToken(userId);
  if (!tok) throw new Error("Strava not connected");
  const form = new FormData();
  form.append("data_type", opts.data_type ?? "fit");
  if (opts.name) form.append("name", opts.name);
  if (opts.external_id) form.append("external_id", opts.external_id);
  const u8 = new Uint8Array(fileBuf);
  form.append("file", new Blob([u8 as unknown as BlobPart], { type: "application/octet-stream" }), "merged.fit");
  const r = await fetch(`${STRAVA_API}/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.access_token}` },
    body: form,
  });
  if (!r.ok) throw new Error(`Strava upload failed: ${r.status} ${await r.text()}`);
  const upload = (await r.json()) as { id: number; status: string; activity_id: number | null; error: string | null };
  return await pollUpload(tok.access_token, upload.id);
}

async function pollUpload(token: string, uploadId: number): Promise<{ id: number; status: string }> {
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    const r = await fetch(`${STRAVA_API}/uploads/${uploadId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) continue;
    const j = (await r.json()) as { activity_id: number | null; error: string | null; status: string };
    if (j.error) throw new Error(`Strava upload error: ${j.error}`);
    if (j.activity_id) return { id: j.activity_id, status: j.status };
  }
  throw new Error("Strava upload timed out");
}

export async function deleteActivity(userId: string, activityId: number): Promise<void> {
  const tok = await getStravaToken(userId);
  if (!tok) throw new Error("Strava not connected");
  const r = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  if (!r.ok && r.status !== 204) {
    throw new Error(`Strava delete failed: ${r.status}`);
  }
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}
