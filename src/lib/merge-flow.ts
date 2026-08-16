import type { GarminClient } from "./garmin/client";
import { mergeFitFilesWithMeta, type MergeResult } from "./fit-merge";
import { decodeStreams, analyzeGaps, type ActivityStreams, type Gap } from "./fit-streams";
import { AppError } from "./errors";
import { formatDurationWords } from "./format";

export type GarminMetrics = {
  activityName?: string;
  activityType?: string;
  startTimeLocal?: string;
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

export type Source = {
  activityId: number;
  fit: Buffer;
  metrics: GarminMetrics;
  streams: ActivityStreams;
};

/**
 * Downloads every original recording plus the summary numbers Garmin computed
 * server-side, and sorts them chronologically. Both the preview and the real
 * merge run through this, so what you approve is what gets uploaded.
 */
export async function gatherSources(client: GarminClient, activityIds: number[]): Promise<Source[]> {
  const sources = await Promise.all(
    activityIds.map(async (activityId) => {
      const [fit, metrics] = await Promise.all([
        client.downloadOriginalFit(activityId),
        client
          .activityDetails(activityId)
          .then(normalizeMetrics)
          .catch(() => ({}) as GarminMetrics),
      ]);
      return { activityId, fit, metrics, streams: decodeStreams(fit) };
    })
  );

  sources.sort((a, b) => Date.parse(a.streams.startTime) - Date.parse(b.streams.startTime));
  return sources;
}

export type MergePreview = {
  merged: MergeResult;
  streams: ActivityStreams;
  /** Elapsed seconds into the merged activity where each source starts. */
  boundaries: number[];
  gaps: Gap[];
  warnings: string[];
};

export function buildMerge(sources: Source[], name?: string): MergePreview {
  if (sources.length < 2) {
    throw new AppError({
      code: "VALIDATION",
      title: "Pick at least two activities.",
      message: `Got ${sources.length} activities to merge.`,
      status: 400,
    });
  }

  const merged = mergeFitFilesWithMeta(
    sources.map((s) => s.fit),
    { name, metricsOverride: sources.map((s) => s.metrics) }
  );
  const streams = decodeStreams(merged.buffer);
  const mergedStartMs = Date.parse(streams.startTime);
  const boundaries = sources.map((s) =>
    Math.round((Date.parse(s.streams.startTime) - mergedStartMs) / 1000)
  );
  const gaps = analyzeGaps(sources.map((s) => s.streams));

  return { merged, streams, boundaries, gaps, warnings: collectWarnings(sources, gaps, streams) };
}

function collectWarnings(sources: Source[], gaps: Gap[], merged: ActivityStreams): string[] {
  const warnings: string[] = [];

  const sports = new Set(
    sources.map((s) => s.metrics.activityType ?? String(s.streams.sport ?? "unknown"))
  );
  if (sports.size > 1) {
    warnings.push(
      `These activities have different sport types (${Array.from(sports).join(", ")}). The merged activity will use the first one.`
    );
  }

  for (const gap of gaps) {
    if (gap.overlapping) {
      warnings.push(
        `Activity ${gap.toIndex + 1} starts ${formatDurationWords(Math.abs(gap.timeSec))} before activity ${gap.fromIndex + 1} ends. Overlapping records are dropped, keeping the earliest of each second.`
      );
    } else if (gap.timeSec > 1800) {
      warnings.push(
        `There's a ${formatDurationWords(gap.timeSec)} gap between activity ${gap.fromIndex + 1} and ${gap.toIndex + 1}. That's a long time to bridge into one activity.`
      );
    }
    if (gap.distanceM != null && gap.distanceM > 1000) {
      warnings.push(
        `Activity ${gap.toIndex + 1} starts ${(gap.distanceM / 1000).toFixed(1)} km away from where activity ${gap.fromIndex + 1} ended. The merged track will jump in a straight line.`
      );
    }
  }

  const sourceDistance = sources.reduce((sum, s) => sum + s.streams.totals.distance, 0);
  if (sourceDistance > 0 && merged.totals.distance < sourceDistance * 0.95) {
    warnings.push(
      `Merged distance (${(merged.totals.distance / 1000).toFixed(2)} km) is lower than the sum of the originals (${(sourceDistance / 1000).toFixed(2)} km). Check the numbers before approving.`
    );
  }

  if (merged.totals.distance === 0) {
    warnings.push(
      "The recordings carry no distance data (typical for indoor workouts). Garmin's own totals are used for the merged summary instead."
    );
  }

  return warnings;
}

function normalizeMetrics(detail: Record<string, unknown>): GarminMetrics {
  const summary = (detail.summaryDTO as Record<string, unknown> | undefined) ?? {};
  const type = detail.activityTypeDTO as { typeKey?: string } | undefined;
  const pick = (key: string): number | undefined => {
    const v = summary[key] ?? detail[key];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  return {
    activityName: (detail.activityName as string | undefined) ?? undefined,
    activityType: type?.typeKey ?? ((detail.activityType as { typeKey?: string } | undefined)?.typeKey),
    startTimeLocal:
      (summary.startTimeLocal as string | undefined) ??
      (detail.startTimeLocal as string | undefined),
    distance: pick("distance"),
    duration: pick("duration"),
    elapsedDuration: pick("elapsedDuration"),
    averageSpeed: pick("averageSpeed"),
    maxSpeed: pick("maxSpeed"),
    averageHR: pick("averageHR"),
    maxHR: pick("maxHR"),
    calories: pick("calories"),
    elevationGain: pick("elevationGain"),
    elevationLoss: pick("elevationLoss"),
  };
}
