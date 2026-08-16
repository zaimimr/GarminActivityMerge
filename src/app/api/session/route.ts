import { NextResponse } from "next/server";
import { readGarminSession } from "@/lib/session";
import { ensureCsrfCookie } from "@/lib/csrf";

export const runtime = "nodejs";

export async function GET() {
  await ensureCsrfCookie();
  const session = await readGarminSession();
  return NextResponse.json(
    session
      ? { connected: true, displayName: session.displayName }
      : { connected: false }
  );
}
