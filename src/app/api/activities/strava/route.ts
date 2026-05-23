import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { listActivities } from "@/lib/strava";

export async function GET(req: Request) {
  try {
    const userId = await requireUser();
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const data = await listActivities(userId, { page, per_page: 50 });
    return NextResponse.json({ activities: data });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
