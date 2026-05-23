import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { signedDownloadUrl } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const userId = await requireUser();
    const { jobId } = await params;
    const url = new URL(req.url);
    const which = url.searchParams.get("which") ?? "merged";

    const { data, error } = await supabaseAdmin()
      .from("merge_jobs")
      .select("id, user_id, merged_storage_key, originals_storage_keys")
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (data.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (which === "merged") {
      if (!data.merged_storage_key) {
        return NextResponse.json({ error: "No merged file stored for this job" }, { status: 404 });
      }
      const signed = await signedDownloadUrl(data.merged_storage_key);
      return NextResponse.redirect(signed);
    }

    const originals = (data.originals_storage_keys as string[] | null) ?? [];
    const idx = Number(url.searchParams.get("index") ?? "0");
    if (!originals[idx]) {
      return NextResponse.json({ error: "No such original" }, { status: 404 });
    }
    const signed = await signedDownloadUrl(originals[idx]);
    return NextResponse.redirect(signed);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
