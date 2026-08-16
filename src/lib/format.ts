export const SERIES_COLORS = [
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-1)",
] as const;

export const MERGED_COLOR = "var(--color-series-1)";

export function sourceColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "–";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${m}:${String(rest).padStart(2, "0")}`;
}

/** Compact form for prose: "4m 12s", "1h 06m". */
export function formatDurationWords(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "–";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}

export function formatDistance(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres) || metres === 0) return "–";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

/** Speed in m/s to min/km, the unit runners actually read. */
export function formatPace(metresPerSecond: number | null | undefined): string {
  if (!metresPerSecond || metresPerSecond <= 0.1) return "–";
  const secPerKm = Math.round(1000 / metresPerSecond);
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  if (m > 30) return "–";
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export function formatElevation(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return "–";
  return `${Math.round(metres)} m`;
}

export function formatHr(bpm: number | null | undefined): string {
  if (!bpm) return "–";
  return `${Math.round(bpm)} bpm`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function sportLabel(typeKey: string | null | undefined): string {
  if (!typeKey) return "Activity";
  return typeKey
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
