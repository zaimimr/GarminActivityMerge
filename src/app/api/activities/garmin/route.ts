import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { listGarminActivities } from "@/lib/garmin";

export const maxDuration = 30;
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const userId = await requireUser();
    const url = new URL(req.url);
    const start = Number(url.searchParams.get("start") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const data = await listGarminActivities(userId, start, limit);
    return NextResponse.json({ activities: data });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
