import AdmZip from "adm-zip";
import { AppError } from "@/lib/errors";
import { networkError, USER_AGENT_BROWSER, USER_AGENT_MOBILE } from "./http";
import { refreshAccessToken } from "./auth";
import type { GarminActivity, GarminSession } from "./types";

const API = "https://connectapi.garmin.com";
/** Refresh the bearer token this long before it actually expires. */
const REFRESH_MARGIN_MS = 60_000;

export type UploadOutcome = {
  activityId: string | null;
  uploadUuid: string | null;
  failures: string[];
};

/**
 * Thin client over Garmin Connect's mobile API. Holds the session in memory for
 * the lifetime of one request; if the bearer token is refreshed, `tokensChanged`
 * flips so the route can re-seal the session cookie.
 */
export class GarminClient {
  private session: GarminSession;
  tokensChanged = false;

  constructor(session: GarminSession) {
    this.session = session;
  }

  get current(): GarminSession {
    return this.session;
  }

  private async bearer(): Promise<string> {
    if (this.session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return this.session.accessToken;
    const refreshed = await refreshAccessToken(this.session.oauth1);
    this.session = { ...this.session, ...refreshed };
    this.tokensChanged = true;
    return this.session.accessToken;
  }

  private async request(
    path: string,
    init: RequestInit & { accept?: string } = {}
  ): Promise<Response> {
    const target = path.startsWith("http") ? path : `${API}${path}`;
    const headers = new Headers(init.headers ?? {});
    headers.set("Authorization", `Bearer ${await this.bearer()}`);
    if (!headers.has("User-Agent")) headers.set("User-Agent", USER_AGENT_MOBILE);
    headers.set("di-backend", "connectapi.garmin.com");
    if (init.accept) headers.set("Accept", init.accept);

    let res: Response;
    try {
      res = await fetch(target, { ...init, headers });
    } catch (e) {
      throw networkError(target, e);
    }

    if (res.status === 401 || res.status === 403) {
      throw new AppError({
        code: "AUTH_EXPIRED",
        title: "Your Garmin session expired.",
        message: `${res.status} from ${path}`,
        hint: "Sign in again to continue.",
        status: 401,
      });
    }
    return res;
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(path, { ...init, accept: "application/json" });
    if (!res.ok) {
      throw new AppError({
        code: "INTERNAL",
        title: "Garmin returned an error.",
        message: `${res.status} from ${path}: ${truncate(await res.text().catch(() => ""), 300)}`,
        status: res.status >= 500 ? 502 : res.status,
      });
    }
    return (await res.json()) as T;
  }

  async displayName(): Promise<string> {
    const profile = await this.json<{ displayName?: string; userName?: string; fullName?: string }>(
      "/userprofile-service/socialProfile"
    );
    return profile.fullName ?? profile.userName ?? profile.displayName ?? "Garmin athlete";
  }

  async listActivities(start = 0, limit = 30): Promise<GarminActivity[]> {
    return this.json<GarminActivity[]>(
      `/activitylist-service/activities/search/activities?start=${start}&limit=${limit}`
    );
  }

  async activityDetails(activityId: number): Promise<Record<string, unknown>> {
    return this.json<Record<string, unknown>>(`/activity-service/activity/${activityId}`);
  }

  /** Original recording as uploaded by the watch, unwrapped from Garmin's zip. */
  async downloadOriginalFit(activityId: number): Promise<Buffer> {
    const path = `/download-service/files/activity/${activityId}`;
    // Garmin's download service negotiates strictly: a narrow Accept (or the
    // mobile user agent) gets a 406 rather than the file.
    let res = await this.request(path, { accept: "*/*" });
    if (res.status === 406) {
      res = await this.request(path, {
        accept: "*/*",
        headers: { "User-Agent": USER_AGENT_BROWSER },
      });
    }
    if (res.status === 404) {
      // A 404 here means either "this activity has no FIT" or "this activity is
      // gone". Those need very different advice, so ask whether it still exists.
      const stillExists = await this.activityExists(activityId);
      throw stillExists
        ? new AppError({
            code: "ACTIVITY_NOT_FIT",
            title: `Activity ${activityId} has no original recording.`,
            message: `download-service returned 404 for ${activityId}, but the activity exists`,
            hint: "Manually entered activities carry no FIT file, so there is nothing to merge.",
            status: 422,
          })
        : new AppError({
            code: "ACTIVITY_GONE",
            title: `Activity ${activityId} no longer exists on Garmin.`,
            message: `download-service and activity-service both returned 404 for ${activityId}`,
            hint: "It was probably deleted — by an earlier merge, or in Garmin Connect. Recover it at Garmin Connect -> Settings -> Account -> Recover Deleted Activities (kept ~30 days), or re-import it from a downloaded originals zip.",
            status: 410,
          });
    }
    if (!res.ok) {
      throw new AppError({
        code: "INTERNAL",
        title: "Could not download the original recording.",
        message: `download-service returned ${res.status} for ${activityId}`,
        hint:
          res.status === 406
            ? "Garmin refused the download request itself, which usually means they changed what headers the download service accepts."
            : "Nothing was changed on Garmin. Try again in a moment.",
        status: 502,
      });
    }

    const raw = Buffer.from(await res.arrayBuffer());
    const fit = isZip(raw) ? unzipFit(raw, activityId) : raw;
    if (!isFit(fit)) {
      throw new AppError({
        code: "ACTIVITY_NOT_FIT",
        title: `Activity ${activityId} is not a FIT recording.`,
        message: `Downloaded ${fit.length} bytes with no FIT header.`,
        hint: "Only watch-recorded activities can be merged.",
        status: 422,
      });
    }
    return fit;
  }

  /** Distinguishes a deleted activity from one that merely has no FIT file. */
  async activityExists(activityId: number): Promise<boolean> {
    try {
      const res = await this.request(`/activity-service/activity/${activityId}`, {
        accept: "application/json",
      });
      return res.ok;
    } catch {
      // An auth or network failure tells us nothing either way; don't claim it's gone.
      return true;
    }
  }

  async uploadFit(buf: Buffer, filename = "merged.fit"): Promise<UploadOutcome> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: "application/octet-stream" }), filename);

    const res = await this.request("/upload-service/upload/.fit", {
      method: "POST",
      body: form,
      accept: "application/json",
    });
    const text = await res.text();
    if (!res.ok && res.status !== 201 && res.status !== 202) {
      throw new AppError({
        code: res.status === 409 ? "DEDUP_REJECTED" : "UPLOAD_FAILED",
        title:
          res.status === 409
            ? "Garmin rejected the merged activity as a duplicate."
            : "Garmin rejected the merged upload.",
        message: `upload-service returned ${res.status}: ${truncate(text, 400)}`,
        status: res.status === 409 ? 409 : 502,
      });
    }

    const parsed = safeJson(text) as
      | { detailedImportResult?: Record<string, unknown> }
      | null;
    const detail = parsed?.detailedImportResult;
    const successes = (detail?.successes as Array<{ internalId?: number }> | undefined) ?? [];
    const failures = (detail?.failures as Array<{ messages?: Array<{ content?: string }> }> | undefined) ?? [];
    const uuid = (detail?.uploadUuid as { uuid?: string } | undefined)?.uuid ?? null;

    return {
      activityId: successes[0]?.internalId ? String(successes[0].internalId) : null,
      uploadUuid: uuid,
      failures: failures.flatMap((f) => (f.messages ?? []).map((m) => m.content ?? "")).filter(Boolean),
    };
  }

  /** Uploads are processed asynchronously; poll until Garmin assigns an id. */
  async pollUpload(
    uploadUuid: string,
    { timeoutMs = 25_000, intervalMs = 2_000 } = {}
  ): Promise<{ activityId: string | null; failures: string[]; timedOut: boolean }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(intervalMs);
      const res = await this.request(`/upload-service/upload/${uploadUuid}`, {
        accept: "application/json",
      });
      if (res.status === 404) continue;
      const parsed = safeJson(await res.text()) as
        | { detailedImportResult?: Record<string, unknown> }
        | null;
      const detail = parsed?.detailedImportResult;
      if (!detail) continue;
      const successes = (detail.successes as Array<{ internalId?: number }> | undefined) ?? [];
      const failures = (detail.failures as Array<{ messages?: Array<{ content?: string }> }> | undefined) ?? [];
      if (failures.length > 0) {
        return {
          activityId: null,
          failures: failures.flatMap((f) => (f.messages ?? []).map((m) => m.content ?? "")).filter(Boolean),
          timedOut: false,
        };
      }
      if (successes[0]?.internalId) {
        return { activityId: String(successes[0].internalId), failures: [], timedOut: false };
      }
    }
    return { activityId: null, failures: [], timedOut: true };
  }

  async deleteActivity(activityId: number): Promise<void> {
    const res = await this.request(`/activity-service/activity/${activityId}`, {
      method: "DELETE",
      accept: "application/json",
    });
    if (res.status === 404) return; // already gone
    if (res.status !== 200 && res.status !== 204) {
      throw new AppError({
        code: "DELETE_FAILED",
        title: `Could not delete activity ${activityId}.`,
        message: `activity-service DELETE returned ${res.status}: ${truncate(await res.text().catch(() => ""), 300)}`,
        status: 502,
      });
    }
  }

  /** Best-effort rename; Garmin names uploads after the device otherwise. */
  async renameActivity(activityId: number, name: string): Promise<boolean> {
    const res = await this.request(`/activity-service/activity/${activityId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Http-Method-Override": "PUT" },
      body: JSON.stringify({ activityId, activityName: name }),
      accept: "application/json",
    });
    return res.ok;
  }
}

function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

function isFit(buf: Buffer): boolean {
  return (
    buf.length >= 12 && buf[8] === 0x2e && buf[9] === 0x46 && buf[10] === 0x49 && buf[11] === 0x54
  );
}

function unzipFit(buf: Buffer, activityId: number): Buffer {
  const entries = new AdmZip(buf).getEntries();
  const entry = entries.find((e) => e.entryName.toLowerCase().endsWith(".fit")) ?? entries[0];
  if (!entry) {
    throw new AppError({
      code: "ACTIVITY_NOT_FIT",
      title: `Garmin's export for activity ${activityId} was empty.`,
      message: "Downloaded zip contained no entries.",
      status: 422,
    });
  }
  return entry.getData();
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
