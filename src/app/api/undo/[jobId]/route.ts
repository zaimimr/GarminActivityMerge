import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { loadOriginal } from "@/lib/storage";
import { uploadGarminFit, deleteGarminActivity } from "@/lib/garmin";
import { uploadActivity, deleteActivity } from "@/lib/strava";
import { logger } from "@/lib/logger";
import { categorize } from "@/lib/errors";
import { verifyCsrf, csrfRejection, CSRF_HEADER } from "@/lib/csrf";

const log = logger("undo");

export const maxDuration = 60;
export const runtime = "nodejs";

type Job = {
  id: string;
  user_id: string;
  platform: "strava" | "garmin";
  source_activity_ids: string[];
  result_activity_id: string | null;
  status: string;
  originals_storage_keys: string[] | null;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  if (!(await verifyCsrf(req.headers.get(CSRF_HEADER)))) return csrfRejection();
  let userId: string;
  try {
    userId = await requireUser();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const { jobId } = await params;
  const sb = supabaseAdmin();

  const { data: jobData, error: jobErr } = await sb
    .from("merge_jobs")
    .select("id, user_id, platform, source_activity_ids, result_activity_id, status, originals_storage_keys")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  if (!jobData) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const job = jobData as Job;
  if (job.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (job.status === "undone") return NextResponse.json({ error: "Already undone" }, { status: 400 });
  if (!job.originals_storage_keys || job.originals_storage_keys.length === 0) {
    return NextResponse.json({ error: "No saved originals for this job" }, { status: 400 });
  }

  const restored: string[] = [];
  const errors: string[] = [];

  for (const key of job.originals_storage_keys) {
    try {
      const buf = await loadOriginal(key);
      if (job.platform === "garmin") {
        const result = await uploadGarminFit(userId, buf);
        restored.push(extractIdFromResult(result) ?? key);
      } else {
        const uploaded = await uploadActivity(userId, buf, { data_type: "fit" });
        restored.push(String(uploaded.id));
      }
    } catch (e) {
      const msg = (e as Error).message;
      log.error("restore failed", { jobId, key, message: msg });
      errors.push(`${key}: ${msg}`);
    }
  }

  if (job.result_activity_id && errors.length === 0) {
    try {
      const idNum = Number(job.result_activity_id);
      if (job.platform === "garmin") {
        if (!Number.isNaN(idNum)) await deleteGarminActivity(userId, idNum);
      } else {
        if (!Number.isNaN(idNum)) await deleteActivity(userId, idNum);
      }
    } catch (e) {
      log.error("delete merged result failed", { jobId, resultId: job.result_activity_id, message: (e as Error).message });
      errors.push(`Delete merged result: ${(e as Error).message}`);
    }
  }

  if (errors.length === 0) {
    await sb.from("merge_jobs").update({
      status: "undone",
      undone_at: new Date().toISOString(),
    }).eq("id", job.id);
    log.info("undo succeeded", { jobId, restored: restored.length });
    return NextResponse.json({ restored });
  }

  const cat = categorize(errors.join("; "));
  log.warn("undo partial", { jobId, restoredCount: restored.length, errorCount: errors.length });
  return NextResponse.json(
    { restored, errors, partial: true, code: cat.code, title: cat.title, hint: cat.hint },
    { status: 207 }
  );
}

function extractIdFromResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const detail = r.detailedImportResult as Record<string, unknown> | undefined;
  if (detail) {
    const successes = detail.successes as Array<Record<string, unknown>> | undefined;
    if (successes && successes[0]?.internalId) return String(successes[0].internalId);
  }
  return null;
}
