import { NextRequest, NextResponse } from "next/server";
import { requireClient, persistSession, failure } from "@/lib/api";

export const maxDuration = 30;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const client = await requireClient();
    const start = clamp(Number(req.nextUrl.searchParams.get("start") ?? 0), 0, 1000);
    const limit = clamp(Number(req.nextUrl.searchParams.get("limit") ?? 30), 1, 100);

    const activities = await client.listActivities(start, limit);
    await persistSession(client);

    return NextResponse.json({ activities });
  } catch (e) {
    return failure("activities", e);
  }
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}
