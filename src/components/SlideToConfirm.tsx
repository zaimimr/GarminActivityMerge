"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "./ui";

const KNOB = 44;
const COMMIT_AT = 0.96;

type Props = {
  label: string;
  confirmedLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
};

/**
 * Deliberate confirmation for the one destructive step. A tap can't fire it —
 * the knob has to be dragged the full width, or the control focused and driven
 * with the arrow keys.
 */
export function SlideToConfirm({
  label,
  confirmedLabel,
  onConfirm,
  disabled = false,
  busy = false,
  busyLabel,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgressState] = useState(0);
  const [committed, setCommitted] = useState(false);
  // Mirrors of the state, so the pointer handlers can branch on the current
  // value without doing it inside a setState updater. Updaters must stay pure:
  // React invokes them twice in development, which fired the whole merge flow
  // twice when commit() lived in one.
  const progressRef = useRef(0);
  const committedRef = useRef(false);

  const setProgress = useCallback((next: number | ((p: number) => number)) => {
    const value = typeof next === "function" ? next(progressRef.current) : next;
    const clamped = Math.min(1, Math.max(0, value));
    progressRef.current = clamped;
    setProgressState(clamped);
  }, []);
  // Positions are expressed in CSS so the track never has to be measured during
  // render; the pixel travel is only needed to translate pointer coordinates.
  const offset = `calc(4px + ${progress} * (100% - ${KNOB + 8}px))`;

  const locked = disabled || busy || committed;

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    setCommitted(true);
    setProgress(1);
    onConfirm();
  }, [onConfirm, setProgress]);

  const travel = useCallback((): number => {
    const track = trackRef.current;
    if (!track) return 1;
    return Math.max(1, track.clientWidth - KNOB - 8);
  }, []);

  const moveTo = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const x = clientX - rect.left - 4 - KNOB / 2;
      setProgress(x / travel());
    },
    [travel, setProgress]
  );

  useEffect(() => {
    if (locked) return;

    function onMove(e: PointerEvent) {
      if (!draggingRef.current) return;
      e.preventDefault();
      moveTo(e.clientX);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      if (progressRef.current >= COMMIT_AT) commit();
      else setProgress(0);
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [locked, moveTo, commit, setProgress]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (locked) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setProgress((p) => Math.min(1, p + 0.2));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setProgress((p) => Math.max(0, p - 0.2));
    } else if (e.key === "End") {
      e.preventDefault();
      setProgress(1);
    } else if (e.key === "Home" || e.key === "Escape") {
      e.preventDefault();
      setProgress(0);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (progress >= COMMIT_AT) commit();
      else setProgress((p) => Math.min(1, p + 0.2));
    }
  }

  const text = busy ? (busyLabel ?? confirmedLabel) : committed ? confirmedLabel : label;

  return (
    <div
      ref={trackRef}
      style={{ touchAction: "none", overscrollBehaviorX: "contain" }}
      className={`relative h-[52px] w-full max-w-sm overflow-hidden rounded-full border select-none ${
        disabled
          ? "border-line bg-surface-2 opacity-50"
          : progress >= COMMIT_AT
            ? "border-[#4d2020] bg-surface-2"
            : "border-line bg-surface-2"
      }`}
    >
      <div
        className={`absolute inset-y-0 left-0 bg-critical/25 transition-[width] ${
          dragging ? "duration-0" : "duration-150"
        }`}
        style={{ width: `calc(${KNOB + 4}px + ${progress} * (100% - ${KNOB + 8}px))` }}
        aria-hidden
      />

      <span
        className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold text-ink-2"
        style={{ opacity: busy || committed ? 1 : 1 - progress * 0.75 }}
      >
        {busy && <Spinner />}
        {text}
      </span>

      <div
        role="slider"
        tabIndex={locked ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={`${Math.round(progress * 100)}% — slide fully right to confirm`}
        aria-disabled={locked}
        style={{ left: offset, touchAction: "none" }}
        onPointerDown={(e) => {
          if (locked) return;
          e.preventDefault();
          draggingRef.current = true;
          setDragging(true);
          e.currentTarget.setPointerCapture?.(e.pointerId);
          moveTo(e.clientX);
        }}
        onKeyDown={onKeyDown}
        className={`absolute top-1 flex h-11 w-11 items-center justify-center rounded-full outline-none transition-[left,background-color] ${
          dragging ? "duration-0" : "duration-150"
        } ${
          locked
            ? "cursor-default bg-surface-3"
            : "cursor-grab bg-critical focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
        }`}
      >
        {committed || busy ? (
          <span aria-hidden className="text-white">
            ✓
          </span>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="white" strokeWidth={2.5} aria-hidden>
            <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}
