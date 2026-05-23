import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import {
  getActivityOriginal,
  uploadActivity,
  deleteActivity,
} from "@/lib/strava";
import { buildFitFromStravaActivity } from "@/lib/strava-streams";
import { mergeFitFilesWithMeta } from "@/lib/fit-merge";
import { supabaseAdmin } from "@/lib/supabase";
import { saveOriginal, saveMerged } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { categorize } from "@/lib/errors";
import { rateLimitJson } from "@/lib/rate-limit";
import { verifyCsrf, csrfRejection, CSRF_HEADER } from "@/lib/csrf";

const log = logger("merge.strava");

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
      platform: "strava",
      source_activity_ids: activityIds.map(String),
      status: "running",
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  try {
    const files: Buffer[] = [];
    const storageKeys: string[] = [];
    for (const id of activityIds) {
      let buf: Buffer;
      try {
        const ab = await getActivityOriginal(userId, id);
        buf = Buffer.from(ab);
        if (buf[0] !== 0x0c && buf[0] !== 0x0e) {
          throw new Error("Original is not a FIT file (likely native Strava activity)");
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("404") || msg.includes("not a FIT")) {
          console.log(`[merge/strava] export_original unavailable for ${id}, building FIT from streams`);
          buf = await buildFitFromStravaActivity(userId, id);
        } else {
          throw e;
        }
      }
      files.push(buf);
      const key = await saveOriginal(userId, job.id, "strava", String(id), buf);
      storageKeys.push(key);
    }
    await sb.from("merge_jobs").update({ originals_storage_keys: storageKeys }).eq("id", job.id);

    const mergedMeta = mergeFitFilesWithMeta(files, { name, timestampShiftSeconds });
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
          await deleteActivity(userId, id);
        } catch (e) {
          console.error(`[merge/strava] delete ${id} failed before upload:`, e);
          throw new Error(
            `Could not delete original ${id} on Strava. Originals safe in storage, click "Restore originals" to undo if needed. Reason: ${(e as Error).message}`
          );
        }
      }
    }

    let uploaded;
    try {
      uploaded = await uploadActivity(userId, merged, { name, data_type: "fit" });
    } catch (e) {
      const msg = (e as Error).message;
      console.error("[merge/strava] upload failed after deletes:", msg);
      throw new Error(
        `Upload failed AFTER originals were deleted from Strava. Originals are safe in our storage — click "Restore originals" to re-upload them. Reason: ${msg}`
      );
    }

    await sb.from("merge_jobs").update({
      status: "succeeded",
      result_activity_id: String(uploaded.id),
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    log.info("merge succeeded", { jobId: job.id, activityId: uploaded.id, sourceCount: activityIds.length });
    return NextResponse.json({ jobId: job.id, activityId: uploaded.id });
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
