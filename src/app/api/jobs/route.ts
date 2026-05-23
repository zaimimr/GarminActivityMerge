import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const userId = await requireUser();
    const { data, error } = await supabaseAdmin()
      .from("merge_jobs")
      .select("id, platform, source_activity_ids, result_activity_id, result_start_time, status, error, created_at, completed_at, undone_at, originals_storage_keys")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return NextResponse.json({ jobs: data ?? [] });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
