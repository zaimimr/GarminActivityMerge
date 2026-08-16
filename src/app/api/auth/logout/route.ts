import { NextResponse } from "next/server";
import { clearGarminSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  await clearGarminSession();
  return NextResponse.json({ ok: true });
}
