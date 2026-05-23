import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import {
  getActivityOriginal,
  uploadActivity,
  deleteActivity,
} from "@/lib/strava";
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
      platform: "strava",
      source_activity_ids: activityIds.map(String),
      status: "running",
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  try {
    const files = await Promise.all(
      activityIds.map((id) => getActivityOriginal(userId, id).then((ab) => Buffer.from(ab)))
    );
    const merged = mergeFitFiles(files, { name });
    const uploaded = await uploadActivity(userId, merged, { name, data_type: "fit" });
    if (deleteOriginals) {
      for (const id of activityIds) {
        try {
          await deleteActivity(userId, id);
        } catch (e) {
          console.error(`Failed to delete Strava activity ${id}:`, e);
        }
      }
    }
    await sb.from("merge_jobs").update({
      status: "succeeded",
      result_activity_id: String(uploaded.id),
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return NextResponse.json({ activityId: uploaded.id });
  } catch (e) {
    const err = e as Error;
    console.error("[merge/strava] failed:", err.stack ?? err.message);
    await sb.from("merge_jobs").update({
      status: "failed",
      error: err.message,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
