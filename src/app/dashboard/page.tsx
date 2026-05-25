"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { fetchWithCsrf } from "@/lib/fetch-csrf";

type Me = {
  user: { id: string } | null;
  strava?: { connected: boolean; athleteId?: number };
  garmin?: { connected: boolean; username?: string };
};

type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  start_date_local: string;
  elapsed_time: number;
  distance: number;
};

type GarminActivity = {
  activityId: number;
  activityName: string;
  startTimeLocal: string;
  activityType: { typeKey: string };
  duration: number;
  distance: number;
};

type Platform = "strava" | "garmin";

type MergeJob = {
  id: string;
  platform: Platform;
  source_activity_ids: string[];
  result_activity_id: string | null;
  result_start_time: string | null;
  status: "pending" | "running" | "succeeded" | "failed" | "undone";
  error: string | null;
  originals_storage_keys: string[] | null;
  created_at: string;
};

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [platform, setPlatform] = useState<Platform>("strava");
  const [strava, setStrava] = useState<StravaActivity[]>([]);
  const [garmin, setGarmin] = useState<GarminActivity[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<{ title?: string; hint?: string; code?: string; message: string } | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [jobs, setJobs] = useState<MergeJob[]>([]);
  const [undoingJobId, setUndoingJobId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    const r = await fetch("/api/jobs");
    if (!r.ok) return;
    const j = await r.json();
    setJobs((j.jobs as MergeJob[]) ?? []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/me");
      const j = (await r.json()) as Me;
      setMe(j);
      if (platform === "strava" && j.strava?.connected) {
        const ar = await fetch("/api/activities/strava");
        const aj = await ar.json();
        if (!ar.ok) throw new Error(aj.error ?? "Failed to load Strava activities");
        setStrava(aj.activities ?? []);
      }
      if (platform === "garmin" && j.garmin?.connected) {
        const ar = await fetch("/api/activities/garmin");
        const aj = await ar.json();
        if (!ar.ok) throw new Error(aj.error ?? "Failed to load Garmin activities");
        setGarmin(aj.activities ?? []);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    setSelected(new Set());
    void load();
    void loadJobs();
  }, [load, loadJobs]);

  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (!me || autoPickedRef.current) return;
    autoPickedRef.current = true;
    const stravaOn = !!me.strava?.connected;
    const garminOn = !!me.garmin?.connected;
    if (!stravaOn && garminOn) setPlatform("garmin");
    else if (!garminOn && stravaOn) setPlatform("strava");
  }, [me]);

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function merge() {
    if (selected.size < 2) return;
    setMerging(true);
    setError(null);
    setResult(null);
    try {
      const body = {
        activityIds: Array.from(selected),
        deleteOriginals: true,
      };
      const r = await fetchWithCsrf(`/api/merge/${platform}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.jobId) setLastJobId(j.jobId);
        setErrorDetail({
          title: j.title,
          hint: j.hint,
          code: j.code,
          message: j.error ?? "Merge failed",
        });
        throw new Error(j.error ?? "Merge failed");
      }
      const warn = j.deleteWarnings?.length
        ? ` (delete warnings: ${j.deleteWarnings.join("; ")})`
        : "";
      setResult(`Merge succeeded. New activity ${j.activityId ?? j.uploadedId ?? "(async upload accepted)"}${warn}`);
      setErrorDetail(null);
      setLastJobId(j.jobId ?? null);
      setSelected(new Set());
      await Promise.all([load(), loadJobs()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMerging(false);
    }
  }

  async function undo() {
    if (!lastJobId) return;
    await undoJob(lastJobId);
  }

  async function undoJob(jobId: string) {
    if (!confirm("Re-upload originals and delete the merged activity?")) return;
    setUndoingJobId(jobId);
    if (jobId === lastJobId) setUndoing(true);
    setError(null);
    try {
      const r = await fetchWithCsrf(`/api/undo/${jobId}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok && r.status !== 207) throw new Error(j.error ?? "Undo failed");
      if (j.partial) {
        setError(`Partial undo. Errors: ${j.errors?.join("; ")}`);
      } else {
        setResult(`Undone. Restored ${j.restored?.length ?? 0} activities.`);
        if (jobId === lastJobId) setLastJobId(null);
      }
      await Promise.all([load(), loadJobs()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUndoingJobId(null);
      if (jobId === lastJobId) setUndoing(false);
    }
  }

  const connected = platform === "strava" ? me?.strava?.connected : me?.garmin?.connected;
  const items = platform === "strava" ? strava : garmin;
  const undoableJobs = jobs.filter(
    (j) =>
      j.platform === platform &&
      j.status === "succeeded" &&
      j.originals_storage_keys &&
      j.originals_storage_keys.length > 0
  );

  function findUndoableJobForActivity(activityId: number, activityStart: string): MergeJob | undefined {
    for (const j of undoableJobs) {
      if (j.result_activity_id && j.result_activity_id === String(activityId)) return j;
      if (j.result_start_time) {
        const diff = Math.abs(
          new Date(j.result_start_time).getTime() - new Date(activityStart).getTime()
        );
        if (diff < 30_000) return j;
      }
    }
    return undefined;
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/40">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={28} height={28} />
            Activity Merger
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-500">Strava:</span>
            <span className={me?.strava?.connected ? "text-green-400" : "text-zinc-500"}>
              {me?.strava?.connected ? "connected" : "off"}
            </span>
            <span className="text-zinc-500">Garmin:</span>
            <span className={me?.garmin?.connected ? "text-green-400" : "text-zinc-500"}>
              {me?.garmin?.connected ? "connected" : "off"}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-center gap-2">
          {(["strava", "garmin"] as Platform[]).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                platform === p
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {p === "strava" ? "Strava" : "Garmin"}
            </button>
          ))}
          <button
            onClick={() => load()}
            className="ml-auto rounded-md bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>

        {!connected && (
          <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/40 p-6">
            <p className="text-zinc-300">
              {platform === "strava" ? "Strava" : "Garmin"} not connected.
            </p>
            {platform === "strava" ? (
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Pending Strava API approval"
                className="mt-3 inline-block cursor-not-allowed rounded-md bg-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-400"
              >
                Connect Strava (in progress)
              </button>
            ) : (
              <Link
                href="/connect/garmin"
                className="mt-3 inline-block rounded-md bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white"
              >
                Connect Garmin
              </Link>
            )}
          </div>
        )}

        {connected && (
          <>
            {loading && <p className="mt-6 text-zinc-400">Loading activities...</p>}
            {!loading && (
              <ul className="mt-6 divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/30">
                {items.map((a) => {
                  const id = "id" in a ? a.id : (a as GarminActivity).activityId;
                  const name = "name" in a ? a.name : (a as GarminActivity).activityName;
                  const sport =
                    "sport_type" in a
                      ? (a as StravaActivity).sport_type
                      : (a as GarminActivity).activityType.typeKey;
                  const date =
                    "start_date_local" in a
                      ? (a as StravaActivity).start_date_local
                      : (a as GarminActivity).startTimeLocal;
                  const elapsed =
                    "elapsed_time" in a
                      ? (a as StravaActivity).elapsed_time
                      : Math.round((a as GarminActivity).duration);
                  const dist = a.distance ?? 0;
                  const isSel = selected.has(id);
                  const mergedJob = findUndoableJobForActivity(id, date);
                  return (
                    <li
                      key={id}
                      onClick={() => toggle(id)}
                      className={`flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-zinc-900/60 ${
                        isSel ? "bg-zinc-900/80" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggle(id)}
                          className="h-4 w-4 accent-orange-500"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-zinc-100">{name}</span>
                            {mergedJob && (
                              <span className="rounded bg-emerald-600/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                                merged
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {sport} · {new Date(date).toLocaleString()} · {(dist / 1000).toFixed(2)} km · {formatDuration(elapsed)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {mergedJob && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void undoJob(mergedJob.id);
                            }}
                            disabled={undoingJobId === mergedJob.id}
                            className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                          >
                            {undoingJobId === mergedJob.id ? "Undoing..." : "Undo merge"}
                          </button>
                        )}
                        <span className="font-mono text-xs text-zinc-600">#{id}</span>
                      </div>
                    </li>
                  );
                })}
                {items.length === 0 && (
                  <li className="px-4 py-6 text-center text-zinc-500">No activities loaded.</li>
                )}
              </ul>
            )}

            {selected.size >= 2 && (
              <div className="sticky bottom-4 mt-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-zinc-300">{selected.size} activities selected</span>
                  <span className="text-xs text-zinc-500">Originals will be deleted</span>
                  <button
                    onClick={merge}
                    disabled={merging}
                    className="ml-auto rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold hover:bg-orange-500 disabled:opacity-50"
                  >
                    {merging ? "Merging..." : "Merge selected"}
                  </button>
                </div>
                <p className="mt-3 text-xs text-amber-400/80">
                  Use at your own risk. Activity Merger and its owner are not liable for any activities lost or corrupted during merge. See <Link href="/terms" className="underline">Terms</Link>.
                </p>
              </div>
            )}

            {result && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-green-700/40 bg-green-900/20 p-4 text-sm text-green-300">
                <span>{result}</span>
                {lastJobId && (
                  <button
                    onClick={undo}
                    disabled={undoing}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {undoing ? "Undoing..." : "Undo merge"}
                  </button>
                )}
              </div>
            )}
            {error && (
              <div className="mt-4 space-y-2 rounded-md border border-red-700/40 bg-red-900/20 p-4 text-sm text-red-300">
                {errorDetail?.title && (
                  <div className="flex items-center gap-2 font-semibold text-red-200">
                    <span>{errorDetail.title}</span>
                    {errorDetail.code && (
                      <span className="rounded bg-red-900/60 px-1.5 py-0.5 font-mono text-[10px] text-red-200">
                        {errorDetail.code}
                      </span>
                    )}
                  </div>
                )}
                {errorDetail?.hint && (
                  <div className="text-xs text-red-200/80">{errorDetail.hint}</div>
                )}
                <details className="text-xs text-red-300/70">
                  <summary className="cursor-pointer">Technical detail</summary>
                  <div className="mt-1 break-all font-mono">{error}</div>
                  {lastJobId && (
                    <div className="mt-1 font-mono">job: {lastJobId}</div>
                  )}
                </details>
                {lastJobId && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    <a
                      href={`/api/jobs/${lastJobId}/download?which=merged`}
                      className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 hover:bg-zinc-800"
                      download
                    >
                      Download merged FIT
                    </a>
                    {[0, 1, 2, 3].map((i) => (
                      <a
                        key={i}
                        href={`/api/jobs/${lastJobId}/download?which=original&index=${i}`}
                        className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 hover:bg-zinc-800"
                        download
                      >
                        Download original #{i + 1}
                      </a>
                    ))}
                    <button
                      onClick={undo}
                      disabled={undoing}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {undoing ? "Restoring..." : "Restore originals"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}
