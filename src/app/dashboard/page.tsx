"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

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

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [platform, setPlatform] = useState<Platform>("strava");
  const [strava, setStrava] = useState<StravaActivity[]>([]);
  const [garmin, setGarmin] = useState<GarminActivity[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeName, setMergeName] = useState("");
  const [deleteOriginals, setDeleteOriginals] = useState(true);
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<string | null>(null);

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
  }, [load]);

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
        name: mergeName || undefined,
        deleteOriginals,
      };
      const r = await fetch(`/api/merge/${platform}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Merge failed");
      setResult(`Done. New activity id: ${j.activityId ?? JSON.stringify(j.result)}`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMerging(false);
    }
  }

  const connected = platform === "strava" ? me?.strava?.connected : me?.garmin?.connected;
  const items = platform === "strava" ? strava : garmin;

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
            <Link
              href={platform === "strava" ? "/api/auth/strava" : "/connect/garmin"}
              className="mt-3 inline-block rounded-md bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white"
            >
              Connect {platform === "strava" ? "Strava" : "Garmin"}
            </Link>
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
                          <div className="font-medium text-zinc-100">{name}</div>
                          <div className="text-xs text-zinc-500">
                            {sport} · {new Date(date).toLocaleString()} · {(dist / 1000).toFixed(2)} km · {formatDuration(elapsed)}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-xs text-zinc-600">#{id}</span>
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
                  <input
                    type="text"
                    value={mergeName}
                    onChange={(e) => setMergeName(e.target.value)}
                    placeholder="Merged activity name (optional)"
                    className="flex-1 min-w-[200px] rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  />
                  <label className="flex items-center gap-2 text-sm text-zinc-400">
                    <input
                      type="checkbox"
                      checked={deleteOriginals}
                      onChange={(e) => setDeleteOriginals(e.target.checked)}
                      className="h-4 w-4 accent-red-500"
                    />
                    Delete originals
                  </label>
                  <button
                    onClick={merge}
                    disabled={merging}
                    className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold hover:bg-orange-500 disabled:opacity-50"
                  >
                    {merging ? "Merging..." : "Merge selected"}
                  </button>
                </div>
              </div>
            )}

            {result && (
              <div className="mt-4 rounded-md border border-green-700/40 bg-green-900/20 p-4 text-sm text-green-300">
                {result}
              </div>
            )}
            {error && (
              <div className="mt-4 rounded-md border border-red-700/40 bg-red-900/20 p-4 text-sm text-red-300">
                {error}
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
