import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import {
  downloadGarminOriginal,
  uploadGarminFit,
  deleteGarminActivity,
} from "@/lib/garmin";
import { mergeFitFiles } from "@/lib/fit-merge";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;
export const runtime = "nodejs";

const body = z.object({
  activityIds: z.array(z.number().int()).min(2),
  name: z.string().optional(),
  deleteOriginals: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { activityIds, name, deleteOriginals } = parsed.data;

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
    for (const id of activityIds) {
      files.push(await downloadGarminOriginal(userId, id));
    }
    const merged = mergeFitFiles(files, { name });
    const result = await uploadGarminFit(userId, merged);
    if (deleteOriginals) {
      for (const id of activityIds) {
        try {
          await deleteGarminActivity(userId, id);
        } catch (e) {
          console.error(`Failed to delete Garmin activity ${id}:`, e);
        }
      }
    }
    const resultId = extractGarminUploadId(result);
    await sb.from("merge_jobs").update({
      status: "succeeded",
      result_activity_id: resultId,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return NextResponse.json({ result });
  } catch (e) {
    const err = e as Error;
    console.error("[merge/garmin] failed:", err.stack ?? err.message);
    await sb.from("merge_jobs").update({
      status: "failed",
      error: err.message,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return NextResponse.json({ error: err.message }, { status: 500 });
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
