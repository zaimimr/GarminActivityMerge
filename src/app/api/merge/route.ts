import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireClient, persistSession, failure } from "@/lib/api";
import { gatherSources, buildMerge } from "@/lib/merge-flow";
import { verifyCsrf, csrfRejection, CSRF_HEADER } from "@/lib/csrf";
import { rateLimitJson, clientKey } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const maxDuration = 60;
export const runtime = "nodejs";

const log = logger("merge");

const body = z.object({
  activityIds: z.array(z.number().int().positive()).min(2).max(6),
  name: z.string().trim().min(1).max(120).optional(),
  /** The UI only sets this after the originals zip has been saved locally. */
  originalsDownloaded: z.literal(true),
});

export type MergeStep = {
  step: string;
  status: "ok" | "failed" | "skipped";
  detail?: string;
};

export async function POST(req: NextRequest) {
  if (!(await verifyCsrf(req.headers.get(CSRF_HEADER)))) return csrfRejection();

  const limited = rateLimitJson(`merge:${clientKey(req)}`, { capacity: 5, refillPerMinute: 1 });
  if (limited) return limited;

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Download the originals before merging",
        code: "VALIDATION",
        title: "Merge request rejected.",
        hint: "The originals must be saved to your machine before anything is deleted.",
      },
      { status: 400 }
    );
  }

  const { activityIds, name } = parsed.data;
  const steps: MergeStep[] = [];

  try {
    const client = await requireClient();

    const sources = await gatherSources(client, activityIds);
    steps.push({
      step: "download",
      status: "ok",
      detail: `Fetched ${sources.length} original recordings from Garmin.`,
    });

    const preview = buildMerge(sources, name);
    steps.push({
      step: "merge",
      status: "ok",
      detail: `Built a ${(preview.merged.buffer.length / 1024).toFixed(0)} KB FIT with ${preview.merged.recordCount} records.`,
    });

    // Deleting first is deliberate: Garmin rejects an upload that overlaps an
    // existing activity as a duplicate.
    const deleted: number[] = [];
    for (const source of sources) {
      try {
        await client.deleteActivity(source.activityId);
        deleted.push(source.activityId);
      } catch (e) {
        steps.push({
          step: "delete",
          status: "failed",
          detail: `Could not delete ${source.activityId}. Deleted so far: ${deleted.join(", ") || "none"}.`,
        });
        throw new AppError({
          code: "DELETE_FAILED",
          title: "Could not delete an original activity.",
          message: (e as Error).message,
          hint:
            deleted.length > 0
              ? `Activities ${deleted.join(", ")} were already deleted — re-import them from your downloaded zip. Nothing was uploaded.`
              : "Nothing was changed on Garmin.",
          status: 502,
        });
      }
    }
    steps.push({
      step: "delete",
      status: "ok",
      detail: `Deleted originals ${deleted.join(", ")}.`,
    });

    let uploaded;
    try {
      uploaded = await client.uploadFit(preview.merged.buffer);
    } catch (e) {
      steps.push({ step: "upload", status: "failed" });
      throw recoverable(e);
    }
    if (uploaded.failures.length > 0) {
      steps.push({ step: "upload", status: "failed", detail: uploaded.failures.join("; ") });
      throw recoverable(new Error(`Garmin rejected the merged file: ${uploaded.failures.join("; ")}`));
    }

    let activityId = uploaded.activityId;
    if (!activityId && uploaded.uploadUuid) {
      const polled = await client.pollUpload(uploaded.uploadUuid);
      if (polled.failures.length > 0) {
        steps.push({ step: "upload", status: "failed", detail: polled.failures.join("; ") });
        throw recoverable(new Error(`Garmin rejected the merged file: ${polled.failures.join("; ")}`));
      }
      activityId = polled.activityId;
      if (!activityId && polled.timedOut) {
        steps.push({
          step: "upload",
          status: "ok",
          detail: "Garmin accepted the upload but is still processing it.",
        });
      }
    }
    if (activityId) {
      steps.push({ step: "upload", status: "ok", detail: `New activity ${activityId}.` });
    }

    if (name && activityId) {
      const renamed = await client.renameActivity(Number(activityId), name).catch(() => false);
      steps.push({
        step: "rename",
        status: renamed ? "ok" : "failed",
        detail: renamed ? `Named "${name}".` : "Garmin kept its own name; rename it in Connect.",
      });
    }

    await persistSession(client);
    log.info("merge complete", { activityIds, activityId });

    return NextResponse.json({
      activityId,
      processing: !activityId,
      steps,
      totals: preview.streams.totals,
    });
  } catch (e) {
    return failure("merge", e, { activityIds, steps });
  }
}

/**
 * Everything past the delete step is unrecoverable server-side — the safety net
 * is the zip already on the user's machine, so say so explicitly.
 */
function recoverable(e: unknown): AppError {
  const message = e instanceof Error ? e.message : String(e);
  const duplicate = /duplicate|409/i.test(message);
  return new AppError({
    code: duplicate ? "DEDUP_REJECTED" : "UPLOAD_FAILED",
    title: duplicate
      ? "Garmin rejected the merged activity as a duplicate."
      : "The merged activity failed to upload.",
    message,
    hint: "Your originals were already deleted. Restore them from the zip you just downloaded: Garmin Connect -> Import Data. Garmin also keeps deleted activities for ~30 days under Settings -> Account -> Recover Deleted Activities.",
    status: 502,
  });
}
