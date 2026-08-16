import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireClient, persistSession, failure } from "@/lib/api";
import { gatherSources, buildMerge } from "@/lib/merge-flow";
import { verifyCsrf, csrfRejection, CSRF_HEADER } from "@/lib/csrf";
import { rateLimitJson, clientKey } from "@/lib/rate-limit";

export const maxDuration = 60;
export const runtime = "nodejs";

const body = z.object({
  activityIds: z.array(z.number().int().positive()).min(2).max(6),
});

/**
 * Runs the real merge in memory and hands back everything needed to draw it:
 * per-source streams, the merged streams, where each source lands on the merged
 * timeline, and the gaps being bridged. Nothing on Garmin is touched.
 */
export async function POST(req: NextRequest) {
  if (!(await verifyCsrf(req.headers.get(CSRF_HEADER)))) return csrfRejection();

  const limited = rateLimitJson(`preview:${clientKey(req)}`, { capacity: 10, refillPerMinute: 4 });
  if (limited) return limited;

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Select between two and six activities",
        code: "VALIDATION",
        title: "Invalid selection.",
      },
      { status: 400 }
    );
  }

  try {
    const client = await requireClient();
    const sources = await gatherSources(client, parsed.data.activityIds);
    await persistSession(client);

    const preview = buildMerge(sources);

    return NextResponse.json({
      sources: sources.map((s) => ({
        activityId: s.activityId,
        name: s.metrics.activityName ?? `Activity ${s.activityId}`,
        sport: s.metrics.activityType ?? null,
        startTimeLocal: s.metrics.startTimeLocal ?? null,
        streams: s.streams,
        garmin: {
          distance: s.metrics.distance ?? null,
          duration: s.metrics.duration ?? null,
          calories: s.metrics.calories ?? null,
          averageHR: s.metrics.averageHR ?? null,
          maxHR: s.metrics.maxHR ?? null,
          elevationGain: s.metrics.elevationGain ?? null,
        },
      })),
      merged: {
        streams: preview.streams,
        boundaries: preview.boundaries,
        recordCount: preview.merged.recordCount,
        startTime: preview.merged.startTime.toISOString(),
        endTime: preview.merged.endTime.toISOString(),
        sizeBytes: preview.merged.buffer.length,
      },
      gaps: preview.gaps,
      warnings: preview.warnings,
      suggestedName: suggestName(sources.map((s) => s.metrics.activityName)),
    });
  } catch (e) {
    return failure("preview", e, { activityIds: parsed.data.activityIds });
  }
}

function suggestName(names: (string | undefined)[]): string {
  const first = names.find(Boolean);
  return first ?? "Merged activity";
}
