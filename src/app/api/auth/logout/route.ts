import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/session";
import { verifyCsrf, csrfRejection, CSRF_HEADER } from "@/lib/csrf";

export async function POST(req: NextRequest) {
  if (!(await verifyCsrf(req.headers.get(CSRF_HEADER)))) return csrfRejection();
  await clearSession();
  return NextResponse.json({ ok: true });
}
