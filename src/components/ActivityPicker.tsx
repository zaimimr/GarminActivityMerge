"use client";

import { useMemo } from "react";
import { Button, Spinner } from "./ui";
import { formatDistance, formatDuration, formatDateTime, sportLabel, sourceColor } from "@/lib/format";
import type { ActivityListItem } from "@/lib/client-types";

const MAX_SELECTION = 6;
/** Activities this close together, in the same sport, are probably one session. */
const SPLIT_WINDOW_MS = 6 * 60 * 60 * 1000;

export function ActivityPicker({
  activities,
  selected,
  onToggle,
  onPreview,
  onLoadMore,
  loading,
  loadingMore,
  previewing,
  canLoadMore,
}: {
  activities: ActivityListItem[];
  selected: number[];
  onToggle: (id: number) => void;
  onPreview: () => void;
  onLoadMore: () => void;
  loading: boolean;
  loadingMore: boolean;
  previewing: boolean;
  canLoadMore: boolean;
}) {
  const likelySplit = useMemo(() => findLikelySplits(activities), [activities]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-sm text-ink-3">
        <Spinner />
        Loading your activities
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <p className="py-24 text-center text-sm text-ink-3">No activities found on this account.</p>
    );
  }

  return (
    <div className="rise">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Pick the activities to merge</h2>
          <p className="mt-1 text-sm text-ink-2">
            Choose two or more recordings from the same session. Nothing is changed until you
            approve the preview.
          </p>
        </div>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-1">
        {activities.map((a) => {
          const index = selected.indexOf(a.activityId);
          const isSelected = index >= 0;
          const atLimit = selected.length >= MAX_SELECTION && !isSelected;

          return (
            <li key={a.activityId}>
              <button
                type="button"
                onClick={() => !atLimit && onToggle(a.activityId)}
                disabled={atLimit}
                aria-pressed={isSelected}
                className={`flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors ${
                  isSelected ? "bg-surface-2" : "hover:bg-surface-2/60"
                } ${atLimit ? "cursor-not-allowed opacity-40" : ""}`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    isSelected ? "border-transparent" : "border-line bg-surface-3"
                  }`}
                  style={isSelected ? { background: sourceColor(index) } : undefined}
                >
                  {isSelected && (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="#0b0d10" strokeWidth={2.5}>
                      <path d="M2 6.5 4.8 9 10 3.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{a.activityName}</span>
                    {likelySplit.has(a.activityId) && (
                      <span className="shrink-0 rounded-full border border-accent-soft bg-surface-3 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent-ink uppercase">
                        Likely split
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-3">
                    {sportLabel(a.activityType?.typeKey)} · {formatDateTime(a.startTimeLocal)}
                  </span>
                </span>

                <span className="hidden shrink-0 gap-6 text-right sm:flex">
                  <span className="w-20">
                    <span className="block text-sm text-ink tabular-nums">
                      {formatDistance(a.distance)}
                    </span>
                    <span className="block text-xs text-ink-3">distance</span>
                  </span>
                  <span className="w-16">
                    <span className="block text-sm text-ink tabular-nums">
                      {formatDuration(a.duration)}
                    </span>
                    <span className="block text-xs text-ink-3">moving</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {canLoadMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="ghost" onClick={onLoadMore} busy={loadingMore}>
            Load more activities
          </Button>
        </div>
      )}

      {selected.length > 0 && (
        <div className="sticky bottom-4 z-20 mt-6">
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface-2/95 p-4 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-2">
              {selected.map((id, i) => (
                <span
                  key={id}
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: sourceColor(i) }}
                />
              ))}
              <span className="ml-1 text-sm text-ink-2">
                {selected.length} selected
                {selected.length < 2 && " — pick at least one more"}
              </span>
            </div>
            <Button
              onClick={onPreview}
              disabled={selected.length < 2}
              busy={previewing}
              className="ml-auto"
            >
              {previewing ? "Building preview" : "Preview merge"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function findLikelySplits(activities: ActivityListItem[]): Set<number> {
  const flagged = new Set<number>();
  const sorted = [...activities].sort(
    (a, b) => Date.parse(a.startTimeLocal) - Date.parse(b.startTimeLocal)
  );

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const aEnd = Date.parse(a.startTimeLocal) + (a.elapsedDuration ?? a.duration ?? 0) * 1000;
    const gap = Date.parse(b.startTimeLocal) - aEnd;
    const sameSport = a.activityType?.typeKey === b.activityType?.typeKey;
    if (sameSport && gap >= -60_000 && gap < SPLIT_WINDOW_MS) {
      flagged.add(a.activityId);
      flagged.add(b.activityId);
    }
  }
  return flagged;
}
