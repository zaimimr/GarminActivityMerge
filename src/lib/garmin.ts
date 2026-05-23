import { GarminConnect } from "garmin-connect";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import AdmZip from "adm-zip";
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

export async function persistGarminTokensIfChanged(userId: string, gc: GarminConnect): Promise<void> {
  try {
    const t = gc.exportToken();
    if (!t?.oauth2?.access_token) return;
    const { data } = await supabaseAdmin()
      .from("garmin_sessions")
      .select("oauth2_token, oauth2_expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    const newExpiry = new Date(t.oauth2.expires_at * 1000).toISOString();
    if (data?.oauth2_token === t.oauth2.access_token && data?.oauth2_expires_at === newExpiry) {
      return;
    }
    await supabaseAdmin()
      .from("garmin_sessions")
      .update({
        oauth1_token: t.oauth1.oauth_token,
        oauth1_secret: t.oauth1.oauth_token_secret,
        oauth2_token: t.oauth2.access_token,
        oauth2_expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  } catch (e) {
    console.error("[garmin] persistGarminTokensIfChanged failed:", (e as Error).message);
  }
}

async function withGarminClient<T>(
  userId: string,
  fn: (gc: GarminConnect) => Promise<T>
): Promise<T> {
  const gc = await getGarminClient(userId);
  if (!gc) throw new Error("Garmin not connected");
  try {
    return await fn(gc);
  } finally {
    await persistGarminTokensIfChanged(userId, gc);
  }
}

export async function listGarminActivities(userId: string, start = 0, limit = 30): Promise<GarminActivity[]> {
  return withGarminClient(userId, async (gc) => {
    return (await gc.getActivities(start, limit)) as unknown as GarminActivity[];
  });
}

export type GarminActivityMetrics = {
  distance?: number;
  duration?: number;
  elapsedDuration?: number;
  averageSpeed?: number;
  maxSpeed?: number;
  averageHR?: number;
  maxHR?: number;
  calories?: number;
  elevationGain?: number;
  elevationLoss?: number;
};

export async function getGarminActivityMetrics(
  userId: string,
  activityId: number
): Promise<GarminActivityMetrics> {
  return withGarminClient(userId, async (gc) => {
    const a = (await gc.getActivity({ activityId })) as unknown as Record<string, unknown>;
    return innerGarminMetrics(a);
  });
}

function innerGarminMetrics(a: Record<string, unknown>): GarminActivityMetrics {
  return {
    distance: a.distance as number | undefined,
    duration: a.duration as number | undefined,
    elapsedDuration: a.elapsedDuration as number | undefined,
    averageSpeed: a.averageSpeed as number | undefined,
    maxSpeed: a.maxSpeed as number | undefined,
    averageHR: a.averageHR as number | undefined,
    maxHR: a.maxHR as number | undefined,
    calories: a.calories as number | undefined,
    elevationGain: a.elevationGain as number | undefined,
    elevationLoss: a.elevationLoss as number | undefined,
  };
}

export async function downloadGarminOriginal(userId: string, activityId: number): Promise<Buffer> {
  return withGarminClient(userId, async (gc) => {
    const dir = mkdtempSync(join(tmpdir(), "ae-garmin-"));
    try {
      await gc.downloadOriginalActivityData({ activityId }, dir);
      const files = readdirSync(dir);
      if (files.length === 0) throw new Error("Garmin download returned no file");
      const downloaded = readFileSync(join(dir, files[0]));
      const fit = extractFitFromZipIfNeeded(downloaded);
      if (!isFitMagic(fit)) {
        throw new Error(
          `Garmin download for activity ${activityId} is not a FIT file (size ${fit.length} bytes). Activity may have been manually entered or recorded by a non-FIT source.`
        );
      }
      return fit;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

function isZipMagic(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05);
}

function isFitMagic(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return buf[8] === 0x2e && buf[9] === 0x46 && buf[10] === 0x49 && buf[11] === 0x54;
}

function extractFitFromZipIfNeeded(buf: Buffer): Buffer {
  if (!isZipMagic(buf)) return buf;
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  const fitEntry =
    entries.find((e) => e.entryName.toLowerCase().endsWith(".fit")) ?? entries[0];
  if (!fitEntry) throw new Error("Garmin zip contained no files");
  return fitEntry.getData();
}

export async function uploadGarminFit(userId: string, buf: Buffer): Promise<unknown> {
  return withGarminClient(userId, async (gc) => {
    const dir = mkdtempSync(join(tmpdir(), "ae-garmin-up-"));
    try {
      const fp = join(dir, "merged.fit");
      writeFileSync(fp, buf);
      return await gc.uploadActivity(fp, "fit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

export async function pollGarminUploadStatus(
  userId: string,
  uploadUuid: string,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<{ activityId: number | null; status: string; failures?: unknown[] }> {
  return withGarminClient(userId, async (gc) => pollWithClient(gc, uploadUuid, options));
}

async function pollWithClient(
  gc: GarminConnect,
  uploadUuid: string,
  options: { timeoutMs?: number; intervalMs?: number }
): Promise<{ activityId: number | null; status: string; failures?: unknown[] }> {
  const axios = (gc.client as unknown as { client: { request: (cfg: unknown) => Promise<{ status: number; data: unknown }> } }).client;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await axios.request({
      method: "GET",
      url: `https://connectapi.garmin.com/upload-service/upload/${uploadUuid}`,
      validateStatus: (s: number) => s === 200 || s === 202 || s === 404,
    });
    if (res.status === 404) return { activityId: null, status: "not_found" };
    const data = res.data as Record<string, unknown>;
    const detail = data?.detailedImportResult as Record<string, unknown> | undefined;
    if (detail) {
      const successes = detail.successes as Array<{ internalId?: number }> | undefined;
      const failures = detail.failures as Array<{ messages?: Array<{ content?: string }> }> | undefined;
      if (failures && failures.length > 0) {
        return { activityId: null, status: "failed", failures };
      }
      if (successes && successes[0]?.internalId) {
        return { activityId: successes[0].internalId, status: "ok" };
      }
    }
  }
  return { activityId: null, status: "timeout" };
}

export async function deleteGarminActivity(userId: string, activityId: number): Promise<void> {
  return withGarminClient(userId, async (gc) => {
    const url = `https://connectapi.garmin.com/activity-service/activity/${activityId}`;
    const axios = (gc.client as unknown as { client: { request: (cfg: unknown) => Promise<{ status: number; data: unknown }> } }).client;
    const res = await axios.request({
      method: "DELETE",
      url,
      validateStatus: (s: number) => s === 200 || s === 204 || s === 404,
    });
    if (res.status === 404) {
      console.warn(`[garmin] delete ${activityId} returned 404 (already deleted?)`);
      return;
    }
    if (res.status !== 200 && res.status !== 204) {
      throw new Error(`Garmin delete ${activityId} failed: status=${res.status} body=${JSON.stringify(res.data)}`);
    }
  });
}
