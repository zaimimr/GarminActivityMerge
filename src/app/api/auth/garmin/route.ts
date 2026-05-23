import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loginWithPassword, saveGarminSession } from "@/lib/garmin";
import { getOrCreateUser, readSession, setSessionCookie } from "@/lib/session";

export const maxDuration = 30;
export const runtime = "nodejs";

const body = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let parsed;
  try {
    parsed = body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  try {
    const tokens = await loginWithPassword(parsed.username, parsed.password);
    const existing = await readSession();
    const userId = existing?.userId ?? (await getOrCreateUser());
    await saveGarminSession(userId, parsed.username, tokens);
    if (!existing) await setSessionCookie(userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message ?? "Login failed";
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}
