import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { login } from "@/lib/garmin/auth";
import { GarminClient } from "@/lib/garmin/client";
import { setGarminSession, setMfaChallenge, clearGarminSession } from "@/lib/session";
import { verifyCsrf, csrfRejection, CSRF_HEADER } from "@/lib/csrf";
import { rateLimitJson, clientKey } from "@/lib/rate-limit";
import { failure } from "@/lib/api";

export const maxDuration = 30;
export const runtime = "nodejs";

const body = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  if (!(await verifyCsrf(req.headers.get(CSRF_HEADER)))) return csrfRejection();

  const limited = rateLimitJson(`login:${clientKey(req)}`, { capacity: 5, refillPerMinute: 1 });
  if (limited) return limited;

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Email and password are required", code: "VALIDATION", title: "Missing credentials." },
      { status: 400 }
    );
  }

  try {
    await clearGarminSession();
    const result = await login(parsed.data.email, parsed.data.password);

    if (result.status === "mfa_required") {
      await setMfaChallenge(result.challenge);
      return NextResponse.json({ mfaRequired: true });
    }

    const client = new GarminClient({ ...result.tokens, displayName: "" });
    const displayName = await client.displayName().catch(() => parsed.data.email);
    await setGarminSession({ ...client.current, displayName });

    return NextResponse.json({ mfaRequired: false, displayName });
  } catch (e) {
    return failure("auth.login", e);
  }
}
