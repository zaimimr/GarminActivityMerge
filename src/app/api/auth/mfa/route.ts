import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitMfaCode } from "@/lib/garmin/auth";
import { GarminClient } from "@/lib/garmin/client";
import { readMfaChallenge, clearMfaChallenge, setGarminSession } from "@/lib/session";
import { verifyCsrf, csrfRejection, CSRF_HEADER } from "@/lib/csrf";
import { rateLimitJson, clientKey } from "@/lib/rate-limit";
import { failure } from "@/lib/api";
import { AppError } from "@/lib/errors";

export const maxDuration = 30;
export const runtime = "nodejs";

const body = z.object({ code: z.string().min(4).max(12) });

export async function POST(req: NextRequest) {
  if (!(await verifyCsrf(req.headers.get(CSRF_HEADER)))) return csrfRejection();

  const limited = rateLimitJson(`mfa:${clientKey(req)}`, { capacity: 5, refillPerMinute: 1 });
  if (limited) return limited;

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A verification code is required", code: "VALIDATION", title: "Missing code." },
      { status: 400 }
    );
  }

  try {
    const challenge = await readMfaChallenge();
    if (!challenge) {
      throw new AppError({
        code: "MFA_REQUIRED",
        title: "That sign-in attempt timed out.",
        message: "No MFA challenge cookie.",
        hint: "Start over with your email and password.",
        status: 440,
      });
    }

    const tokens = await submitMfaCode(challenge, parsed.data.code.trim());
    await clearMfaChallenge();

    const client = new GarminClient({ ...tokens, displayName: "" });
    const displayName = await client.displayName().catch(() => "Garmin athlete");
    await setGarminSession({ ...client.current, displayName });

    return NextResponse.json({ displayName });
  } catch (e) {
    return failure("auth.mfa", e);
  }
}
