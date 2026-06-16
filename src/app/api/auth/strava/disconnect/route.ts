import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { deauthorizeStrava } from "@/lib/strava";
import { verifyCsrf, csrfRejection, CSRF_HEADER } from "@/lib/csrf";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!(await verifyCsrf(req.headers.get(CSRF_HEADER)))) return csrfRejection();
  let userId: string;
  try {
    userId = await requireUser();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  await deauthorizeStrava(userId);
  return NextResponse.json({ ok: true });
}
