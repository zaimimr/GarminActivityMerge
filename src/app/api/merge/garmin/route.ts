import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import {
  downloadGarminOriginal,
  uploadGarminFit,
  deleteGarminActivity,
  getGarminActivityMetrics,
  pollGarminUploadStatus,
} from "@/lib/garmin";
import { mergeFitFilesWithMeta } from "@/lib/fit-merge";
import { supabaseAdmin } from "@/lib/supabase";
import { saveOriginal, saveMerged } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { categorize } from "@/lib/errors";
import { rateLimitJson } from "@/lib/rate-limit";
import { verifyCsrf, csrfRejection, CSRF_HEADER } from "@/lib/csrf";

const log = logger("merge.garmin");

export const maxDuration = 60;
export const runtime = "nodejs";

const body = z.object({
  activityIds: z.array(z.number().int()).min(2),
  name: z.string().optional(),
  deleteOriginals: z.boolean().default(true),
  timestampShiftSeconds: z.number().int().min(0).max(2592000).default(0),
});

export async function POST(req: NextRequest) {
  if (!(await verifyCsrf(req.headers.get(CSRF_HEADER)))) return csrfRejection();
  let userId: string;
  try {
    userId = await requireUser();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const rl = rateLimitJson(`merge:${userId}`, { capacity: 5, refillPerMinute: 0.5 });
  if (rl) return rl;

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { activityIds, name, deleteOriginals, timestampShiftSeconds } = parsed.data;

  const sb = supabaseAdmin();
  const { data: job, error: jobErr } = await sb
    .from("merge_jobs")
    .insert({
      user_id: userId,
      platform: "garmin",
      source_activity_ids: activityIds.map(String),
      status: "running",
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  try {
    const files: Buffer[] = [];
    const storageKeys: string[] = [];
    const metricsOverride = [];
    for (const id of activityIds) {
      const [buf, metrics] = await Promise.all([
        downloadGarminOriginal(userId, id),
        getGarminActivityMetrics(userId, id).catch((e) => {
          console.warn(`[merge/garmin] could not fetch metrics for ${id}:`, (e as Error).message);
          return {};
        }),
      ]);
      files.push(buf);
      metricsOverride.push(metrics);
      const key = await saveOriginal(userId, job.id, "garmin", String(id), buf);
      storageKeys.push(key);
    }
    await sb.from("merge_jobs").update({ originals_storage_keys: storageKeys }).eq("id", job.id);

    const mergedMeta = mergeFitFilesWithMeta(files, { name, timestampShiftSeconds, metricsOverride });
    const merged = mergedMeta.buffer;
    const mergedKey = await saveMerged(userId, job.id, merged);
    await sb
      .from("merge_jobs")
      .update({
        merged_storage_key: mergedKey,
        result_start_time: mergedMeta.startTime.toISOString(),
      })
      .eq("id", job.id);

    if (deleteOriginals) {
      for (const id of activityIds) {
        try {
          await deleteGarminActivity(userId, id);
        } catch (e) {
          console.error(`[merge/garmin] delete ${id} failed before upload:`, e);
          throw new Error(
            `Could not delete original ${id} on Garmin. Originals safe in storage, click "Restore originals" to undo if needed. Reason: ${(e as Error).message}`
          );
        }
      }
    }

    let result: unknown;
    try {
      result = await uploadGarminFit(userId, merged);
    } catch (e) {
      const msg = (e as Error).message;
      console.error("[merge/garmin] upload failed after deletes:", msg);
      throw new Error(
        `Upload failed AFTER originals were deleted. Originals are safe in our storage — click "Restore originals" to re-upload them to Garmin. Reason: ${msg}`
      );
    }

    const failureMsg = extractGarminFailureMessage(result);
    if (failureMsg) {
      console.error("[merge/garmin] upload reported failures. Full result:", JSON.stringify(result));
      throw new Error(
        `Garmin rejected the upload after originals were deleted. Click "Restore originals" to recover. Garmin says: ${failureMsg}`
      );
    }
    let uploadedId = extractGarminUploadId(result);
    if (!uploadedId) {
      const uuid = extractGarminUuid(result);
      if (uuid) {
        log.info("upload accepted async, polling", { jobId: job.id, uuid });
        const polled = await pollGarminUploadStatus(userId, uuid, { timeoutMs: 25_000 });
        if (polled.activityId) {
          uploadedId = String(polled.activityId);
          log.info("polling resolved activity id", { jobId: job.id, activityId: uploadedId });
        } else if (polled.status === "failed") {
          log.error("polled status reports failure", { jobId: job.id, failures: polled.failures });
          throw new Error(
            `Garmin processing rejected the merged activity: ${JSON.stringify(polled.failures)}. Originals were deleted — click "Restore originals" to recover.`
          );
        } else {
          uploadedId = extractGarminUploadIdAsync(result);
          log.warn("polling did not resolve activityId within timeout", { jobId: job.id, fallback: uploadedId });
        }
      }
      if (!uploadedId) {
        log.error("upload returned nothing usable", { jobId: job.id, result });
        throw new Error(
          `Garmin accepted the upload but returned no activity reference. Originals were deleted — click "Restore originals" to recover.`
        );
      }
    }

    await sb.from("merge_jobs").update({
      status: "succeeded",
      result_activity_id: uploadedId,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    log.info("merge succeeded", { jobId: job.id, uploadedId, sourceCount: activityIds.length });
    return NextResponse.json({ jobId: job.id, result, uploadedId });
  } catch (e) {
    const err = e as Error;
    const cat = categorize(err);
    log.error("merge failed", { jobId: job.id, code: cat.code, message: err.message, stack: err.stack });
    await sb.from("merge_jobs").update({
      status: "failed",
      error: err.message,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return NextResponse.json(
      { jobId: job.id, error: err.message, code: cat.code, title: cat.title, hint: cat.hint },
      { status: 500 }
    );
  }
}

function extractGarminUploadId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const detail = r.detailedImportResult as Record<string, unknown> | undefined;
  if (detail) {
    const successes = detail.successes as Array<Record<string, unknown>> | undefined;
    if (successes && successes[0]?.internalId) return String(successes[0].internalId);
  }
  return null;
}

function extractGarminUploadIdAsync(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const detail = r.detailedImportResult as Record<string, unknown> | undefined;
  if (!detail) return null;
  if (typeof detail.uploadId === "number" || typeof detail.uploadId === "string") {
    return String(detail.uploadId);
  }
  const uuid = detail.uploadUuid as { uuid?: string } | undefined;
  return uuid?.uuid ?? null;
}

function extractGarminUuid(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const detail = r.detailedImportResult as Record<string, unknown> | undefined;
  if (!detail) return null;
  const uuid = detail.uploadUuid as { uuid?: string } | undefined;
  return uuid?.uuid ?? null;
}

function extractGarminFailureMessage(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const detail = r.detailedImportResult as Record<string, unknown> | undefined;
  if (!detail) return null;
  const failures = detail.failures as Array<{ messages?: Array<{ content?: string }> }> | undefined;
  if (!failures || failures.length === 0) return null;
  const messages = failures
    .flatMap((f) => f.messages ?? [])
    .map((m) => m.content)
    .filter(Boolean) as string[];
  return messages.length > 0 ? messages.join("; ") : null;
}
