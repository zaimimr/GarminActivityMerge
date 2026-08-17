"use client";

import { useCallback, useEffect, useState } from "react";
import { SignIn } from "@/components/SignIn";
import { ActivityPicker } from "@/components/ActivityPicker";
import { MergePreview, type SavedOriginals } from "@/components/MergePreview";
import { Button, Callout, Card, ErrorPanel } from "@/components/ui";
import {
  asApiError,
  fetchWithCsrf,
  postJson,
  toApiError,
  type ActivityListItem,
  type ApiError,
  type MergeResponse,
  type PreviewResponse,
} from "@/lib/client-types";

const PAGE_SIZE = 30;

type Stage = "loading" | "signin" | "select" | "preview" | "done";

export default function Home() {
  const [stage, setStage] = useState<Stage>("loading");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityListItem[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<MergeResponse | null>(null);
  const [savedOriginals, setSavedOriginals] = useState<SavedOriginals | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const loadActivities = useCallback(async (start = 0) => {
    const first = start === 0;
    if (first) setLoadingActivities(true);
    else setLoadingMore(true);
    try {
      const res = await fetch(`/api/activities?start=${start}&limit=${PAGE_SIZE}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw toApiError(json);
      const page = (json.activities as ActivityListItem[]) ?? [];
      setActivities((prev) => (first ? page : [...prev, ...page]));
      setExhausted(page.length < PAGE_SIZE);
    } catch (e) {
      const apiError = asApiError(e);
      setError(apiError);
      if (apiError.code === "AUTH_REQUIRED" || apiError.code === "AUTH_EXPIRED") {
        setStage("signin");
        setDisplayName(null);
      }
    } finally {
      setLoadingActivities(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/session");
      const json = (await res.json()) as { connected: boolean; displayName?: string };
      if (json.connected) {
        setDisplayName(json.displayName ?? "Garmin athlete");
        setStage("select");
        void loadActivities(0);
      } else {
        setStage("signin");
      }
    })();
  }, [loadActivities]);

  function onSignedIn(name: string) {
    setDisplayName(name);
    setStage("select");
    setError(null);
    void loadActivities(0);
  }

  async function signOut() {
    await fetchWithCsrf("/api/auth/logout", { method: "POST" });
    setDisplayName(null);
    setActivities([]);
    setSelected([]);
    setPreview(null);
    setResult(null);
    setSavedOriginals(null);
    setStage("signin");
  }

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function buildPreview() {
    setPreviewing(true);
    setError(null);
    try {
      const p = await postJson<PreviewResponse>("/api/preview", { activityIds: selected });
      setPreview(p);
      setStage("preview");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setPreviewing(false);
    }
  }

  function onMerged(mergeResult: MergeResponse, originals: SavedOriginals | null) {
    setResult(mergeResult);
    setSavedOriginals(originals);
    setStage("done");
    setSelected([]);
    setPreview(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    void loadActivities(0);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-plane/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="text-sm font-semibold tracking-tight text-ink">Activity Merger</span>
          </div>
          {displayName && (
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-sm text-ink-3 sm:inline">{displayName}</span>
              <Button variant="ghost" onClick={signOut}>
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {stage === "loading" && <div className="py-24" />}

        {stage === "signin" && (
          <div className="py-8">
            <div className="mx-auto mb-10 max-w-xl text-center">
              <h1 className="text-4xl font-semibold tracking-tight text-balance text-ink">
                Your watch split one run in two.
              </h1>
              <p className="mt-4 text-lg text-ink-2 text-pretty">
                Join them back into a single Garmin activity — see exactly how the merged
                recording looks before anything is touched.
              </p>
            </div>
            {error && (
              <div className="mx-auto mb-6 max-w-sm">
                <ErrorPanel error={error} onDismiss={() => setError(null)} />
              </div>
            )}
            <SignIn onSignedIn={onSignedIn} />
          </div>
        )}

        {stage === "select" && (
          <>
            {error && (
              <div className="mb-6">
                <ErrorPanel error={error} onDismiss={() => setError(null)} />
              </div>
            )}
            <ActivityPicker
              activities={activities}
              selected={selected}
              onToggle={toggle}
              onPreview={buildPreview}
              onLoadMore={() => loadActivities(activities.length)}
              loading={loadingActivities}
              loadingMore={loadingMore}
              previewing={previewing}
              canLoadMore={!exhausted && activities.length > 0}
            />
          </>
        )}

        {stage === "preview" && preview && (
          <MergePreview
            preview={preview}
            onBack={() => {
              setPreview(null);
              setStage("select");
            }}
            onMerged={onMerged}
          />
        )}

        {stage === "done" && result && (
          <Result
            result={result}
            originals={savedOriginals}
            onDone={() => {
              setResult(null);
              setStage("select");
            }}
          />
        )}
      </main>

      <footer className="mx-auto max-w-5xl px-6 pt-4 pb-10">
        <p className="border-t border-line pt-6 text-xs text-ink-3">
          Not affiliated with Garmin. Nothing is stored on our servers — no database, no file
          storage, no accounts.{" "}
          <a href="/privacy" className="underline hover:text-ink-2">
            Privacy
          </a>{" "}
          ·{" "}
          <a href="/terms" className="underline hover:text-ink-2">
            Terms
          </a>
        </p>
      </footer>
    </div>
  );
}

function Result({
  result,
  originals,
  onDone,
}: {
  result: MergeResponse;
  originals: SavedOriginals | null;
  onDone: () => void;
}) {
  return (
    <div className="rise mx-auto max-w-2xl space-y-5">
      <Callout
        tone="success"
        title={result.activityId ? "Merged." : "Uploaded — Garmin is still processing it."}
      >
        {result.activityId
          ? "Your originals are gone from Garmin and the merged activity is live."
          : "Garmin accepted the file but hadn't finished processing when we checked. It should appear in Connect shortly."}
      </Callout>

      <Card className="p-5">
        <ol className="space-y-3">
          {result.steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  step.status === "ok" ? "bg-good" : step.status === "failed" ? "bg-critical" : "bg-ink-3"
                }`}
              />
              <span>
                <span className="font-medium text-ink capitalize">{step.step}</span>
                {step.detail && <span className="text-ink-2"> — {step.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {originals && !originals.confirmed && (
        <Callout tone="info" title="Keep your originals safe">
          The zip of your original recordings was sent to your downloads. If it did not arrive,
          save it again now — this is the only copy, and it is gone when you close the tab.
        </Callout>
      )}

      <div className="flex flex-wrap gap-3">
        {originals && (
          <Button
            variant="secondary"
            onClick={() => {
              const url = URL.createObjectURL(originals.blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = originals.filename;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
            }}
          >
            Save originals zip again
          </Button>
        )}
        {result.activityId && (
          <a
            href={`https://connect.garmin.com/modern/activity/${result.activityId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#4d95ea]"
          >
            View on Garmin Connect
          </a>
        )}
        <Button variant="secondary" onClick={onDone}>
          Merge another
        </Button>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7h6a5 5 0 0 1 5 5 5 5 0 0 0 5 5h2"
        stroke="var(--color-series-2)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M3 17h6a5 5 0 0 0 5-5 5 5 0 0 1 5-5h2"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
