import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

const log = logger("cron.cleanup-storage");
const RETENTION_DAYS = 60;
const BUCKET = "originals";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const sb = supabaseAdmin();

  const { data: jobs, error } = await sb
    .from("merge_jobs")
    .select("id, originals_storage_keys, merged_storage_key")
    .eq("status", "succeeded")
    .is("undone_at", null)
    .lt("created_at", cutoff)
    .or("originals_storage_keys.not.is.null,merged_storage_key.not.is.null");
  if (error) {
    log.error("query failed", { message: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let deletedKeys = 0;
  let touchedJobs = 0;
  for (const j of jobs ?? []) {
    const keys = [...(j.originals_storage_keys ?? []), j.merged_storage_key].filter(
      Boolean
    ) as string[];
    if (keys.length === 0) continue;
    const { error: rmErr } = await sb.storage.from(BUCKET).remove(keys);
    if (rmErr) {
      log.warn("remove failed", { jobId: j.id, message: rmErr.message });
      continue;
    }
    deletedKeys += keys.length;
    touchedJobs += 1;
    await sb
      .from("merge_jobs")
      .update({ originals_storage_keys: null, merged_storage_key: null })
      .eq("id", j.id);
  }

  log.info("cleanup done", { touchedJobs, deletedKeys, retentionDays: RETENTION_DAYS });
  return NextResponse.json({ touchedJobs, deletedKeys });
}
