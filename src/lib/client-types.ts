import type { ActivityStreams, Gap } from "./fit-streams";

export type { ActivityStreams, Gap };

export type ActivityListItem = {
  activityId: number;
  activityName: string;
  startTimeLocal: string;
  activityType: { typeKey: string };
  distance: number;
  duration: number;
  elapsedDuration: number;
  averageHR?: number;
};

export type PreviewSource = {
  activityId: number;
  name: string;
  sport: string | null;
  startTimeLocal: string | null;
  streams: ActivityStreams;
  garmin: {
    distance: number | null;
    duration: number | null;
    calories: number | null;
    averageHR: number | null;
    maxHR: number | null;
    elevationGain: number | null;
  };
};

export type PreviewResponse = {
  sources: PreviewSource[];
  merged: {
    streams: ActivityStreams;
    boundaries: number[];
    recordCount: number;
    startTime: string;
    endTime: string;
    sizeBytes: number;
  };
  gaps: Gap[];
  warnings: string[];
  suggestedName: string;
};

export type MergeStep = {
  step: string;
  status: "ok" | "failed" | "skipped";
  detail?: string;
};

export type MergeResponse = {
  activityId: string | null;
  processing: boolean;
  steps: MergeStep[];
};

export type ApiError = {
  title?: string;
  hint?: string;
  code?: string;
  message: string;
  /** Present when a merge failed partway: what had already happened. */
  steps?: MergeStep[];
};

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchWithCsrf(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw toApiError(json);
  return json as T;
}

export function toApiError(json: Record<string, unknown>): Error & ApiError {
  const err = new Error(
    (json.error as string) ?? (json.title as string) ?? "Request failed"
  ) as Error & ApiError;
  err.title = json.title as string | undefined;
  err.hint = json.hint as string | undefined;
  err.code = json.code as string | undefined;
  err.steps = json.steps as MergeStep[] | undefined;
  return err;
}

export function asApiError(e: unknown): ApiError {
  const err = e as Error & ApiError;
  return {
    title: err.title,
    hint: err.hint,
    code: err.code,
    message: err.message ?? String(e),
    steps: err.steps,
  };
}

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)ae_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function fetchWithCsrf(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const token = readCsrfCookie();
  if (token) headers.set("x-csrf-token", token);
  return fetch(input, { ...init, headers });
}
